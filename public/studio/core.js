// Utilidades del panel: API, escape HTML, formato, notificaciones, formularios.

export const state = { user: null, meta: null, refCache: new Map() };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Error ${status}`);
    this.status = status;
    this.details = body?.details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && path !== '/auth/login' && state.user) {
    state.user = null;
    window.dispatchEvent(new Event('cls:logout'));
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));

/** Plantillas seguras: interpola con escape salvo valores marcados con raw(). */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else out += esc(v);
    }
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Formato ----------
const LABELS = {
  preproduccion: 'Preproducción', postproduccion: 'Postproducción', vfx: 'VFX', ia_total: 'IA total', hibrido: 'Híbrido',
  en_proceso: 'En proceso', en_revision: 'En revisión', cambios_solicitados: 'Cambios solicitados', revision: 'En revisión',
  actor_real: 'Actor real', interprete_digital: 'Intérprete digital', ficticio_ia: 'Ficticio IA', voz_ia: 'Voz IA',
  ia_generativa: 'IA generativa', reemplazo_rostro: 'Reemplazo de rostro', set_extension: 'Set extension', volumen_led: 'Volumen LED',
  trailer_libro: 'Booktrailer', vfx_ia: 'VFX / IA', computo_ia: 'Cómputo IA', produccion_virtual: 'Producción virtual',
  no_aplica: 'No aplica', negociacion: 'Negociación', material_filmado: 'Material filmado', guion: 'Guion', por_definir: 'Por definir',
  cineviral: 'CineViral', libroseller: 'LibroSeller', utileria: 'Utilería', iluminacion: 'Iluminación', direccion: 'Dirección',
  fotografia: 'Fotografía', camara: 'Cámara', edicion: 'Edición', composicion: 'Composición', ia: 'IA', mezcla: 'Mezcla',
  institucion: 'Institución', licencia: 'Licencia', distribucion: 'Distribución', produccion: 'Producción', guion_: 'Guion',
  diseno: 'Diseño', en_diseno: 'En diseño', interpretacion: 'Interpretación', exterior: 'Exterior', rodaje: 'Rodaje',
};
export function label(v) {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  if (LABELS[s]) return LABELS[s];
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function money(n, cur = 'USD', { compact = false } = {}) {
  if (n === null || n === undefined || n === '') return '—';
  try {
    return new Intl.NumberFormat('es-DO', {
      style: 'currency', currency: cur, maximumFractionDigits: compact || Math.abs(n) >= 1000 || Number.isInteger(Number(n)) ? 0 : 2,
      notation: compact && Math.abs(n) >= 100000 ? 'compact' : 'standard',
    }).format(n);
  } catch { return `${cur} ${Number(n).toFixed(2)}`; }
}

export function fmtDate(s, withTime = false) {
  if (!s) return '—';
  // AAAA-MM-DD → fecha local; "AAAA-MM-DD HH:MM:SS" (SQLite) → UTC; "AAAA-MM-DDTHH:MM" → hora local
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : / \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  const opts = { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-DO', opts);
}

export function relDays(s) {
  if (!s) return '';
  const diff = Math.round((new Date(`${s.slice(0, 10)}T12:00:00`) - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00')) / 864e5);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`;
}

const TONE = {
  good: ['aprobado', 'ganado', 'firmado', 'otorgado', 'entregado', 'rodado', 'confirmado', 'procesado', 'enviado_ok', 'disponible', 'distribucion'],
  warn: ['revision', 'en_revision', 'pendiente', 'propuesta', 'negociacion', 'enviado', 'contactado', 'limitado', 'en_cola', 'planificado', 'cambios_solicitados', 'en_proceso', 'casting', 'ocupado'],
  bad: ['rechazado', 'perdido', 'revocado', 'vencido', 'rescindido', 'cancelado', 'error', 'bloqueado', 'rechazado_firma'],
  info: ['nuevo', 'desarrollo', 'preproduccion', 'rodaje', 'postproduccion', 'vfx', 'prospecto', 'borrador'],
};
export function badge(v) {
  if (v === null || v === undefined || v === '') return html`<span class="muted">—</span>`;
  const tone = Object.keys(TONE).find((k) => TONE[k].includes(v)) || '';
  return html`<span class="badge ${tone}">${label(v)}</span>`;
}

