import { api, html, $, $$, state, toast, errorMessage, canDo } from './core.js';
import { resourceList } from './resources.js';
import {
  dashboardView, projectsView, projectView, reviewView, calendarView, financeView, integrationsView, auditView, accountView,
} from './views.js';

const app = $('#app');

function navItems() {
  const role = state.user.role;
  if (role === 'cliente') {
    return [['Mi espacio', [['#/projects', 'Mis proyectos'], ['#/r/versions', 'Versiones para revisar'], ['#/account', 'Mi cuenta']]]];
  }
  const R = state.meta.resources;
  const groups = [
    ['General', [['#/dashboard', 'Tablero'], ['#/projects', 'Proyectos'], ['#/calendar', 'Calendario']]],
    ['Comercial', ['leads', 'clients', 'deals', 'offerings'].map((k) => [`#/r/${k}`, R[k].label])],
    ['Producción', ['shoots', 'events'].map((k) => [`#/r/${k}`, R[k].label])],
    ['Talento y personajes', ['talent', 'characters'].map((k) => [`#/r/${k}`, R[k].label])],
    ['Postproducción', ['shots', 'continuity', 'versions'].map((k) => [`#/r/${k}`, R[k].label])],
    ['Equipo y contratos', ['crew', 'contracts'].map((k) => [`#/r/${k}`, R[k].label])],
    ['Finanzas', [['#/finance', 'Rentabilidad'], ...['budget_items', 'payments'].map((k) => [`#/r/${k}`, R[k].label])]],
    ['Sistema', [['#/integrations', 'Integraciones'], ['#/r/users', 'Usuarios'], ['#/audit', 'Auditoría'], ['#/account', 'Mi cuenta']]],
  ];
  const allowed = (href) => {
    const m = href.match(/^#\/r\/(\w+)/);
    if (m) return canDo(m[1], 'read');
    if (href === '#/finance') return ['admin', 'productor', 'ventas'].includes(role);
    if (href === '#/integrations') return ['admin', 'ventas', 'productor'].includes(role);
    if (href === '#/audit') return role === 'admin';
    return true;
  };
  return groups.map(([g, items]) => [g, items.filter(([h]) => allowed(h))]).filter(([, items]) => items.length);
}

function shell() {
  app.innerHTML = String(html`<div class="shell">
    <aside class="sidebar" data-sidebar>
      <div class="brand"><div class="brand-mark">C</div><div><b>Cine LibroSeller</b><span>Studios · panel</span></div></div>
      <nav class="nav">${navItems().map(([g, items]) => html`<div class="nav-group">${g}</div>${items.map(([href, l]) => html`<a href="${href}">${l}</a>`)}`)}</nav>
    </aside>
    <div class="main">
      <header class="topbar"><button class="btn ghost menu-btn" data-menu aria-label="Menú">☰</button><span class="muted small">Historias humanas. Cine sin límites.</span>
        <div class="who"><span>${state.user.name} · ${state.meta.roles[state.user.role]}</span><button class="btn" data-logout>Salir</button></div></header>
      <main class="content" data-view></main>
    </div></div>`);
  $('[data-logout]').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; boot(); });
  $('[data-menu]').addEventListener('click', () => $('[data-sidebar]').classList.toggle('open'));
}

async function route() {
  if (!state.user) return;
  const view = $('[data-view]');
  if (!view) return;
  const [pathPart, query = ''] = (location.hash.slice(1) || '/').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query));
  const home = state.user.role === 'cliente' ? '#/projects' : '#/dashboard';
  if (!parts.length) { location.replace(home); return; }

  $$('.nav a').forEach((a) => {
    const href = a.getAttribute('href').slice(1);
    a.classList.toggle('active', pathPart === href || (href !== '/' && pathPart.startsWith(href + '/')));
  });
  $('[data-sidebar]')?.classList.remove('open');
  view.innerHTML = '<p class="muted">Cargando…</p>';
  // Contenedor nuevo para que las vistas no acumulen escuchadores
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  window.scrollTo(0, 0);
  try {
    const [a, b, c] = parts;
    if (a === 'dashboard') await dashboardView(fresh);
    else if (a === 'projects' && b) await projectView(fresh, Number(b), c || 'resumen');
    else if (a === 'projects') await projectsView(fresh);
    else if (a === 'review' && b) await reviewView(fresh, Number(b));
    else if (a === 'calendar') await calendarView(fresh, b);
    else if (a === 'finance') await financeView(fresh);
    else if (a === 'integrations') await integrationsView(fresh);
    else if (a === 'audit') await auditView(fresh);
    else if (a === 'account') accountView(fresh);
    else if (a === 'r' && b && state.meta.resources[b]) {
      const def = state.meta.resources[b];
      fresh.innerHTML = String(html`<div class="page-head"><div><h1>${def.label}</h1><p>${def.group}</p></div></div><div data-list></div>`);
      const fixed = {};
      for (const [k, v] of Object.entries(params)) if (def.fields.some((f) => f.key === k)) fixed[k] = v;
      await resourceList($('[data-list]', fresh), b, {
        fixed,
        onOpen: b === 'versions' ? (id) => { location.hash = `#/review/${id}`; } : b === 'projects' ? (id) => { location.hash = `#/projects/${id}`; } : undefined,
      });
    } else {
      fresh.innerHTML = String(html`<div class="empty"><h2>Página no encontrada</h2><p><a href="${home}">Volver al inicio</a></p></div>`);
    }
  } catch (e) {
    fresh.innerHTML = String(html`<div class="alert bad">${errorMessage(e)}</div>`);
  }
}

function loginView() {
  app.innerHTML = String(html`<div class="login-wrap"><div class="login">
    <div class="brand"><div class="brand-mark">C</div><div><b>Cine LibroSeller Studios</b><span>Panel privado</span></div></div>
    <div class="card"><form data-login>
      <h1>Iniciar sesión</h1>
      <div class="alert bad hidden form-alert"></div>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit">Entrar</button>
      <p class="small muted"><a href="/">← Volver al sitio</a></p>
    </form></div></div></div>`);
  const f = $('[data-login]');
  f.email.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      await api('/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      await boot();
    } catch (err) {
      const box = $('.form-alert', f); box.textContent = errorMessage(err); box.classList.remove('hidden');
      btn.disabled = false;
    }
  });
}

async function boot() {
  try {
    const [{ user }, meta] = await Promise.all([api('/me'), api('/meta')]);
    state.user = user; state.meta = meta; state.refCache.clear();
    shell();
    await route();
  } catch {
    state.user = null;
    loginView();
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('cls:logout', () => { if (!$('[data-login]')) { toast('Tu sesión expiró', 'bad'); loginView(); } });
boot();
