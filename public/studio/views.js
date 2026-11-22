import {
  api, html, raw, $, $$, state, label, money, fmtDate, relDays, badge, toast, drawer, canDo, errorMessage, showErrors, invalidateRefs,
} from './core.js';
import { resourceList, openEditor } from './resources.js';

const usd = (n) => money(n, 'USD', { compact: true });

// ---------- Gráficos SVG (una serie por gráfico salvo flujo de caja) ----------
function hbars(items, { fmt = (v) => v, cls = 's1' } = {}) {
  if (!items.length) return html`<p class="empty">Sin datos</p>`;
  const max = Math.max(...items.map((i) => i.value), 1);
  const rowH = 26; const labelW = 120; const W = 420; const barW = W - labelW - 60;
  const h = items.length * rowH;
  return html`<div class="chart"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Gráfico de barras">
    ${items.map((it, i) => {
      const w = Math.max((it.value / max) * barW, it.value ? 3 : 0);
      const y = i * rowH;
      return html`<text class="axis-label" x="${labelW - 8}" y="${y + 16}" text-anchor="end">${it.label}</text>
        <rect class="bar" x="${labelW}" y="${y + 6}" width="${w}" height="14" rx="4" fill="var(--series-1)" data-tip="${it.label}: ${fmt(it.value)}"></rect>
        <text class="value-label" x="${labelW + w + 6}" y="${y + 17}">${fmt(it.value)}</text>`;
    })}</svg></div>`;
}

function cashflowChart(rows) {
  if (!rows.length) return html`<p class="empty">Sin movimientos registrados este año</p>`;
  const W = 560; const H = 200; const pad = { l: 56, b: 24, t: 8 };
  const max = Math.max(...rows.flatMap((r) => [r.ingreso, r.egreso]), 1);
  const slot = (W - pad.l) / rows.length; const bw = Math.min(18, slot / 3);
  const y = (v) => H - pad.b - (v / max) * (H - pad.b - pad.t);
  const ticks = [0, max / 2, max];
  return html`<div class="legend"><span><i class="s1"></i>Ingresos</span><span><i class="s2"></i>Egresos</span></div>
  <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Flujo de caja mensual en USD">
    ${ticks.map((t) => html`<line class="grid-line" x1="${pad.l}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line>
      <text class="axis-label" x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${usd(t)}</text>`)}
    ${rows.map((r, i) => {
      const x = pad.l + i * slot + slot / 2;
      const m = new Date(`${r.month}-15`).toLocaleDateString('es-DO', { month: 'short' });
      return html`<rect x="${x - bw - 1}" y="${y(r.ingreso)}" width="${bw}" height="${H - pad.b - y(r.ingreso)}" rx="3" fill="var(--series-1)" data-tip="${m} · ingresos ${usd(r.ingreso)}"></rect>
        <rect x="${x + 1}" y="${y(r.egreso)}" width="${bw}" height="${H - pad.b - y(r.egreso)}" rx="3" fill="var(--series-2)" data-tip="${m} · egresos ${usd(r.egreso)}"></rect>
        <text class="axis-label" x="${x}" y="${H - 6}" text-anchor="middle">${m}</text>`;
    })}</svg></div>`;
}

let tipEl;
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]');
  if (!t) { if (tipEl) tipEl.hidden = true; return; }
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip'; document.body.appendChild(tipEl); }
  tipEl.textContent = t.dataset.tip;
  tipEl.hidden = false;
  tipEl.style.left = `${e.clientX + 12}px`;
  tipEl.style.top = `${e.clientY + 12}px`;
});

const STAGES = ['desarrollo', 'preproduccion', 'rodaje', 'postproduccion', 'vfx', 'revision', 'entregado', 'distribucion'];

