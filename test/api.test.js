import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { ensureAdmin, seedDemo } from '../server/seed.js';
import { sign } from '../server/routes/integrations.js';

let server; let base; let db;
const ADMIN = { email: 'admin@cine.libroseller.com', password: 'Admin2026test' };
const DEMO_PW = 'Demo2026test';

before(async () => {
  process.env.ADMIN_PASSWORD = ADMIN.password;
  db = openDb(':memory:');
  const { app } = createApp({ db });
  ensureAdmin(db);
  seedDemo(db, { password: DEMO_PW });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

async function req(path, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch { /* vacío */ }
  return { status: res.status, data, headers: res.headers };
}

async function login(email, password) {
  const r = await req('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.data)}`);
  return r.headers.get('set-cookie').split(';')[0];
}

test('rechaza el acceso sin sesión y con credenciales inválidas', async () => {
  assert.equal((await req('/api/dashboard')).status, 401);
  assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: ADMIN.email, password: 'x' } })).status, 401);
});

test('la cookie de sesión es HttpOnly y SameSite', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: ADMIN });
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
});

test('bloquea peticiones que modifican datos desde otro origen', async () => {
  const cookie = await login(ADMIN.email, ADMIN.password);
  const r = await req('/api/r/clients', { method: 'POST', cookie, body: { name: 'X' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('valida campos y devuelve errores por campo', async () => {
  const cookie = await login(ADMIN.email, ADMIN.password);
  const r = await req('/api/r/talent', { method: 'POST', cookie, body: { name: '', email: 'no-es-email', likeness_consent: 'inventado' } });
  assert.equal(r.status, 422);
  assert.ok(r.data.details.name && r.data.details.email && r.data.details.likeness_consent);
});

test('permisos por rol: VFX no puede tocar el CRM ni las finanzas', async () => {
  const cookie = await login('vfx@demo.cine.libroseller.com', DEMO_PW);
  assert.equal((await req('/api/r/leads', { cookie })).status, 403);
  assert.equal((await req('/api/finance/overview', { cookie })).status, 403);
  assert.equal((await req('/api/r/shots', { cookie })).status, 200);
});

test('no se aprueba un plano que altera a un actor sin consentimiento vigente', async () => {
  const cookie = await login('vfx@demo.cine.libroseller.com', DEMO_PW);
  const shot = db.prepare(`SELECT id FROM shots WHERE code = 'CAS_022_005'`).get();
  const r = await req(`/api/r/shots/${shot.id}`, { method: 'PUT', cookie, body: { status: 'aprobado' } });
  assert.equal(r.status, 409);
  assert.match(r.data.details.status, /Rafael Almonte/);

  // Con el consentimiento otorgado, la aprobación pasa
  const admin = await login(ADMIN.email, ADMIN.password);
  const talent = db.prepare(`SELECT id FROM talent WHERE name = 'Rafael Almonte'`).get();
  assert.equal((await req(`/api/r/talent/${talent.id}`, { method: 'PUT', cookie: admin, body: { likeness_consent: 'otorgado' } })).status, 200);
  assert.equal((await req(`/api/r/shots/${shot.id}`, { method: 'PUT', cookie, body: { status: 'aprobado' } })).status, 200);
});

test('formulario público crea una solicitud y se convierte en proyecto', async () => {
  const pub = await req('/api/public/leads', { method: 'POST', body: {
    name: 'Autora Test', email: 'autora@test.example', service: 'trailer_libro', source_type: 'novela', privacy: true,
    message: 'Quiero un booktrailer para mi novela histórica ambientada en Puerto Plata.',
  } });
  assert.equal(pub.status, 201);
  const lead = db.prepare(`SELECT * FROM leads WHERE email = 'autora@test.example'`).get();
  assert.equal(lead.origin, 'web');

  const cookie = await login('ventas@demo.cine.libroseller.com', DEMO_PW);
  const conv = await req(`/api/leads/${lead.id}/convert`, { method: 'POST', cookie, body: { title: 'Booktrailer Puerto Plata', price: 1500 } });
  assert.equal(conv.status, 201);
  assert.match(conv.data.code, /^CLS-\d{4}-\d{4}$/);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(conv.data.project_id);
  assert.equal(project.format, 'trailer_libro');
  assert.equal(db.prepare('SELECT status FROM leads WHERE id = ?').get(lead.id).status, 'ganado');
  assert.equal((await req(`/api/leads/${lead.id}/convert`, { method: 'POST', cookie, body: {} })).status, 409);
});

test('el formulario público exige consentimiento de privacidad', async () => {
  const r = await req('/api/public/leads', { method: 'POST', body: { name: 'A', email: 'a@b.co', message: 'x'.repeat(30) } });
  assert.equal(r.status, 422);
});

test('portal de cliente: sólo ve sus proyectos y versiones visibles, y puede aprobar', async () => {
  const cookie = await login('cliente@demo.cine.libroseller.com', DEMO_PW);
  const projects = await req('/api/r/projects', { cookie });
  assert.equal(projects.status, 200);
  assert.equal(projects.data.rows.length, 1);
  assert.equal(projects.data.rows[0].title, 'Booktrailer — El último zafra');
  assert.equal((await req('/api/r/budget_items', { cookie })).status, 403);
  assert.equal((await req('/api/dashboard', { cookie })).status, 403);

  const other = db.prepare(`SELECT id FROM versions WHERE label = 'Offline v5'`).get();
  assert.equal((await req(`/api/versions/${other.id}/review`, { cookie })).status, 404);

  const v = db.prepare(`SELECT id FROM versions WHERE label = 'Booktrailer v2'`).get();
  assert.equal((await req(`/api/versions/${v.id}/notes`, { method: 'POST', cookie, body: { timecode: '00:01:05', note: 'Me encanta el cierre' } })).status, 201);
  const dec = await req(`/api/versions/${v.id}/decision`, { method: 'POST', cookie, body: { decision: 'aprobado', comment: 'Aprobado' } });
  assert.equal(dec.status, 200);
  assert.equal((await req(`/api/versions/${v.id}/notes`, { method: 'POST', cookie, body: { note: 'tarde' } })).status, 409);
});

test('publicar una versión aprobada queda en cola si la integración no está configurada', async () => {
  const cookie = await login('ventas@demo.cine.libroseller.com', DEMO_PW);
  const approved = db.prepare(`SELECT id FROM versions WHERE status = 'aprobado' LIMIT 1`).get();
  const r = await req('/api/integrations/cineviral/publish', { method: 'POST', cookie, body: { version_id: approved.id } });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'en_cola');
  const pending = db.prepare(`SELECT id FROM versions WHERE status = 'en_revision' LIMIT 1`).get();
  assert.equal((await req('/api/integrations/cineviral/publish', { method: 'POST', cookie, body: { version_id: pending.id } })).status, 409);
});

test('webhook de LibroSeller: firma HMAC, creación de solicitud e idempotencia', async () => {
  const admin = await login(ADMIN.email, ADMIN.password);
  const conf = await req('/api/integrations/libroseller', { method: 'PUT', cookie: admin, body: { enabled: true, rotate_secret: true } });
  const secret = conf.data.secret;
  assert.ok(secret);

  const body = JSON.stringify({ type: 'book.trailer_order', data: {
    book: { title: 'Los faros apagados', author: 'M. J. Liriano', isbn: '978-0-00-000000-0' },
    contact: { name: 'María José Liriano', email: 'mjl@test.example' }, package: 'Booktrailer 60 s',
  } });
  const bad = await req('/api/hooks/libroseller', { method: 'POST', raw: body, headers: { 'x-signature': 'sha256=00' } });
  assert.equal(bad.status, 401);

  const headers = { 'x-signature': sign(secret, body), 'x-event-id': 'evt-001' };
  const ok = await req('/api/hooks/libroseller', { method: 'POST', raw: body, headers });
  assert.equal(ok.status, 200);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ok.data.lead_id);
  assert.equal(lead.origin, 'libroseller');
  assert.equal(lead.service, 'trailer_libro');
  assert.match(lead.message, /Los faros apagados/);

  const dup = await req('/api/hooks/libroseller', { method: 'POST', raw: body, headers });
  assert.equal(dup.data.duplicate, true);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM leads WHERE email = 'mjl@test.example'`).get().n, 1);
});

test('finanzas: margen por proyecto en su moneda y consolidado en USD', async () => {
  const cookie = await login(ADMIN.email, ADMIN.password);
  const r = await req('/api/finance/overview', { cookie });
  assert.equal(r.status, 200);
  const spot = r.data.projects.find((p) => p.currency === 'DOP');
  assert.equal(spot.revenue, 690000);
  assert.ok(Math.abs(spot.revenue_usd - 690000 / r.data.rates.DOP) < 0.01);
});

test('un usuario no puede quitarse el rol de administrador ni borrarse', async () => {
  const cookie = await login(ADMIN.email, ADMIN.password);
  const me = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email);
  assert.equal((await req(`/api/r/users/${me.id}`, { method: 'PUT', cookie, body: { role: 'ventas' } })).status, 409);
  assert.equal((await req(`/api/r/users/${me.id}`, { method: 'DELETE', cookie })).status, 409);
  const list = await req('/api/r/users', { cookie });
  assert.ok(list.data.rows.every((u) => !('password_hash' in u)));
});

test('no se borra un proyecto con registros dependientes', async () => {
  const cookie = await login(ADMIN.email, ADMIN.password);
  const p = db.prepare(`SELECT id FROM projects WHERE title = 'La casa de las mareas'`).get();
  const r = await req(`/api/r/projects/${p.id}`, { method: 'DELETE', cookie });
  assert.equal(r.status, 409);
});
