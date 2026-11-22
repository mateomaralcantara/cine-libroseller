// Flujos operativos que cruzan varios recursos.
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireRole, can, verifyPassword, validatePassword, hashPassword } from '../auth.js';
import { HttpError } from '../validate.js';
import { audit, tx, setSetting } from '../db.js';
import { hooks, shotConsentIssues, fxRates, toUSD, LIKENESS_TECHNIQUES, VOICE_TECHNIQUES } from '../rules.js';
import { CURRENCIES } from '../schema.js';
import { stripPrivate } from './crud.js';

const STAFF = ['admin', 'productor', 'vfx', 'ventas'];
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const FORMAT_FROM_SERVICE = {
  largometraje: 'largometraje', cortometraje: 'cortometraje', serie: 'serie', comercial: 'comercial',
  videoclip: 'videoclip', documental: 'documental', trailer_libro: 'trailer_libro',
};

export function workflowRouter(db) {
  const r = Router();

  // ---------- Solicitud → Cliente + Proyecto + Negocio ----------
  r.post('/leads/:id/convert', requireRole('admin', 'ventas'), (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id));
    if (!lead) throw new HttpError(404, 'Solicitud no encontrada');
    if (lead.project_id) throw new HttpError(409, 'Esta solicitud ya fue convertida en proyecto');
    const title = String(req.body?.title || '').trim() || `${lead.company || lead.name} — ${lead.service}`;
    const price = Number(req.body?.price) || 0;
    const currency = CURRENCIES.includes(req.body?.currency) ? req.body.currency : 'USD';

    const out = tx(db, () => {
      let client = lead.email ? db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get(lead.email) : null;
      if (!client) {
        const info = db.prepare(`INSERT INTO clients(name, company, email, phone, country, kind, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(lead.name, lead.company, lead.email, lead.phone, lead.country,
            lead.origin === 'libroseller' ? 'autor' : (lead.company ? 'marca' : 'particular'), req.user.id);
        client = { id: Number(info.lastInsertRowid) };
      }
      const project = {
        title: title.slice(0, 200), logline: lead.message?.slice(0, 1000) || null, client_id: client.id,
        format: FORMAT_FROM_SERVICE[lead.service] || 'otro', source_type: lead.source_type,
        production_mode: lead.service === 'produccion_virtual' ? 'virtual' : 'hibrido',
        stage: 'desarrollo', currency, price, producer_id: null,
      };
      hooks.projects.beforeInsert(db, project);
      const cols = Object.keys(project);
      const pinfo = db.prepare(`INSERT INTO projects(${cols.join(',')}, created_by) VALUES (${cols.map(() => '?').join(',')}, ?)`)
        .run(...cols.map((c) => project[c]), req.user.id);
      const projectId = Number(pinfo.lastInsertRowid);
      const dinfo = db.prepare(`INSERT INTO deals(title, kind, project_id, client_id, channel, amount, currency, stage, created_by)
        VALUES (?, 'produccion', ?, ?, ?, ?, ?, 'propuesta', ?)`)
        .run(project.title, projectId, client.id, lead.origin === 'manual' || lead.origin === 'referido' ? 'directo' : lead.origin,
          price, currency, req.user.id);
      db.prepare(`UPDATE leads SET status = 'ganado', client_id = ?, project_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(client.id, projectId, lead.id);
      return { client_id: client.id, project_id: projectId, deal_id: Number(dinfo.lastInsertRowid), code: project.code };
    });
    audit(db, req, 'convert', 'leads', lead.id, out);
    res.status(201).json(out);
  });

  // ---------- Sala de revisión ----------
  function loadVersionFor(req) {
    const v = db.prepare(`SELECT v.*, p.client_id, p.title AS project_title, p.code AS project_code
      FROM versions v JOIN projects p ON p.id = v.project_id WHERE v.id = ?`).get(Number(req.params.id));
    if (!v) throw new HttpError(404, 'Versión no encontrada');
    if (req.user.role === 'cliente' && (v.client_id !== req.user.client_id || !v.client_visible)) {
      throw new HttpError(404, 'Versión no encontrada');
    }
    if (!STAFF.includes(req.user.role) && req.user.role !== 'cliente') throw new HttpError(403, 'Sin permiso');
    return v;
  }

  r.get('/versions/:id/review', (req, res) => {
    const v = loadVersionFor(req);
    const notes = db.prepare(`SELECT n.*, u.name AS author, u.role AS author_role FROM review_notes n
      LEFT JOIN users u ON u.id = n.author_id WHERE n.version_id = ? ORDER BY n.timecode IS NULL, n.timecode, n.id`).all(v.id);
    const history = db.prepare(`SELECT id, label, kind, status, created_at FROM versions WHERE project_id = ?
      ${req.user.role === 'cliente' ? 'AND client_visible = 1' : ''} ORDER BY id DESC`).all(v.project_id);
    res.json({ version: v, notes, history });
  });

  r.post('/versions/:id/notes', (req, res) => {
    const v = loadVersionFor(req);
    const note = String(req.body?.note || '').trim();
    const timecode = String(req.body?.timecode || '').trim() || null;
    if (!note) throw new HttpError(422, 'Escribe la nota', { note: 'Obligatoria' });
    if (note.length > 4000) throw new HttpError(422, 'Nota demasiado larga');
    if (timecode && !/^\d{1,2}:\d{2}(:\d{2})?([:;]\d{2})?$/.test(timecode)) throw new HttpError(422, 'Timecode inválido (HH:MM:SS o MM:SS)', { timecode: 'Formato inválido' });
    if (v.status === 'aprobado') throw new HttpError(409, 'La versión ya está aprobada; sube una versión nueva para más cambios');
    const info = db.prepare('INSERT INTO review_notes(version_id, author_id, timecode, note) VALUES (?, ?, ?, ?)').run(v.id, req.user.id, timecode, note);
    audit(db, req, 'note', 'versions', v.id);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/notes/:id/resolve', requireRole('admin', 'productor', 'vfx'), (req, res) => {
    const info = db.prepare('UPDATE review_notes SET resolved = ? WHERE id = ?').run(req.body?.resolved === false ? 0 : 1, Number(req.params.id));
    if (!info.changes) throw new HttpError(404, 'Nota no encontrada');
    res.json({ ok: true });
  });

  r.post('/versions/:id/decision', (req, res) => {
    const v = loadVersionFor(req);
    if (!['admin', 'productor', 'cliente'].includes(req.user.role)) throw new HttpError(403, 'Sólo producción o el cliente pueden decidir');
    const decision = req.body?.decision;
    if (!['aprobado', 'cambios_solicitados'].includes(decision)) throw new HttpError(422, 'Decisión inválida');
    if (v.status === 'aprobado') throw new HttpError(409, 'La versión ya fue aprobada');
    const comment = String(req.body?.comment || '').trim().slice(0, 4000);
    if (decision === 'cambios_solicitados' && !comment) {
      const open = db.prepare('SELECT COUNT(*) n FROM review_notes WHERE version_id = ? AND resolved = 0').get(v.id).n;
      if (!open) throw new HttpError(422, 'Indica qué cambios necesitas (comentario o notas con timecode)');
    }
    tx(db, () => {
      db.prepare(`UPDATE versions SET status = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(decision, req.user.id, v.id);
      if (comment) {
        db.prepare('INSERT INTO review_notes(version_id, author_id, note) VALUES (?, ?, ?)')
          .run(v.id, req.user.id, `[${decision === 'aprobado' ? 'Aprobación' : 'Cambios solicitados'}] ${comment}`);
      }
      if (decision === 'aprobado' && v.kind === 'master') {
        db.prepare(`UPDATE projects SET stage = 'entregado', updated_at = datetime('now') WHERE id = ? AND stage NOT IN ('distribucion')`).run(v.project_id);
      } else if (decision === 'cambios_solicitados') {
        db.prepare(`UPDATE projects SET stage = 'revision', updated_at = datetime('now') WHERE id = ? AND stage IN ('postproduccion','vfx','revision')`).run(v.project_id);
      }
    });
    audit(db, req, 'decision', 'versions', v.id, { decision });
    res.json({ ok: true, status: decision });
  });

  // ---------- Continuidad y derechos ----------
  r.get('/projects/:id/continuity-report', requireRole('admin', 'productor', 'vfx'), (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'Proyecto no encontrado');
    const characters = db.prepare('SELECT * FROM characters WHERE project_id = ?').all(p.id);
    const bible = db.prepare('SELECT * FROM continuity WHERE project_id = ?').all(p.id);
    const shots = db.prepare('SELECT * FROM shots WHERE project_id = ?').all(p.id);
    const findings = [];
    const add = (severity, area, message, ref) => findings.push({ severity, area, message, ref });

    for (const ch of characters) {
      const entries = bible.filter((b) => b.character_id === ch.id);
      const cats = new Set(entries.map((b) => b.category));
      if (!cats.has('personaje')) add('media', 'Personajes', `${ch.name}: sin ficha de aspecto en la biblia de continuidad`, { resource: 'characters', id: ch.id });
      if (!cats.has('vestuario') && ch.kind !== 'ficticio_ia') add('baja', 'Vestuario', `${ch.name}: sin ficha de vestuario`, { resource: 'characters', id: ch.id });
      if ((ch.voice_id || ch.kind !== 'humano') && !cats.has('voz')) add('media', 'Voz', `${ch.name}: sin perfil de voz documentado`, { resource: 'characters', id: ch.id });
      if (['digital', 'hibrido'].includes(ch.kind) && !ch.digital_double_id && !ch.actor_id) {
        add('media', 'Personajes', `${ch.name}: personaje ${ch.kind} sin intérprete ni referencia humana asignada`, { resource: 'characters', id: ch.id });
      }
      const usesAI = shots.some((s) => s.character_id === ch.id && [...LIKENESS_TECHNIQUES, ...VOICE_TECHNIQUES].includes(s.technique));
      if (usesAI) {
        const unlocked = entries.filter((b) => !b.locked);
        if (unlocked.length) add('media', 'Continuidad IA', `${ch.name}: ${unlocked.length} ficha(s) sin bloquear mientras hay planos IA en curso — riesgo de deriva visual`, { resource: 'characters', id: ch.id });
      }
    }
    for (const s of shots) {
      if (s.status === 'aprobado') continue;
      const issues = shotConsentIssues(db, s);
      for (const i of issues) add('alta', 'Derechos', `Plano ${s.code}: ${i}`, { resource: 'shots', id: s.id });
      if (s.due_date && s.due_date < new Date().toISOString().slice(0, 10)) add('media', 'Calendario', `Plano ${s.code} vencido (${s.due_date})`, { resource: 'shots', id: s.id });
      if ((s.iterations || 0) >= 5) add('baja', 'VFX', `Plano ${s.code} lleva ${s.iterations} iteraciones`, { resource: 'shots', id: s.id });
    }
    const unsignedAi = db.prepare(`SELECT c.* FROM contracts c WHERE c.project_id = ? AND c.party_type = 'talento' AND (c.ai_clause = 0 OR c.status != 'firmado')`).all(p.id);
    for (const c of unsignedAi) {
      add(c.status !== 'firmado' ? 'alta' : 'media', 'Contratos',
        `${c.party_name}: contrato ${c.status}${c.ai_clause ? '' : ' sin cláusula de IA / réplica digital'}`, { resource: 'contracts', id: c.id });
    }
    const order = { alta: 0, media: 1, baja: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    res.json({ project: { id: p.id, code: p.code, title: p.title }, findings, totals: {
      characters: characters.length, bible: bible.length, locked: bible.filter((b) => b.locked).length, shots: shots.length,
    } });
  });

  // ---------- Finanzas ----------
  function projectFinance(p, rates) {
    const budget = db.prepare(`SELECT category, SUM(planned) planned, SUM(actual) actual FROM budget_items WHERE project_id = ? GROUP BY category`).all(p.id);
    const pay = db.prepare(`SELECT direction, currency, SUM(amount) total FROM payments WHERE project_id = ? GROUP BY direction, currency`).all(p.id);
    const deals = db.prepare(`SELECT currency, SUM(amount) total FROM deals WHERE project_id = ? AND stage = 'ganado' GROUP BY currency`).all(p.id);
    const conv = (amt, cur) => toUSD(rates, amt, cur) * (rates[p.currency] || 1); // a la moneda del proyecto
    const planned = budget.reduce((s, b) => s + (b.planned || 0), 0);
    const actual = budget.reduce((s, b) => s + (b.actual || 0), 0);
    const received = pay.filter((x) => x.direction === 'ingreso').reduce((s, x) => s + conv(x.total, x.currency), 0);
    const paidOut = pay.filter((x) => x.direction === 'egreso').reduce((s, x) => s + conv(x.total, x.currency), 0);
    const dealRevenue = deals.reduce((s, x) => s + conv(x.total, x.currency), 0);
    const revenue = Math.max(p.price || 0, dealRevenue);
    const cost = Math.max(actual, paidOut);
    return {
      currency: p.currency, price: p.price || 0, revenue, planned, actual, received, paid_out: paidOut,
      receivable: Math.max(revenue - received, 0),
      margin: revenue - cost, margin_pct: revenue ? ((revenue - cost) / revenue) * 100 : null,
      projected_margin: revenue - Math.max(planned, actual),
      overrun: actual > planned ? actual - planned : 0,
      by_category: budget,
    };
  }

  r.get('/projects/:id/summary', requireRole('admin', 'productor', 'vfx', 'ventas'), (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
    if (!p) throw new HttpError(404, 'Proyecto no encontrado');
    const count = (t, extra = '') => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE project_id = ? ${extra}`).get(p.id).n;
    const shotStatus = db.prepare('SELECT status, COUNT(*) n FROM shots WHERE project_id = ? GROUP BY status').all(p.id);
    const client = p.client_id ? db.prepare('SELECT id, name, company FROM clients WHERE id = ?').get(p.client_id) : null;
    const producer = p.producer_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(p.producer_id) : null;
    const nextShoot = db.prepare(`SELECT * FROM shoots WHERE project_id = ? AND date >= date('now') AND status != 'cancelado' ORDER BY date LIMIT 1`).get(p.id);
    const lastVersion = db.prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(p.id);
    const canFinance = can(req.user, 'budget_items', 'read');
    res.json({
      project: p, client, producer, next_shoot: nextShoot || null, last_version: lastVersion || null,
      counts: {
        characters: count('characters'), shoots: count('shoots'), shots: count('shots'), continuity: count('continuity'),
        contracts: count('contracts'), versions: count('versions'), budget_items: count('budget_items'), deals: count('deals'),
      },
      shot_status: Object.fromEntries(shotStatus.map((s) => [s.status, s.n])),
      finance: canFinance ? projectFinance(p, fxRates(db)) : null,
    });
  });

  r.get('/finance/overview', requireRole('admin', 'productor', 'ventas'), (req, res) => {
    const rates = fxRates(db);
    const projects = db.prepare(`SELECT * FROM projects WHERE stage != 'cancelado' ORDER BY id DESC`).all();
    const rows = projects.map((p) => {
      const f = projectFinance(p, rates);
      const u = (x) => toUSD(rates, x, p.currency);
      return { id: p.id, code: p.code, title: p.title, stage: p.stage, currency: p.currency,
        revenue: f.revenue, cost: Math.max(f.actual, f.paid_out), planned: f.planned, margin: f.margin, margin_pct: f.margin_pct,
        revenue_usd: u(f.revenue), cost_usd: u(Math.max(f.actual, f.paid_out)), planned_usd: u(f.planned), margin_usd: u(f.margin),
        receivable_usd: u(f.receivable), overrun_usd: u(f.overrun) };
    });
    const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
    const year = new Date().getFullYear();
    const monthly = db.prepare(`SELECT substr(date,1,7) month, direction, currency, SUM(amount) total FROM payments
      WHERE date >= ? GROUP BY month, direction, currency ORDER BY month`).all(`${year}-01-01`);
    const months = {};
    for (const m of monthly) {
      months[m.month] ??= { month: m.month, ingreso: 0, egreso: 0 };
      months[m.month][m.direction] += toUSD(rates, m.total, m.currency);
    }
    const channels = db.prepare(`SELECT channel, currency, SUM(amount) total, COUNT(*) n FROM deals WHERE stage = 'ganado' GROUP BY channel, currency`).all();
    const byChannel = {};
    for (const c of channels) {
      byChannel[c.channel] ??= { channel: c.channel, total_usd: 0, deals: 0 };
      byChannel[c.channel].total_usd += toUSD(rates, c.total, c.currency);
      byChannel[c.channel].deals += c.n;
    }
    res.json({
      rates, projects: rows,
      totals: { revenue_usd: sum('revenue_usd'), cost_usd: sum('cost_usd'), planned_usd: sum('planned_usd'), margin_usd: sum('margin_usd'), receivable_usd: sum('receivable_usd') },
      cashflow: Object.values(months), channels: Object.values(byChannel).sort((a, b) => b.total_usd - a.total_usd),
    });
  });

  r.get('/settings/fx', requireRole(...STAFF), (_req, res) => res.json({ rates: fxRates(db) }));
  r.put('/settings/fx', requireRole('admin'), (req, res) => {
    const rates = { USD: 1 };
    for (const c of CURRENCIES) {
      if (c === 'USD') continue;
      const n = Number(req.body?.rates?.[c]);
      if (!Number.isFinite(n) || n <= 0) throw new HttpError(422, `Tasa inválida para ${c}`);
      rates[c] = n;
    }
    setSetting(db, 'fx_rates', rates);
    audit(db, req, 'update', 'settings', null, { fx_rates: rates });
    res.json({ rates });
  });

  // ---------- Tablero ----------
  r.get('/dashboard', requireRole(...STAFF), (req, res) => {
    const rates = fxRates(db);
    const today = new Date().toISOString().slice(0, 10);
    const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const group = (sql) => Object.fromEntries(db.prepare(sql).all().map((x) => [x.k, x.n]));

    const pipeline = db.prepare(`SELECT stage, currency, SUM(amount) total, COUNT(*) n FROM deals WHERE stage IN ('prospecto','propuesta','negociacion') GROUP BY stage, currency`).all();
    const pipelineUsd = pipeline.reduce((s, x) => s + toUSD(rates, x.total, x.currency), 0);
    const wonYear = db.prepare(`SELECT currency, SUM(amount) total FROM deals WHERE stage = 'ganado' AND COALESCE(close_date, substr(updated_at,1,10)) >= ? GROUP BY currency`).all(`${today.slice(0, 4)}-01-01`);
    const consentAlerts = db.prepare(`SELECT id, name, kind, likeness_consent, voice_consent, consent_expires FROM talent
      WHERE (kind != 'interprete_digital' AND (likeness_consent IN ('pendiente','revocado') OR voice_consent IN ('revocado')))
         OR (consent_expires IS NOT NULL AND consent_expires <= ?)
      ORDER BY consent_expires IS NULL, consent_expires LIMIT 10`).all(in30);
    const blockedShots = db.prepare(`SELECT * FROM shots WHERE status NOT IN ('aprobado') AND technique IN (${[...LIKENESS_TECHNIQUES, ...VOICE_TECHNIQUES].map(() => '?').join(',')})`)
      .all(...LIKENESS_TECHNIQUES, ...VOICE_TECHNIQUES)
      .map((s) => ({ id: s.id, code: s.code, project_id: s.project_id, issues: shotConsentIssues(db, s) }))
      .filter((s) => s.issues.length);
    const overruns = db.prepare(`SELECT p.id, p.code, p.title, p.currency, SUM(b.planned) planned, SUM(b.actual) actual
      FROM budget_items b JOIN projects p ON p.id = b.project_id GROUP BY p.id HAVING SUM(b.actual) > SUM(b.planned) ORDER BY SUM(b.actual) - SUM(b.planned) DESC LIMIT 5`).all();

    res.json({
      projects_by_stage: group(`SELECT stage k, COUNT(*) n FROM projects GROUP BY stage`),
      leads_by_status: group(`SELECT status k, COUNT(*) n FROM leads GROUP BY status`),
      leads_by_origin: group(`SELECT origin k, COUNT(*) n FROM leads GROUP BY origin`),
      new_leads_7d: db.prepare(`SELECT COUNT(*) n FROM leads WHERE created_at >= datetime('now','-7 days')`).get().n,
      shots_by_status: group(`SELECT status k, COUNT(*) n FROM shots GROUP BY status`),
      versions_pending: db.prepare(`SELECT v.id, v.label, v.kind, v.created_at, p.code, p.title FROM versions v JOIN projects p ON p.id = v.project_id WHERE v.status = 'en_revision' ORDER BY v.id DESC LIMIT 8`).all(),
      pipeline_usd: pipelineUsd,
      won_ytd_usd: wonYear.reduce((s, x) => s + toUSD(rates, x.total, x.currency), 0),
      upcoming_shoots: db.prepare(`SELECT s.id, s.date, s.call_time, s.type, s.location, s.scenes, s.status, p.code, p.title FROM shoots s JOIN projects p ON p.id = s.project_id
        WHERE s.date BETWEEN ? AND ? AND s.status != 'cancelado' ORDER BY s.date, s.call_time LIMIT 8`).all(today, in14),
      deliveries: db.prepare(`SELECT id, code, title, delivery_date, stage FROM projects WHERE delivery_date BETWEEN ? AND ? AND stage NOT IN ('entregado','distribucion','cancelado') ORDER BY delivery_date LIMIT 8`).all(today, in30),
      overdue_shots: db.prepare(`SELECT COUNT(*) n FROM shots WHERE due_date < ? AND status NOT IN ('aprobado')`).get(today).n,
      contracts_expiring: db.prepare(`SELECT id, title, party_name, end_date, status FROM contracts WHERE end_date BETWEEN ? AND ? AND status IN ('firmado','enviado') ORDER BY end_date LIMIT 6`).all(today, in30),
      consent_alerts: consentAlerts,
      blocked_shots: blockedShots.slice(0, 8),
      budget_overruns: overruns,
    });
  });

  // ---------- Calendario unificado ----------
  r.get('/calendar', requireRole(...STAFF), (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 8) + '01';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    const pid = Number(req.query.project_id) || null;
    if (req.query.project_id && (!Number.isInteger(pid) || pid <= 0)) throw new HttpError(400, 'Proyecto inválido');
    const pf = (col) => (pid ? ` AND ${col} = ?` : '');
    const args = pid ? [from, to, pid] : [from, to];
    const items = [
      ...db.prepare(`SELECT s.id, s.date AS start, s.call_time AS time, 'rodaje' AS kind, s.location || COALESCE(' · esc. ' || s.scenes, '') AS title, s.status, p.code, s.project_id
        FROM shoots s JOIN projects p ON p.id = s.project_id WHERE s.date BETWEEN ? AND ?${pf('s.project_id')}`).all(...args)
        .map((x) => ({ ...x, resource: 'shoots' })),
      ...db.prepare(`SELECT e.id, substr(e.start,1,10) AS start, substr(e.start,12,5) AS time, e.kind, e.title, NULL AS status, p.code, e.project_id
        FROM events e LEFT JOIN projects p ON p.id = e.project_id WHERE substr(e.start,1,10) BETWEEN ? AND ?${pf('e.project_id')}`).all(...args)
        .map((x) => ({ ...x, resource: 'events' })),
      ...db.prepare(`SELECT p.id, p.delivery_date AS start, NULL AS time, 'entrega' AS kind, 'Entrega: ' || p.title AS title, p.stage AS status, p.code, p.id AS project_id
        FROM projects p WHERE p.delivery_date BETWEEN ? AND ?${pf('p.id')}`).all(...args)
        .map((x) => ({ ...x, resource: 'projects' })),
      ...db.prepare(`SELECT s.id, s.due_date AS start, NULL AS time, 'vfx' AS kind, 'Plano ' || s.code AS title, s.status, p.code, s.project_id
        FROM shots s JOIN projects p ON p.id = s.project_id WHERE s.due_date BETWEEN ? AND ? AND s.status != 'aprobado'${pf('s.project_id')}`).all(...args)
        .map((x) => ({ ...x, resource: 'shots' })),
    ];
    items.sort((a, b) => (a.start + (a.time || '')).localeCompare(b.start + (b.time || '')));
    res.json({ from, to, items });
  });

  // Conflictos de agenda del equipo de rodaje / talento (mismo día, varios proyectos)
  r.get('/calendar/conflicts', requireRole('admin', 'productor'), (_req, res) => {
    const rows = db.prepare(`SELECT date, COUNT(DISTINCT project_id) projects, GROUP_CONCAT(DISTINCT location) locations
      FROM shoots WHERE status != 'cancelado' AND date >= date('now') GROUP BY date HAVING COUNT(DISTINCT project_id) > 1 ORDER BY date`).all();
    res.json({ conflicts: rows });
  });

  // ---------- Auditoría ----------
  r.get('/audit', requireRole('admin'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit);
    res.json({ rows });
  });

  r.get('/me', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: stripPrivate('users', { ...u }) });
  });

  r.put('/me/password', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), u.password_hash)) {
      throw new HttpError(422, 'La contraseña actual no es correcta', { current: 'Incorrecta' });
    }
    const err = validatePassword(req.body?.next);
    if (err) throw new HttpError(422, err, { next: err });
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(hashPassword(req.body.next), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, sha256(req.sessionToken || ''));
    audit(db, req, 'password_change', 'users', u.id);
    res.json({ ok: true });
  });

  return r;
}