// ---------- Tablero ----------
export async function dashboardView(el) {
  const d = await api('/dashboard');
  const active = STAGES.slice(0, 6).reduce((s, k) => s + (d.projects_by_stage[k] || 0), 0);
  const shotsOpen = ['pendiente', 'en_proceso', 'revision', 'bloqueado'].reduce((s, k) => s + (d.shots_by_status[k] || 0), 0);
  const alerts = d.blocked_shots.length + d.consent_alerts.length;
  el.innerHTML = String(html`
  <div class="page-head"><div><h1>Tablero del estudio</h1><p>Estado de producción, comercial y riesgos al ${fmtDate(new Date().toISOString().slice(0, 10))}</p></div>
    <div class="btn-row">${canDo('leads', 'read') ? html`<a class="btn" href="#/r/leads">Solicitudes</a>` : ''}${canDo('projects', 'write') ? html`<a class="btn primary" href="#/projects">Proyectos</a>` : ''}</div></div>
  <div class="tiles">
    <div class="tile"><div class="label">Proyectos activos</div><div class="value">${active}</div><div class="sub">${d.projects_by_stage.entregado || 0} entregados</div></div>
    <div class="tile"><div class="label">Pipeline comercial</div><div class="value">${usd(d.pipeline_usd)}</div><div class="sub">negocios abiertos (USD)</div></div>
    <div class="tile"><div class="label">Ganado en el año</div><div class="value">${usd(d.won_ytd_usd)}</div><div class="sub">contratos cerrados</div></div>
    <div class="tile"><div class="label">Solicitudes nuevas</div><div class="value">${d.new_leads_7d}</div><div class="sub">últimos 7 días</div></div>
    <div class="tile"><div class="label">Planos VFX abiertos</div><div class="value">${shotsOpen}</div><div class="sub">${d.overdue_shots ? `${d.overdue_shots} vencidos` : 'ninguno vencido'}</div></div>
    <div class="tile"><div class="label">Alertas de derechos</div><div class="value">${alerts}</div><div class="sub">consentimientos de imagen / voz</div></div>
  </div>
  <div class="grid cols-3">
    <div class="card"><div class="card-head"><h3>Proyectos por etapa</h3></div>
      ${hbars(STAGES.map((s) => ({ label: label(s), value: d.projects_by_stage[s] || 0 })))}</div>
    <div class="card"><div class="card-head"><h3>Embudo de solicitudes</h3><a class="small" href="#/r/leads">ver</a></div>
      ${hbars(['nuevo', 'contactado', 'propuesta', 'negociacion', 'ganado', 'perdido'].map((s) => ({ label: label(s), value: d.leads_by_status[s] || 0 })))}</div>
    <div class="card"><div class="card-head"><h3>Origen de solicitudes</h3></div>
      ${hbars(['web', 'cineviral', 'libroseller', 'referido', 'manual'].map((s) => ({ label: label(s), value: d.leads_by_origin[s] || 0 })))}</div>
  </div>
  <div class="grid cols-2" data-gap>
    <div class="card"><div class="card-head"><h3>Próximos rodajes (14 días)</h3><a class="small" href="#/calendar">calendario</a></div>
      ${d.upcoming_shoots.length ? html`<ul class="list">${d.upcoming_shoots.map((s) => html`<li><div><b>${s.location}</b><div class="meta">${s.code} · ${s.title} · esc. ${s.scenes || '—'} · ${label(s.type)}</div></div>
        <div class="num">${fmtDate(s.date)} ${s.call_time || ''}<div class="meta">${relDays(s.date)}</div></div></li>`)}</ul>` : html`<p class="empty">Sin rodajes programados</p>`}</div>
    <div class="card"><div class="card-head"><h3>Versiones esperando revisión</h3></div>
      ${d.versions_pending.length ? html`<ul class="list">${d.versions_pending.map((v) => html`<li><div><a href="#/review/${v.id}"><b>${v.label}</b></a><div class="meta">${v.code} · ${v.title}</div></div>
        <div>${badge(v.kind)}</div></li>`)}</ul>` : html`<p class="empty">Todo revisado</p>`}</div>
    <div class="card"><div class="card-head"><h3>Riesgos de derechos de imagen y voz</h3></div>
      ${d.blocked_shots.length || d.consent_alerts.length ? html`<ul class="list">
        ${d.blocked_shots.map((s) => html`<li><div><span class="sev alta">Bloqueado</span> Plano <b>${s.code}</b><div class="meta">${s.issues.join(' · ')}</div></div></li>`)}
        ${d.consent_alerts.map((t) => html`<li><div><b>${t.name}</b><div class="meta">imagen: ${label(t.likeness_consent)} · voz: ${label(t.voice_consent)}${t.consent_expires ? ` · vence ${fmtDate(t.consent_expires)}` : ''}</div></div><div>${badge(t.likeness_consent)}</div></li>`)}
      </ul>` : html`<p class="empty">Sin alertas</p>`}</div>
    <div class="card"><div class="card-head"><h3>Entregas y contratos (30 días)</h3></div>
      ${d.deliveries.length || d.contracts_expiring.length || d.budget_overruns.length ? html`<ul class="list">
        ${d.deliveries.map((p) => html`<li><div><a href="#/projects/${p.id}"><b>${p.title}</b></a><div class="meta">${p.code} · entrega</div></div><div class="num">${fmtDate(p.delivery_date)}<div class="meta">${relDays(p.delivery_date)}</div></div></li>`)}
        ${d.contracts_expiring.map((c) => html`<li><div><b>${c.party_name}</b><div class="meta">${c.title} · vence</div></div><div class="num">${fmtDate(c.end_date)}</div></li>`)}
        ${d.budget_overruns.map((o) => html`<li><div><a href="#/projects/${o.id}"><b>${o.title}</b></a><div class="meta">sobrecosto</div></div><div class="num"><span class="sev alta">+${money(o.actual - o.planned, o.currency)}</span></div></li>`)}
      </ul>` : html`<p class="empty">Nada pendiente</p>`}</div>
  </div>`);
  $('[data-gap]', el).style.marginTop = '16px';
}

