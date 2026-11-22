// Conectores con el ecosistema: LibroSeller (libros/autores) y CineViral (difusión y captación).
//
// Entrante:  POST /api/hooks/:provider   firmado con HMAC-SHA256 (cabecera X-Signature: sha256=<hex>)
//            cabecera X-Event-Id para idempotencia.
// Saliente:  POST /api/integrations/:provider/publish   publica una versión aprobada (tráiler, teaser…)
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { HttpError, validate } from '../validate.js';
import { audit } from '../db.js';

export const PROVIDERS = {
  libroseller: {
    name: 'LibroSeller',
    inbound: ['book.adaptation_request', 'book.trailer_order', 'ping'],
    outbound: ['trailer.publish'],
  },
  cineviral: {
    name: 'CineViral',
    inbound: ['lead.captured', 'metrics.update', 'ping'],
    outbound: ['video.publish'],
  },
};

export function ensurePublicationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL,
    caption TEXT,
    external_id TEXT,
    external_url TEXT,
    status TEXT NOT NULL,
    views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, shares INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, leads INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export const sign = (secret, body) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function logEvent(db, provider, direction, type, payload, status, response, externalId) {
  db.prepare(`INSERT INTO integration_events(provider, direction, event_type, payload, status, response, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(provider, direction, type, JSON.stringify(payload).slice(0, 20000), status, response ? String(response).slice(0, 2000) : null, externalId || null);
  db.prepare(`UPDATE integrations SET last_event_at = datetime('now') WHERE provider = ?`).run(provider);
}

function createLead(db, data) {
  const clean = validate(db, 'leads', data);
  const cols = Object.keys(clean);
  const info = db.prepare(`INSERT INTO leads(${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => clean[c]));
  return Number(info.lastInsertRowid);
}

const HANDLERS = {
  libroseller: {
    'book.adaptation_request'(db, p) {
      const b = p.book || {}; const c = p.contact || {};
      const id = createLead(db, {
        name: c.name || b.author, email: c.email, phone: c.phone, country: c.country,
        service: ['largometraje', 'cortometraje', 'serie'].includes(p.format) ? p.format : 'largometraje',
        source_type: 'novela', origin: 'libroseller', budget_range: 'por_definir',
        message: [`Adaptación solicitada desde LibroSeller`, b.title && `Libro: «${b.title}»`, b.author && `Autor/a: ${b.author}`,
          b.isbn && `ISBN: ${b.isbn}`, b.url && `Ficha: ${b.url}`, b.synopsis && `Sinopsis: ${b.synopsis}`, p.notes].filter(Boolean).join('\n').slice(0, 5000),
      });
      return { lead_id: id };
    },
    'book.trailer_order'(db, p) {
      const b = p.book || {}; const c = p.contact || {};
      const id = createLead(db, {
        name: c.name || b.author, email: c.email, phone: c.phone, country: c.country,
        service: 'trailer_libro', source_type: 'novela', origin: 'libroseller',
        budget_range: p.package_price && p.package_price < 5000 ? '<5k' : 'por_definir',
        message: [`Booktrailer pedido en LibroSeller`, b.title && `Libro: «${b.title}»`, b.author && `Autor/a: ${b.author}`,
          b.isbn && `ISBN: ${b.isbn}`, p.package && `Paquete: ${p.package}`, b.synopsis && `Sinopsis: ${b.synopsis}`].filter(Boolean).join('\n').slice(0, 5000),
      });
      return { lead_id: id };
    },
    ping: () => ({ pong: true }),
  },
  cineviral: {
    'lead.captured'(db, p) {
      const id = createLead(db, {
        name: p.name, email: p.email, phone: p.phone, country: p.country, company: p.company,
        service: p.service || 'otro', source_type: p.source_type || 'idea', origin: 'cineviral',
        message: [p.campaign && `Campaña CineViral: ${p.campaign}`, p.message].filter(Boolean).join('\n'),
      });
      if (p.publication_id) db.prepare(`UPDATE publications SET leads = leads + 1, updated_at = datetime('now') WHERE id = ? AND provider = 'cineviral'`).run(Number(p.publication_id));
      return { lead_id: id };
    },
    'metrics.update'(db, p) {
      const pub = db.prepare(`SELECT * FROM publications WHERE provider = 'cineviral' AND (id = ? OR external_id = ?)`).get(Number(p.publication_id) || -1, String(p.external_id || ''));
      if (!pub) throw new HttpError(404, 'Publicación desconocida');
      const n = (v, prev) => (Number.isInteger(v) && v >= 0 ? v : prev);
      db.prepare(`UPDATE publications SET views = ?, likes = ?, shares = ?, clicks = ?, external_url = COALESCE(?, external_url), updated_at = datetime('now') WHERE id = ?`)
        .run(n(p.views, pub.views), n(p.likes, pub.likes), n(p.shares, pub.shares), n(p.clicks, pub.clicks), p.url || null, pub.id);
      return { publication_id: pub.id };
    },
    ping: () => ({ pong: true }),
  },
};

/** Webhook entrante. Se monta ANTES del parser JSON porque necesita el cuerpo sin procesar para verificar la firma. */
export function inboundHandler(db) {
  return (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) throw new HttpError(404, 'Proveedor desconocido');
    const cfg = db.prepare('SELECT * FROM integrations WHERE provider = ?').get(provider);
    if (!cfg?.enabled || !cfg.secret) throw new HttpError(503, 'Integración desactivada');
    const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
    if (!safeEqual(req.get('x-signature') || '', sign(cfg.secret, raw))) {
      logEvent(db, provider, 'in', 'invalid_signature', { ip: req.ip }, 'rechazado');
      throw new HttpError(401, 'Firma inválida');
    }
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
    const type = String(payload.type || '');
    const handler = HANDLERS[provider][type];
    if (!handler) throw new HttpError(422, `Evento no soportado: ${type}`);
    const eventId = String(req.get('x-event-id') || payload.id || '').slice(0, 120) || null;
    if (eventId && db.prepare(`SELECT 1 FROM integration_events WHERE provider = ? AND direction = 'in' AND external_id = ?`).get(provider, eventId)) {
      return res.json({ ok: true, duplicate: true });
    }
    try {
      const result = handler(db, payload.data || {});
      logEvent(db, provider, 'in', type, payload, 'procesado', JSON.stringify(result), eventId);
      res.json({ ok: true, ...result });
    } catch (e) {
      logEvent(db, provider, 'in', type, payload, 'error', e.message, null);
      throw e;
    }
  };
}