// ---------- UI ----------
let toastTimer;
export function toast(msg, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = `toast ${kind}`;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

export function errorMessage(e) {
  return e instanceof ApiError ? e.message : 'No se pudo conectar con el servidor';
}

/** Abre un panel lateral. Devuelve { el, close }. */
export function drawer(title, bodyHtml, footHtml = '') {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = String(html`<aside class="drawer" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="drawer-head"><h2>${title}</h2><button class="btn ghost" data-close aria-label="Cerrar">✕</button></div>
    <div class="drawer-body">${bodyHtml}</div>
    ${footHtml ? html`<div class="drawer-foot">${footHtml}</div>` : ''}
  </aside>`);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('input, select, textarea')?.focus();
  return { el: overlay, close };
}

export function canDo(resource, mode) {
  const r = state.meta?.resources?.[resource];
  return !!(r && state.user && r.perms[mode].includes(state.user.role));
}

/** Opciones para un campo de referencia (con caché por sesión). */
export async function refOptions(resource) {
  if (state.refCache.has(resource)) return state.refCache.get(resource);
  const p = (async () => {
    if (!canDo(resource, 'read')) return null;
    try {
      const d = await api(`/r/${resource}?limit=500&sort=id&dir=desc`);
      const disp = state.meta.resources[resource].display;
      return d.rows.map((r) => ({ id: r.id, label: resource === 'projects' ? `${r.code} · ${r.title}` : (r[disp] ?? `#${r.id}`), row: r }));
    } catch { return null; }
  })();
  state.refCache.set(resource, p);
  return p;
}
export const invalidateRefs = (resource) => state.refCache.delete(resource);

// ---------- Formularios generados por esquema ----------
export async function renderField(f, value, { fixed = {} } = {}) {
  const id = `f_${f.key}`;
  const v = value ?? (f.default ?? '');
  const help = f.help ? html`<small class="help">${f.help}</small>` : '';
  const ro = f.readonly || fixed[f.key] !== undefined;
  const wide = ['longtext'].includes(f.type) ? 'wide' : '';
  if (f.type === 'bool') {
    return html`<label class="field check ${wide}"><input type="checkbox" id="${id}" name="${f.key}" ${Number(v) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${f.label}</label>`;
  }
  let input;
  switch (f.type) {
    case 'longtext':
      input = html`<textarea id="${id}" name="${f.key}" ${ro ? 'readonly' : ''} maxlength="${f.max || 20000}">${v}</textarea>`; break;
    case 'enum':
      input = html`<select id="${id}" name="${f.key}" ${ro ? 'disabled' : ''}>
        ${f.required || f.default ? '' : html`<option value="">—</option>`}
        ${f.options.map((o) => html`<option value="${o}" ${o === v ? 'selected' : ''}>${label(o)}</option>`)}</select>`; break;
    case 'ref': {
      const opts = await refOptions(f.ref);
      if (opts) {
        input = html`<select id="${id}" name="${f.key}" ${ro ? 'disabled' : ''}>
          <option value="">${f.required ? 'Selecciona…' : '—'}</option>
          ${opts.map((o) => html`<option value="${o.id}" ${Number(v) === o.id ? 'selected' : ''}>${o.label}</option>`)}</select>`;
      } else {
        input = html`<input type="number" id="${id}" name="${f.key}" value="${v}" min="1" ${ro ? 'readonly' : ''} placeholder="ID">`;
      }
      break;
    }
    case 'money': input = html`<input type="number" step="0.01" min="0" id="${id}" name="${f.key}" value="${v}" ${ro ? 'readonly' : ''}>`; break;
    case 'int': input = html`<input type="number" step="1" min="0" id="${id}" name="${f.key}" value="${v}" ${ro ? 'readonly' : ''}>`; break;
    case 'date': input = html`<input type="date" id="${id}" name="${f.key}" value="${v}" ${ro ? 'readonly' : ''}>`; break;
    case 'time': input = html`<input type="time" id="${id}" name="${f.key}" value="${v}" ${ro ? 'readonly' : ''}>`; break;
    case 'datetime': input = html`<input type="datetime-local" id="${id}" name="${f.key}" value="${String(v).slice(0, 16)}" ${ro ? 'readonly' : ''}>`; break;
    case 'email': input = html`<input type="email" id="${id}" name="${f.key}" value="${v}" ${ro ? 'readonly' : ''}>`; break;
    case 'url': input = html`<input type="url" id="${id}" name="${f.key}" value="${v}" placeholder="https://" ${ro ? 'readonly' : ''}>`; break;
    case 'password': input = html`<input type="password" id="${id}" name="${f.key}" autocomplete="new-password">`; break;
    default: input = html`<input type="text" id="${id}" name="${f.key}" value="${v}" maxlength="${f.max || 300}" ${ro ? 'readonly' : ''}>`;
  }
  return html`<label class="field ${wide}" for="${id}"><span>${f.label}${f.required ? ' *' : ''}</span>${input}${help}<small class="err" data-err="${f.key}"></small></label>`;
}

export function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.readonly) continue;
    const el = form.elements[f.key];
    if (!el || el.disabled) continue;
    if (f.type === 'bool') out[f.key] = el.checked;
    else if (f.type === 'password') { if (el.value) out[f.key] = el.value; }
    else out[f.key] = el.value === '' ? null : el.value;
  }
  return out;
}

export function showErrors(form, e) {
  $$('.err', form).forEach((x) => { x.textContent = ''; x.parentElement.classList.remove('invalid'); });
  const box = $('.form-alert', form);
  if (box) { box.textContent = errorMessage(e); box.classList.remove('hidden'); }
  if (e.details && typeof e.details === 'object') {
    for (const [k, msg] of Object.entries(e.details)) {
      const slot = $(`[data-err="${k}"]`, form);
      if (slot) { slot.textContent = msg; slot.parentElement.classList.add('invalid'); }
    }
  }
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