// ---------- Proyectos (tablero kanban + lista) ----------
async function renderBoard(target, writable, refresh) {
  const d = await api('/r/projects?limit=500&sort=delivery_date&dir=asc');
  target.innerHTML = String(html`<div class="kanban">${STAGES.map((s) => {
    const items = d.rows.filter((p) => p.stage === s);
    return html`<div class="lane" data-stage="${s}"><div class="lane-head"><span>${label(s)}</span><span>${items.length}</span></div>
      ${items.map((p) => html`<div class="kcard" draggable="${writable}" data-id="${p.id}"><b>${p.title}</b>
        <div class="meta"><span>${p.code}</span><span>${label(p.production_mode)}</span></div>
        <div class="meta"><span>${d.labels.client_id?.[p.client_id] || 'Sin cliente'}</span><span>${p.delivery_date ? fmtDate(p.delivery_date) : ''}</span></div></div>`)}
    </div>`;
  })}</div>`);
  target.addEventListener('click', (e) => { const c = e.target.closest('.kcard'); if (c) location.hash = `#/projects/${c.dataset.id}`; });
  if (!writable) return;
  let dragId = null;
  $$('.kcard', target).forEach((c) => c.addEventListener('dragstart', (e) => { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; }));
  $$('.lane', target).forEach((lane) => {
    lane.addEventListener('dragover', (e) => { e.preventDefault(); lane.classList.add('drop'); });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop'));
    lane.addEventListener('drop', async (e) => {
      e.preventDefault(); lane.classList.remove('drop');
      if (!dragId) return;
      try {
        await api(`/r/projects/${dragId}`, { method: 'PUT', body: { stage: lane.dataset.stage } });
        invalidateRefs('projects');
        toast(`Movido a ${label(lane.dataset.stage)}`);
        refresh();
      } catch (err) { toast(errorMessage(err), 'bad'); }
    });
  });
}

export async function projectsView(el) {
  const writable = canDo('projects', 'write');
  const isClient = state.user.role === 'cliente';
  let mode = isClient ? 'list' : (localStorage.getItem('cls.projects.mode') || 'board');
  el.innerHTML = String(html`<div class="page-head"><div><h1>${isClient ? 'Mis proyectos' : 'Proyectos'}</h1>
    <p>${isClient ? 'Producciones en curso con Cine LibroSeller Studios.' : writable ? 'Arrastra una tarjeta para cambiar de etapa.' : 'Vista de proyectos del estudio.'}</p></div>
    <div class="btn-row">${isClient ? '' : html`<button class="btn" data-mode="board">Tablero</button><button class="btn" data-mode="list">Lista</button>`}
    ${writable ? html`<button class="btn primary" data-new>+ Proyecto</button>` : ''}</div></div><div data-area></div>`);

  async function render() {
    try { localStorage.setItem('cls.projects.mode', mode); } catch { /* almacenamiento no disponible */ }
    $$('[data-mode]', el).forEach((b) => b.classList.toggle('primary', b.dataset.mode === mode));
    const old = $('[data-area]', el);
    const area = old.cloneNode(false); // contenedor nuevo: sin escuchadores acumulados
    old.replaceWith(area);
    if (mode === 'board') await renderBoard(area, writable, render);
    else {
      await resourceList(area, 'projects', {
        readonly: true,
        onOpen: (id) => { location.hash = isClient ? `#/r/versions?project_id=${id}` : `#/projects/${id}`; },
      });
    }
  }
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; render(); }
    if (e.target.closest('[data-new]')) openEditor('projects', null, { onSaved: (row) => { if (row) location.hash = `#/projects/${row.id}`; } });
  });
  await render();
}

// ---------- Ficha de proyecto ----------
const PROJECT_TABS = [
  ['resumen', 'Resumen'], ['characters', 'Personajes'], ['shoots', 'Rodajes'], ['shots', 'Planos VFX / IA'],
  ['continuity', 'Continuidad'], ['budget_items', 'Presupuesto'], ['contracts', 'Contratos'], ['versions', 'Versiones'], ['deals', 'Ventas'],
];