export function integrationsRouter(db) {
  const r = Router();
  const mask = (row) => ({ ...row, secret: undefined, has_secret: !!row.secret, name: PROVIDERS[row.provider]?.name, events: PROVIDERS[row.provider] });

  r.get('/integrations', requireRole('admin', 'ventas', 'productor'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM integrations ORDER BY provider').all().map(mask);
    const events = db.prepare('SELECT * FROM integration_events ORDER BY id DESC LIMIT 50').all();
    const publications = db.prepare(`SELECT pu.*, p.code, p.title, v.label AS version_label FROM publications pu
      LEFT JOIN projects p ON p.id = pu.project_id LEFT JOIN versions v ON v.id = pu.version_id ORDER BY pu.id DESC LIMIT 50`).all();
    res.json({ integrations: rows, events, publications });
  });

  r.put('/integrations/:provider', requireRole('admin'), (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) throw new HttpError(404, 'Proveedor desconocido');
    const updates = {};
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled ? 1 : 0;
    if (req.body.endpoint_url !== undefined) {
      const v = String(req.body.endpoint_url || '').trim();
      if (v) {
        let u;
        try { u = new URL(v); } catch { throw new HttpError(422, 'URL de destino inválida'); }
        if (u.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new HttpError(422, 'En producción la URL de destino debe ser HTTPS');
        if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(422, 'URL de destino inválida');
      }
      updates.endpoint_url = v || null;
    }
    let secret;
    if (req.body.rotate_secret) {
      secret = crypto.randomBytes(32).toString('base64url');
      updates.secret = secret;
    }
    const cols = Object.keys(updates);
    if (cols.length) db.prepare(`UPDATE integrations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE provider = ?`).run(...cols.map((c) => updates[c]), provider);
    audit(db, req, 'update', 'integrations', null, { provider, fields: cols });
    const row = mask(db.prepare('SELECT * FROM integrations WHERE provider = ?').get(provider));
    res.json({ integration: row, secret }); // el secreto sólo se muestra una vez
  });

  async function deliver(provider, pubId) {
    const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(pubId);
    const v = db.prepare(`SELECT v.*, p.title, p.code, p.source_ref FROM versions v JOIN projects p ON p.id = v.project_id WHERE v.id = ?`).get(pub.version_id);
    const cfg = db.prepare('SELECT * FROM integrations WHERE provider = ?').get(provider);
    const type = PROVIDERS[provider].outbound[0];
    const payload = {
      id: `cls-pub-${pubId}`, type, created_at: new Date().toISOString(),
      data: { publication_id: pubId, project_code: v?.code, title: v?.title, caption: pub.caption, media_url: v?.url, kind: v?.kind, source_ref: v?.source_ref },
    };
    let status = 'en_cola'; let response = 'Integración no configurada: queda en cola hasta activarla';
    if (cfg?.enabled && cfg.endpoint_url && cfg.secret) {
      const body = JSON.stringify(payload);
      try {
        const out = await fetch(cfg.endpoint_url, {
          method: 'POST', body, signal: AbortSignal.timeout(8000), redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-signature': sign(cfg.secret, body), 'x-event-id': payload.id, 'user-agent': 'CineLibroSellerStudios/0.1' },
        });
        const text = (await out.text()).slice(0, 2000);
        status = out.ok ? 'enviado' : 'error';
        response = `${out.status} ${text}`;
        if (out.ok) {
          try {
            const j = JSON.parse(text);
            db.prepare('UPDATE publications SET external_id = ?, external_url = ? WHERE id = ?').run(j.id ? String(j.id) : null, typeof j.url === 'string' ? j.url : null, pubId);
          } catch { /* respuesta no JSON */ }
        }
      } catch (e) {
        status = 'error'; response = e.message;
      }
    }
    db.prepare(`UPDATE publications SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, pubId);
    logEvent(db, provider, 'out', type, payload, status, response, `${payload.id}-${Date.now()}`);
    return { publication_id: pubId, status, response };
  }

  r.post('/integrations/:provider/publish', requireRole('admin', 'ventas', 'productor'), async (req, res) => {
    const provider = req.params.provider;
    if (!PROVIDERS[provider]) throw new HttpError(404, 'Proveedor desconocido');
    const v = db.prepare(`SELECT v.*, p.title, p.logline FROM versions v JOIN projects p ON p.id = v.project_id WHERE v.id = ?`).get(Number(req.body?.version_id));
    if (!v) throw new HttpError(404, 'Versión no encontrada');
    if (v.status !== 'aprobado') throw new HttpError(409, 'Sólo se pueden publicar versiones aprobadas');
    const caption = String(req.body?.caption || v.logline || v.title).slice(0, 2000);
    const info = db.prepare(`INSERT INTO publications(provider, project_id, version_id, caption, status, created_by) VALUES (?, ?, ?, ?, 'en_cola', ?)`)
      .run(provider, v.project_id, v.id, caption, req.user.id);
    const out = await deliver(provider, Number(info.lastInsertRowid));
    audit(db, req, 'publish', 'versions', v.id, { provider, status: out.status });
    res.status(out.status === 'error' ? 502 : 201).json(out);
  });

  // Reintenta una publicación en cola o con error
  r.post('/integrations/:provider/retry/:id', requireRole('admin', 'ventas', 'productor'), async (req, res) => {
    const pub = db.prepare('SELECT * FROM publications WHERE id = ? AND provider = ?').get(Number(req.params.id), req.params.provider);
    if (!pub) throw new HttpError(404, 'Publicación no encontrada');
    if (pub.status === 'enviado') throw new HttpError(409, 'Ya fue enviada');
    const out = await deliver(pub.provider, pub.id);
    audit(db, req, 'publish_retry', 'publications', pub.id, { status: out.status });
    res.status(out.status === 'error' ? 502 : 200).json(out);
  });

  return r;
}
