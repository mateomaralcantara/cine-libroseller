// Vistas genéricas (lista + editor) construidas a partir del esquema del servidor.
import {
  api, html, raw, esc, $, $$, state, label, money, fmtDate, badge, toast, drawer, canDo,
  renderField, readForm, showErrors, debounce, invalidateRefs, errorMessage,
} from './core.js';

const BADGE_KEYS = new Set(['status', 'stage', 'likeness_consent', 'voice_consent', 'availability']);

function cell(def, f, row, labels) {
  const v = row[f.key];
  if (f.type === 'ref') {
    if (v == null) return html`<span class="muted">—</span>`;
    return html`${labels?.[f.key]?.[v] ?? `#${v}`}`;
  }
  if (f.type === 'enum') return BADGE_KEYS.has(f.key) ? badge(v) : html`${label(v)}`;
  if (f.type === 'bool') return v ? html`<span class="badge good plain">Sí</span>` : html`<span class="muted">No</span>`;
  if (f.type === 'money') return html`<span class="num">${money(v, row.currency || 'USD')}</span>`;
  if (f.type === 'date') return html`${fmtDate(v)}`;
  if (f.type === 'datetime') return html`${fmtDate(v, true)}`;
  if (f.type === 'url') return v ? html`<a href="${v}" target="_blank" rel="noopener noreferrer" data-stop>Abrir ↗</a>` : '';
  const s = v == null ? '' : String(v);
  return html`${s.length > 80 ? s.slice(0, 80) + '…' : s}`;
}

function columns(def, hide = []) {
  return def.list
    .filter((k) => !hide.includes(k))
    .map((k) => (k === 'created_at' ? { key: 'created_at', label: 'Creado', type: 'datetime' } : def.fields.find((f) => f.key === k)))
    .filter(Boolean);
}

/**
 * Lista paginada con búsqueda, filtros y alta/edición.
 * opts.fixed: filtros fijos (p. ej. { project_id: 3 }) que también se precargan al crear.
 */