export async function projectView(el, id, tab = 'resumen') {
  const s = await api(`/projects/${id}/summary`);
  const p = s.project;
  const tabs = PROJECT_TABS.filter(([k]) => k === 'resumen' || canDo(k, 'read'));
  el.innerHTML = String(html`
    <div class="page-head"><div><p class="small muted">${p.code} · ${label(p.format)} · ${label(p.production_mode)}</p><h1>${p.title}</h1>
      <p>${s.client ? `Cliente: ${s.client.name}` : 'Sin cliente asignado'} · ${s.producer ? `Producción: ${s.producer.name}` : 'Sin productor asignado'}</p></div>
      <div class="btn-row">${badge(p.stage)}${canDo('projects', 'write') ? html`<button class="btn" data-edit>Editar proyecto</button>` : ''}</div></div>
    <nav class="tabs">${tabs.map(([k, l]) => html`<a href="#/projects/${p.id}/${k}" class="${k === tab ? 'active' : ''}">${l}${k !== 'resumen' && s.counts[k] !== undefined ? html`<span class="count">${s.counts[k]}</span>` : ''}</a>`)}</nav>
    <div data-tab></div>`);
  $('[data-edit]', el)?.addEventListener('click', () => openEditor('projects', p.id, { onSaved: () => projectView(el, id, tab) }));
  const box = $('[data-tab]', el);
  if (tab === 'resumen') return projectSummary(box, s);
  if (tab === 'continuity') {
    box.innerHTML = String(html`<div class="card" data-report><div class="card-head"><h3>Control de continuidad y derechos</h3><button class="btn" data-run>Analizar</button></div><p class="muted small">Revisa fichas sin bloquear, personajes sin perfil de voz o vestuario, planos IA sin consentimiento y contratos sin cláusula de IA.</p><div data-findings></div></div><div data-list></div>`);
    $('[data-list]', box).style.marginTop = '16px';
    const run = async () => {
      const r = await api(`/projects/${p.id}/continuity-report`);
      $('[data-findings]', box).innerHTML = String(r.findings.length ? html`<ul class="list">${r.findings.map((f) => html`<li><div><span class="sev ${f.severity}">${f.severity}</span> <b>${f.area}</b> — ${f.message}</div>
        <button class="btn ghost small" data-open="${f.ref.resource}:${f.ref.id}">Abrir</button></li>`)}</ul>` : html`<div class="alert good">Sin hallazgos: ${r.totals.locked}/${r.totals.bible} fichas bloqueadas.</div>`);
    };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-run]')) run();
      const o = e.target.closest('[data-open]');
      if (o) { const [res, rid] = o.dataset.open.split(':'); openEditor(res, Number(rid), { onSaved: run }); }
    });
    run();
    return resourceList($('[data-list]', box), 'continuity', { fixed: { project_id: p.id } });
  }
  const opts = { fixed: { project_id: p.id } };
  if (tab === 'versions') opts.onOpen = (vid) => { location.hash = `#/review/${vid}`; };
  if (tab === 'versions' && canDo('versions', 'write')) {
    opts.extraActions = html`<span class="muted small">Haz clic en una versión para abrir la sala de revisión</span>`;
  }
  return resourceList(box, tab, opts);
}

function projectSummary(box, s) {
  const p = s.project; const f = s.finance;
  const shotTotal = Object.values(s.shot_status).reduce((a, b) => a + b, 0);
  const approved = s.shot_status.aprobado || 0;
  box.innerHTML = String(html`
    <div class="tiles">
      <div class="tile"><div class="label">Entrega</div><div class="value">${p.delivery_date ? fmtDate(p.delivery_date) : '—'}</div><div class="sub">${p.delivery_date ? relDays(p.delivery_date) : 'sin fecha'}</div></div>
      <div class="tile"><div class="label">Planos VFX aprobados</div><div class="value">${approved}/${shotTotal}</div><div class="sub">${s.shot_status.revision || 0} en revisión</div></div>
      ${f ? html`<div class="tile"><div class="label">Ingreso pactado</div><div class="value">${money(f.revenue, f.currency, { compact: true })}</div><div class="sub">cobrado ${money(f.received, f.currency, { compact: true })}</div></div>
      <div class="tile"><div class="label">Margen actual</div><div class="value">${f.margin_pct === null ? '—' : `${Math.round(f.margin_pct)} %`}</div><div class="sub">${money(f.margin, f.currency, { compact: true })} · proyectado ${money(f.projected_margin, f.currency, { compact: true })}</div></div>` : ''}
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Ficha</h3></div>
        <p>${p.logline || html`<span class="muted">Sin logline</span>`}</p>
        <ul class="list">
          <li><span class="muted">Material de partida</span><span>${label(p.source_type)}${p.source_ref ? ` · ${p.source_ref}` : ''}</span></li>
          <li><span class="muted">Inicio</span><span>${fmtDate(p.start_date)}</span></li>
          <li><span class="muted">Próximo rodaje</span><span>${s.next_shoot ? `${fmtDate(s.next_shoot.date)} · ${s.next_shoot.location}` : '—'}</span></li>
          <li><span class="muted">Última versión</span><span>${s.last_version ? html`<a href="#/review/${s.last_version.id}">${s.last_version.label}</a> ${badge(s.last_version.status)}` : '—'}</span></li>
        </ul></div>
      ${f ? html`<div class="card"><div class="card-head"><h3>Presupuesto por categoría</h3><span class="small muted">${money(f.actual, f.currency)} de ${money(f.planned, f.currency)}</span></div>
        ${f.by_category.length ? html`<ul class="list">${f.by_category.map((c) => html`<li><div class="spacer"><div>${label(c.category)}</div>
          <div class="meter" data-pct="${c.planned ? Math.min(c.actual / c.planned, 1) : (c.actual ? 1 : 0)}" data-over="${c.actual > c.planned ? 1 : 0}"><div></div></div></div>
          <div class="num small">${money(c.actual, f.currency)}<div class="meta">de ${money(c.planned, f.currency)}</div></div></li>`)}</ul>` : html`<p class="empty">Sin partidas. <a href="#/projects/${p.id}/budget_items">Añadir presupuesto</a></p>`}
        ${f.overrun ? html`<div class="alert bad">Sobrecosto de ${money(f.overrun, f.currency)} sobre lo presupuestado.</div>` : ''}</div>` : ''}
    </div>`);
  $$('.meter', box).forEach((m) => {
    const bar = m.firstElementChild;
    bar.style.width = `${Math.round(Number(m.dataset.pct) * 100)}%`;
    if (m.dataset.over === '1') bar.classList.add('over');
  });
}

// ---------- Sala de revisión ----------
const isVideo = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u || '');
export async function reviewView(el, id) {
  const d = await api(`/versions/${id}/review`);
  const v = d.version;
  const canDecide = ['admin', 'productor', 'cliente'].includes(state.user.role) && v.status !== 'aprobado';
  const canResolve = ['admin', 'productor', 'vfx'].includes(state.user.role);
  const canPublish = v.status === 'aprobado' && ['admin', 'productor', 'ventas'].includes(state.user.role);
  el.innerHTML = String(html`
    <div class="page-head"><div><p class="small muted">${v.project_code} · ${v.project_title}</p><h1>${v.label}</h1><p>${label(v.kind)} · enviada ${fmtDate(v.created_at, true)}</p></div>
      <div class="btn-row">${badge(v.status)}</div></div>
    <div class="review">
      <div>
        <div class="player">${isVideo(v.url) ? html`<video controls preload="metadata" src="${v.url}" data-video></video>`
          : html`<div class="nofile"><p>Vista previa no disponible para este enlace.</p><a class="btn" href="${v.url}" target="_blank" rel="noopener noreferrer">Abrir archivo ↗</a></div>`}</div>
        ${v.notes ? html`<div class="card" data-gap><h3>Notas de entrega</h3><p>${v.notes}</p></div>` : ''}
        ${canDecide ? html`<div class="card" data-gap><h3>Decisión</h3><textarea data-comment placeholder="Comentario general (obligatorio si pides cambios y no hay notas abiertas)"></textarea>
          <div class="btn-row" data-gap><button class="btn primary" data-decide="aprobado">Aprobar versión</button><button class="btn" data-decide="cambios_solicitados">Solicitar cambios</button></div></div>` : ''}
        ${canPublish ? html`<div class="card" data-gap><h3>Distribuir</h3><p class="muted small">Publica esta versión aprobada en el ecosistema. Las métricas de CineViral volverán a este panel.</p>
          <div class="btn-row"><button class="btn" data-publish="cineviral">Publicar en CineViral</button><button class="btn" data-publish="libroseller">Enviar a LibroSeller</button></div></div>` : ''}
      </div>
      <div class="card"><div class="card-head"><h3>Notas (${d.notes.length})</h3></div>
        ${v.status !== 'aprobado' ? html`<form data-note class="btn-row"><input type="text" name="timecode" placeholder="00:00:00" class="tc-in" aria-label="Timecode">
          <input type="text" name="note" placeholder="Escribe una nota…" required aria-label="Nota"><button class="btn primary">Añadir</button></form>
          <p class="small muted">${isVideo(v.url) ? 'El timecode se toma del reproductor al escribir.' : ''}</p>` : ''}
        <div data-notes>${d.notes.length ? d.notes.map((n) => html`<div class="note ${n.resolved ? 'resolved' : ''}">
          <div class="btn-row">${n.timecode ? html`<span class="tc" data-seek="${n.timecode}">${n.timecode}</span>` : ''}<span class="who">${n.author || 'Usuario'} · ${label(n.author_role)} · ${fmtDate(n.created_at, true)}</span>
          ${canResolve ? html`<button class="btn ghost small" data-resolve="${n.id}" data-val="${n.resolved ? 0 : 1}">${n.resolved ? 'Reabrir' : 'Resuelta'}</button>` : ''}</div>
          <div>${n.note}</div></div>`) : html`<p class="empty">Sin notas todavía</p>`}</div>
        <h3 data-gap>Historial de versiones</h3>
        <ul class="list">${d.history.map((h) => html`<li><a href="#/review/${h.id}">${h.label}</a><span>${badge(h.status)}</span></li>`)}</ul>
      </div>
    </div>`);
  $$('[data-gap]', el).forEach((x) => { x.style.marginTop = '14px'; });
  $$('.tc-in', el).forEach((x) => { x.style.maxWidth = '100px'; });
  const video = $('[data-video]', el);
  const fmtTc = (t) => [Math.floor(t / 3600), Math.floor((t % 3600) / 60), Math.floor(t % 60)].map((n) => String(n).padStart(2, '0')).join(':');
  const form = $('[data-note]', el);
  form?.note.addEventListener('focus', () => { if (video && !form.timecode.value) form.timecode.value = fmtTc(video.currentTime); });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/versions/${id}/notes`, { method: 'POST', body: { note: form.note.value, timecode: form.timecode.value } }); reviewView(el, id); } catch (err) { toast(errorMessage(err), 'bad'); }
  });
  el.addEventListener('click', async (e) => {
    const seek = e.target.closest('[data-seek]');
    if (seek && video) { const p = seek.dataset.seek.split(':').map(Number); video.currentTime = p.reduce((a, b) => a * 60 + b, 0); video.play(); }
    const r = e.target.closest('[data-resolve]');
    if (r) { await api(`/notes/${r.dataset.resolve}/resolve`, { method: 'PUT', body: { resolved: r.dataset.val === '1' } }); reviewView(el, id); }
    const dec = e.target.closest('[data-decide]');
    if (dec) {
      if (dec.dataset.decide === 'aprobado' && !confirm('¿Aprobar esta versión? Quedará cerrada para nuevas notas.')) return;
      try { await api(`/versions/${id}/decision`, { method: 'POST', body: { decision: dec.dataset.decide, comment: $('[data-comment]', el).value } }); toast('Decisión registrada'); reviewView(el, id); } catch (err) { toast(errorMessage(err), 'bad'); }
    }
    const pub = e.target.closest('[data-publish]');
    if (pub) {
      try { const out = await api(`/integrations/${pub.dataset.publish}/publish`, { method: 'POST', body: { version_id: id } }); toast(out.status === 'enviado' ? 'Publicado' : 'En cola: la integración aún no está configurada'); } catch (err) { toast(errorMessage(err), 'bad'); }
    }
  });
}

// ---------- Calendario ----------
export async function calendarView(el, monthStr) {
  const now = new Date();
  const [y, m] = (monthStr && /^\d{4}-\d{2}$/.test(monthStr) ? monthStr : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // lunes
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const data = await api(`/calendar?from=${iso(days[0])}&to=${iso(days[41])}`);
  const byDay = {};
  for (const it of data.items) (byDay[it.start] ??= []).push(it);
  const prev = new Date(y, m - 2, 1); const next = new Date(y, m, 1);
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const today = iso(now);
  let conflicts = [];
  if (['admin', 'productor'].includes(state.user.role)) conflicts = (await api('/calendar/conflicts')).conflicts;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${first.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })}</h1><p>Rodajes, eventos, entregas y vencimientos de planos en una sola agenda.</p></div>
      <div class="btn-row"><a class="btn" href="#/calendar/${ym(prev)}">←</a><a class="btn" href="#/calendar">Hoy</a><a class="btn" href="#/calendar/${ym(next)}">→</a>
      ${canDo('events', 'write') ? html`<button class="btn primary" data-new>+ Evento</button>` : ''}</div></div>
    ${conflicts.length ? html`<div class="alert warn">Días con rodajes de varios proyectos: ${conflicts.map((c) => `${fmtDate(c.date)} (${c.locations})`).join(' · ')}</div>` : ''}
    <div class="cal-legend"><span class="rodaje">Rodaje</span><span class="evento">Reunión / casting / revisión</span><span class="vfx">Plano VFX vence</span><span class="entrega">Entrega</span></div>
    <div class="cal">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => html`<div class="dow">${d}</div>`)}
      ${days.map((d) => html`<div class="day ${d.getMonth() !== m - 1 ? 'out' : ''} ${iso(d) === today ? 'today' : ''}"><div class="n">${d.getDate()}</div>
        ${(byDay[iso(d)] || []).map((it) => html`<span class="ev ${it.kind}" data-res="${it.resource}" data-id="${it.id}" data-pid="${it.project_id || ''}" data-tip="${it.code ? it.code + ' · ' : ''}${it.title}${it.status ? ' · ' + label(it.status) : ''}">${it.time ? it.time + ' ' : ''}${it.title}</span>`)}</div>`)}
    </div>`);
  el.addEventListener('click', (e) => {
    const ev = e.target.closest('.ev');
    if (ev) {
      if (ev.dataset.res === 'projects') location.hash = `#/projects/${ev.dataset.id}`;
      else if (canDo(ev.dataset.res, 'read')) openEditor(ev.dataset.res, Number(ev.dataset.id), { onSaved: () => calendarView(el, monthStr) });
    }
    if (e.target.closest('[data-new]')) openEditor('events', null, { onSaved: () => calendarView(el, monthStr) });
  });
}