export async function resourceList(container, resource, opts = {}) {
  const def = state.meta.resources[resource];
  const fixed = opts.fixed || {};
  const cols = columns(def, Object.keys(fixed));
  const filterFields = def.fields.filter((f) => f.type === 'enum' && ['status', 'stage', 'kind', 'category', 'technique', 'origin', 'role', 'direction', 'party_type', 'type'].includes(f.key) && fixed[f.key] === undefined).slice(0, 2);
  const st = { q: '', filters: {}, sort: def.list.includes('date') ? 'date' : 'id', dir: 'desc', offset: 0, limit: opts.limit || 25 };
  const writable = canDo(resource, 'write') && !opts.readonly;

  container.innerHTML = String(html`
    <div class="toolbar">
      <input type="search" placeholder="Buscar en ${def.label.toLowerCase()}…" data-q aria-label="Buscar">
      ${filterFields.map((f) => html`<select data-filter="${f.key}" aria-label="${f.label}"><option value="">${f.label}: todos</option>
        ${f.options.map((o) => html`<option value="${o}">${label(o)}</option>`)}</select>`)}
      <span class="spacer"></span>
      ${opts.extraActions || ''}
      ${writable ? html`<button class="btn primary" data-new>+ ${def.singular}</button>` : ''}
    </div>
    <div class="table-wrap"><table><thead><tr>
      ${cols.map((c) => html`<th data-sort="${c.key}" class="${c.type === 'money' ? 'money' : ''}">${c.label}</th>`)}
    </tr></thead><tbody data-body><tr><td colspan="${cols.length}" class="empty">Cargando…</td></tr></tbody></table></div>
    <div class="pager" data-pager></div>`);

  async function load() {
    const params = new URLSearchParams({ limit: st.limit, offset: st.offset, sort: st.sort, dir: st.dir });
    if (st.q) params.set('q', st.q);
    for (const [k, v] of Object.entries({ ...fixed, ...st.filters })) if (v !== '' && v != null) params.set(k, v);
    const body = $('[data-body]', container);
    try {
      const d = await api(`/r/${resource}?${params}`);
      if (!d.rows.length) {
        body.innerHTML = String(html`<tr><td colspan="${cols.length}" class="empty">${st.q || Object.values(st.filters).some(Boolean) ? 'Sin resultados para este filtro' : `Aún no hay ${def.label.toLowerCase()}`}</td></tr>`);
      } else {
        body.innerHTML = d.rows.map((row) => String(html`<tr data-id="${row.id}">
          ${cols.map((c) => html`<td class="${c.type === 'money' ? 'money' : ''}">${c.key === 'created_at' ? fmtDate(row.created_at, true) : cell(def, c, row, d.labels)}</td>`)}</tr>`)).join('');
      }
      const end = Math.min(st.offset + st.limit, d.total);
      $('[data-pager]', container).innerHTML = String(html`<span>${d.total ? `${st.offset + 1}–${end} de ${d.total}` : ''}</span>
        <span class="btn-row"><button class="btn" data-prev ${st.offset === 0 ? 'disabled' : ''}>← Anterior</button>
        <button class="btn" data-next ${end >= d.total ? 'disabled' : ''}>Siguiente →</button></span>`);
      $$('th', container).forEach((th) => th.classList.toggle('sorted', th.dataset.sort === st.sort));
      opts.onLoad?.(d);
    } catch (e) {
      body.innerHTML = String(html`<tr><td colspan="${cols.length}" class="empty">${errorMessage(e)}</td></tr>`);
    }
  }

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const tr = e.target.closest('tbody tr[data-id]');
    if (tr) {
      const id = Number(tr.dataset.id);
      if (opts.onOpen) return opts.onOpen(id);
      return openEditor(resource, id, { fixed, onSaved: load });
    }
    if (e.target.closest('[data-new]')) return openEditor(resource, null, { fixed, onSaved: load });
    if (e.target.closest('[data-prev]')) { st.offset = Math.max(0, st.offset - st.limit); load(); }
    if (e.target.closest('[data-next]')) { st.offset += st.limit; load(); }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      st.dir = st.sort === th.dataset.sort && st.dir === 'desc' ? 'asc' : 'desc';
      st.sort = th.dataset.sort; st.offset = 0; load();
    }
  });
  $('[data-q]', container).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.offset = 0; load(); }));
  $$('[data-filter]', container).forEach((s) => s.addEventListener('change', () => { st.filters[s.dataset.filter] = s.value; st.offset = 0; load(); }));
  await load();
  return { reload: load };
}

/** Acciones especiales por recurso dentro del editor. */
const EDITOR_ACTIONS = {
  leads: (row) => (row && !row.project_id && canDo('leads', 'write') ? html`<button type="button" class="btn good" data-action="convert">Convertir en proyecto</button>` : ''),
  versions: (row) => (row ? html`<a class="btn" href="#/review/${row.id}">Abrir sala de revisión</a>` : ''),
  projects: (row) => (row ? html`<a class="btn" href="#/projects/${row.id}">Ver ficha completa</a>` : ''),
};

export async function openEditor(resource, id, { fixed = {}, onSaved } = {}) {
  const def = state.meta.resources[resource];
  const writable = canDo(resource, 'write');
  let row = null;
  let labels = {};
  if (id) {
    try { ({ row, labels } = await api(`/r/${resource}/${id}`)); } catch (e) { return toast(errorMessage(e), 'bad'); }
  }
  const values = { ...(row || {}), ...(id ? {} : fixed) };
  const fields = def.fields.filter((f) => !(f.type === 'password' && !writable));
  const parts = [];
  for (const f of fields) {
    if (f.readonly && !id) continue;
    if (f.readonly && f.type === 'ref') {
      const v = values[f.key];
      parts.push(html`<label class="field"><span>${f.label}</span><input type="text" readonly value="${v ? labels?.[f.key]?.[v] ?? `#${v}` : '—'}"></label>`);
      continue;
    }
    parts.push(await renderField(writable ? f : { ...f, readonly: true }, values[f.key], { fixed: id ? {} : fixed }));
  }
  const extra = EDITOR_ACTIONS[resource]?.(row) || '';
  const linked = resource === 'leads' && row?.project_id ? html`<div class="alert good">Convertida en proyecto · <a href="#/projects/${row.project_id}">abrir proyecto</a></div>` : '';
  const meta = row ? html`<p class="muted small">Creado ${fmtDate(row.created_at, true)} · actualizado ${fmtDate(row.updated_at, true)}</p>` : '';

  const body = html`<form data-form novalidate>
    <div class="alert bad hidden form-alert"></div>${linked}
    <div class="form-grid">${parts}</div>${meta}</form>`;
  const foot = html`<span class="btn-row">${row && writable ? html`<button class="btn danger" data-del>Eliminar</button>` : ''}${extra}</span>
    <span class="btn-row"><button class="btn" data-close>Cerrar</button>${writable ? html`<button class="btn primary" data-save>${row ? 'Guardar cambios' : `Crear ${def.singular.toLowerCase()}`}</button>` : ''}</span>`;
  const d = drawer(row ? `${def.singular}: ${row[def.display] ?? `#${row.id}`}` : `Nuevo: ${def.singular.toLowerCase()}`, body, foot);
  const form = $('[data-form]', d.el);
  // Los campos fijos (contexto) se envían aunque estén deshabilitados
  const payload = () => ({ ...readForm(form, fields), ...(id ? {} : fixed) });

  async function save() {
    const btn = $('[data-save]', d.el);
    btn.disabled = true;
    try {
      const out = id
        ? await api(`/r/${resource}/${id}`, { method: 'PUT', body: payload() })
        : await api(`/r/${resource}`, { method: 'POST', body: payload() });
      invalidateRefs(resource);
      toast(id ? 'Cambios guardados' : `${def.singular} creado`);
      d.close();
      onSaved?.(out.row);
    } catch (e) { showErrors(form, e); btn.disabled = false; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  d.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) d.close();
    if (e.target.closest('[data-save]')) save();
    if (e.target.closest('[data-del]')) {
      if (!confirm(`¿Eliminar este registro de ${def.label.toLowerCase()}? Esta acción no se puede deshacer.`)) return;
      try { await api(`/r/${resource}/${id}`, { method: 'DELETE' }); invalidateRefs(resource); toast('Eliminado'); d.close(); onSaved?.(); } catch (err) { toast(errorMessage(err), 'bad'); }
    }
    if (e.target.closest('[data-action="convert"]')) { d.close(); convertLead(row, onSaved); }
    if (e.target.closest('a[href^="#/"]')) d.close();
  });
  return d;
}

export function convertLead(lead, onDone) {
  const body = html`<form data-form>
    <div class="alert bad hidden form-alert"></div>
    <p class="muted">Se creará (o reutilizará por email) el cliente, un proyecto en etapa de desarrollo y un negocio en propuesta.</p>
    <div class="form-grid">
      <label class="field wide"><span>Título del proyecto</span><input type="text" name="title" value="${lead.company || lead.name} — ${label(lead.service)}" maxlength="200"></label>
      <label class="field"><span>Precio propuesto</span><input type="number" name="price" min="0" step="0.01" value="0"></label>
      <label class="field"><span>Moneda</span><select name="currency">${state.meta.currencies.map((c) => html`<option>${c}</option>`)}</select></label>
    </div></form>`;
  const d = drawer(`Convertir solicitud de ${lead.name}`, body, html`<span></span><span class="btn-row"><button class="btn" data-close>Cancelar</button><button class="btn primary" data-go>Crear proyecto</button></span>`);
  d.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) d.close();
    if (!e.target.closest('[data-go]')) return;
    const form = $('[data-form]', d.el);
    try {
      const out = await api(`/leads/${lead.id}/convert`, { method: 'POST', body: { title: form.title.value, price: form.price.value, currency: form.currency.value } });
      ['projects', 'clients', 'deals'].forEach(invalidateRefs);
      d.close();
      toast(`Proyecto ${out.code} creado`);
      onDone?.();
      location.hash = `#/projects/${out.project_id}`;
    } catch (err) { showErrors(form, err); }
  });
}

export { raw, esc };