// ---------- Finanzas ----------
export async function financeView(el) {
  const d = await api('/finance/overview');
  const t = d.totals;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Finanzas y rentabilidad</h1><p>Totales consolidados en USD con las tasas configuradas. Cada proyecto se calcula en su moneda.</p></div>
      ${state.user.role === 'admin' ? html`<button class="btn" data-fx>Tasas de cambio</button>` : ''}</div>
    <div class="tiles">
      <div class="tile"><div class="label">Ingresos pactados</div><div class="value">${usd(t.revenue_usd)}</div></div>
      <div class="tile"><div class="label">Costos ejecutados</div><div class="value">${usd(t.cost_usd)}</div><div class="sub">presupuestado ${usd(t.planned_usd)}</div></div>
      <div class="tile"><div class="label">Margen actual</div><div class="value">${usd(t.margin_usd)}</div><div class="sub">${t.revenue_usd ? Math.round((t.margin_usd / t.revenue_usd) * 100) : 0} % sobre ingresos</div></div>
      <div class="tile"><div class="label">Por cobrar</div><div class="value">${usd(t.receivable_usd)}</div></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Flujo de caja ${new Date().getFullYear()} (USD)</h3></div>${cashflowChart(d.cashflow)}</div>
      <div class="card"><div class="card-head"><h3>Ventas ganadas por canal (USD)</h3></div>${hbars(d.channels.map((c) => ({ label: label(c.channel), value: c.total_usd })), { fmt: usd })}</div>
    </div>
    <div class="card" data-gap><div class="card-head"><h3>Rentabilidad por proyecto</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Proyecto</th><th>Etapa</th><th class="money">Ingreso</th><th class="money">Presupuesto</th><th class="money">Costo</th><th class="money">Margen</th><th class="money">%</th><th class="money">Por cobrar (USD)</th></tr></thead>
      <tbody>${d.projects.map((p) => html`<tr data-pid="${p.id}"><td><b>${p.title}</b><div class="small muted">${p.code}</div></td><td>${badge(p.stage)}</td>
        <td class="money num">${money(p.revenue, p.currency)}</td><td class="money num">${money(p.planned, p.currency)}</td><td class="money num">${money(p.cost, p.currency)}</td>
        <td class="money num">${money(p.margin, p.currency)}</td><td class="money num">${p.margin_pct === null ? '—' : `${Math.round(p.margin_pct)} %`}</td><td class="money num">${usd(p.receivable_usd)}</td></tr>`)}</tbody></table></div></div>`);
  $$('[data-gap]', el).forEach((x) => { x.style.marginTop = '16px'; });
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-pid]');
    if (tr) location.hash = `#/projects/${tr.dataset.pid}`;
    if (e.target.closest('[data-fx]')) fxEditor(d.rates, () => financeView(el));
  });
}

function fxEditor(rates, done) {
  const body = html`<form data-form><div class="alert bad hidden form-alert"></div><p class="muted">Unidades de cada moneda por 1 USD.</p><div class="form-grid">
    ${state.meta.currencies.filter((c) => c !== 'USD').map((c) => html`<label class="field"><span>${c}</span><input type="number" step="0.0001" min="0" name="${c}" value="${rates[c] ?? ''}"></label>`)}</div></form>`;
  const d = drawer('Tasas de cambio', body, html`<span></span><span class="btn-row"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-save>Guardar</button></span>`);
  d.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) d.close();
    if (!e.target.closest('[data-save]')) return;
    const form = $('[data-form]', d.el);
    const out = {};
    state.meta.currencies.filter((c) => c !== 'USD').forEach((c) => { out[c] = form.elements[c].value; });
    try { await api('/settings/fx', { method: 'PUT', body: { rates: out } }); d.close(); toast('Tasas actualizadas'); done(); } catch (err) { showErrors(form, err); }
  });
}

// ---------- Integraciones ----------
export async function integrationsView(el) {
  const d = await api('/integrations');
  const admin = state.user.role === 'admin';
  const base = location.origin;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Ecosistema LibroSeller · CineViral</h1><p>LibroSeller envía libros para adaptación y pedidos de booktrailer; CineViral capta clientes y devuelve métricas de difusión.</p></div></div>
    <div class="grid cols-2">${d.integrations.map((i) => html`<div class="card" data-provider="${i.provider}">
      <div class="card-head"><h2>${i.name}</h2>${i.enabled ? html`<span class="badge good">Activa</span>` : html`<span class="badge">Inactiva</span>`}</div>
      <ul class="list small">
        <li><span class="muted">Webhook entrante</span><code>${base}/api/hooks/${i.provider}</code></li>
        <li><span class="muted">Eventos entrantes</span><span>${i.events.inbound.join(', ')}</span></li>
        <li><span class="muted">Eventos salientes</span><span>${i.events.outbound.join(', ')}</span></li>
        <li><span class="muted">Secreto HMAC</span><span>${i.has_secret ? 'configurado' : 'sin configurar'}</span></li>
        <li><span class="muted">Último evento</span><span>${i.last_event_at ? fmtDate(i.last_event_at, true) : '—'}</span></li>
      </ul>
      ${admin ? html`<form data-int class="form-grid" data-gap>
        <label class="field wide"><span>URL de destino (eventos salientes)</span><input type="url" name="endpoint_url" value="${i.endpoint_url || ''}" placeholder="https://api.${i.provider}.com/hooks/cine"></label>
        <label class="field check"><input type="checkbox" name="enabled" ${i.enabled ? 'checked' : ''}> Integración activa</label>
        <div class="btn-row"><button class="btn" type="button" data-rotate>${i.has_secret ? 'Rotar secreto' : 'Generar secreto'}</button><button class="btn primary">Guardar</button></div>
        <div class="wide" data-secret></div></form>` : ''}
    </div>`)}</div>
    <div class="card" data-gap><div class="card-head"><h3>Publicaciones</h3></div>
      ${d.publications.length ? html`<div class="table-wrap"><table><thead><tr><th>Destino</th><th>Proyecto</th><th>Versión</th><th>Estado</th><th class="money">Vistas</th><th class="money">Interacciones</th><th class="money">Solicitudes</th><th></th></tr></thead>
      <tbody>${d.publications.map((p) => html`<tr><td>${label(p.provider)}</td><td>${p.code || '—'} ${p.title || ''}</td><td>${p.version_label || '—'}</td><td>${badge(p.status)}</td>
        <td class="money num">${p.views}</td><td class="money num">${p.likes + p.shares + p.clicks}</td><td class="money num">${p.leads}</td>
        <td>${p.status !== 'enviado' ? html`<button class="btn small" data-retry="${p.provider}:${p.id}">Reintentar</button>` : p.external_url ? html`<a href="${p.external_url}" target="_blank" rel="noopener noreferrer">Ver ↗</a>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">Aún no se ha publicado nada. Aprueba una versión y publícala desde la sala de revisión.</p>`}</div>
    <div class="card" data-gap><div class="card-head"><h3>Registro de eventos</h3></div>
      ${d.events.length ? html`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Dirección</th><th>Evento</th><th>Estado</th><th>Respuesta</th></tr></thead>
      <tbody>${d.events.map((e) => html`<tr><td>${fmtDate(e.created_at, true)}</td><td>${label(e.provider)}</td><td>${e.direction === 'in' ? 'Entrante' : 'Saliente'}</td><td><code>${e.event_type}</code></td><td>${badge(e.status)}</td><td class="small muted">${(e.response || '').slice(0, 90)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty">Sin eventos</p>`}</div>`);
  $$('[data-gap]', el).forEach((x) => { x.style.marginTop = '16px'; });
  $$('[data-int]', el).forEach((form) => {
    const provider = form.closest('[data-provider]').dataset.provider;
    const save = async (extra = {}) => {
      try {
        const out = await api(`/integrations/${provider}`, { method: 'PUT', body: { endpoint_url: form.endpoint_url.value, enabled: form.enabled.checked, ...extra } });
        if (out.secret) {
          form.querySelector('[data-secret]').innerHTML = String(html`<div class="alert warn">Copia este secreto ahora y compártelo con ${label(provider)} por un canal seguro. No se volverá a mostrar.</div><div class="secret">${out.secret}</div>`);
        } else { toast('Integración guardada'); integrationsView(el); }
      } catch (err) { toast(errorMessage(err), 'bad'); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    form.querySelector('[data-rotate]').addEventListener('click', () => {
      if (confirm('Se generará un secreto nuevo y el anterior dejará de funcionar. ¿Continuar?')) save({ rotate_secret: true });
    });
  });
  el.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-retry]');
    if (!r) return;
    const [prov, pid] = r.dataset.retry.split(':');
    try { const out = await api(`/integrations/${prov}/retry/${pid}`, { method: 'POST' }); toast(out.status === 'enviado' ? 'Enviado' : 'Sigue en cola'); integrationsView(el); } catch (err) { toast(errorMessage(err), 'bad'); }
  });
}

// ---------- Auditoría ----------
export async function auditView(el) {
  const d = await api('/audit?limit=200');
  el.innerHTML = String(html`<div class="page-head"><div><h1>Auditoría</h1><p>Últimas 200 acciones registradas.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead><tbody>
    ${d.rows.map((r) => html`<tr><td>${fmtDate(r.at, true)}</td><td>${r.user_name || '—'}</td><td>${label(r.action)}</td><td>${r.entity ? `${state.meta.resources[r.entity]?.singular || r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—'}</td>
      <td class="small muted mono">${(r.detail || '').slice(0, 100)}</td><td class="small muted">${r.ip || ''}</td></tr>`)}</tbody></table></div>`);
}

// ---------- Mi cuenta ----------
export function accountView(el) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Mi cuenta</h1><p>${state.user.name} · ${state.user.email} · ${state.meta.roles[state.user.role]}</p></div></div>
    <div class="card"><h3>Cambiar contraseña</h3><form data-pw class="form-grid" data-gap><div class="alert bad hidden form-alert wide"></div>
      <label class="field"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password" required><small class="err" data-err="current"></small></label>
      <label class="field"><span>Nueva contraseña</span><input type="password" name="next" autocomplete="new-password" required><small class="help">Mínimo 10 caracteres, con letras y números.</small><small class="err" data-err="next"></small></label>
      <div><button class="btn primary">Actualizar</button></div></form></div>`);
  $('[data-gap]', el).style.marginTop = '12px';
  const f = $('[data-pw]', el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/me/password', { method: 'PUT', body: { current: f.current.value, next: f.next.value } }); f.reset(); toast('Contraseña actualizada. Se cerraron tus otras sesiones.'); } catch (err) { showErrors(f, err); }
  });
}

export { raw };
