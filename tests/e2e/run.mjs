// Pruebas de extremo a extremo con un navegador real (Playwright + Chromium).
// Requisitos: app compilada (`npm run build`), PostgreSQL accesible, ffmpeg y playwright instalados.
//   E2E_DATABASE_URL=postgres://... npm run test:e2e
// Genera material de PRUEBA (no forma parte del catálogo), arranca un «CDN» local con CORS,
// una base de datos limpia y la app, y recorre los flujos principales.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeMux } from './fake-mux.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/e2e/artifacts');
const CDN = path.join(OUT, 'cdn');
const DB = process.env.E2E_DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/cine_e2e';
const APP_PORT = Number(process.env.E2E_PORT || 3100);
const CDN_PORT = APP_PORT + 1;
const MUX_PORT = APP_PORT + 2;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const ADMIN = { email: 'admin-e2e@cine.libroseller.com', password: 'AdminE2e2026' };

const results = [];
const openPages = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name}`); }
  catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`);
    for (const [i, p] of openPages.entries()) await p.screenshot({ path: path.join(OUT, `fallo-${i}.png`), fullPage: true }).catch(() => {});
    throw e;
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

function ff(args) { execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); }
function fixtures() {
  if (fs.existsSync(path.join(CDN, 'hls/master.m3u8'))) return;
  fs.mkdirSync(path.join(CDN, 'hls'), { recursive: true });
  fs.mkdirSync(path.join(CDN, 'img'), { recursive: true });
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=40', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=40',
    '-filter_complex', "[0:v]drawtext=text='PRUEBA %{pts\\:hms}':fontcolor=white:fontsize=48:x=40:y=40:box=1:boxcolor=black@0.6,split=2[a][b];[b]scale=640:360[b2]",
    '-map', '[a]', '-map', '[b2]', '-map', '1:a', '-map', '1:a', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
    '-b:v:0', '1500k', '-b:v:1', '500k', '-g', '48', '-keyint_min', '48', '-c:a', 'libopus', '-b:a', '96k',
    '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-master_pl_name', 'master.m3u8',
    '-var_stream_map', 'v:0,a:0 v:1,a:1', '-hls_segment_filename', path.join(CDN, 'hls/v%v/seg%03d.m4s'), path.join(CDN, 'hls/v%v/index.m3u8')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=854x480:rate=24:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=12',
    '-vf', "drawtext=text='TRAILER DE PRUEBA':fontcolor=white:fontsize=40:x=30:y=30:box=1:boxcolor=black@0.6", '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libvorbis', path.join(CDN, 'trailer.webm')]);
  ff(['-f', 'lavfi', '-i', 'gradients=size=1000x1500:c0=0x1d2b24:c1=0x6b4f22:duration=1', '-vf', "drawtext=text='POSTER DE PRUEBA':fontcolor=white:fontsize=60:x=(w-tw)/2:y=h/2", '-frames:v', '1', path.join(CDN, 'img/poster.jpg')]);
  ff(['-f', 'lavfi', '-i', 'gradients=size=1920x1080:c0=0x0b0d14:c1=0x7a5c2a:duration=1', '-vf', "drawtext=text='FONDO DE PRUEBA':fontcolor=white:fontsize=72:x=(w-tw)/2:y=h/2", '-frames:v', '1', path.join(CDN, 'img/backdrop.jpg')]);
  fs.writeFileSync(path.join(CDN, 'subs-es.vtt'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:39.000\nSubtítulo de prueba: la petición en la montaña.\n');
}

const MIME = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.vtt': 'text/vtt' };
function cdnServer() {
  return http.createServer((req, res) => {
    const file = path.join(CDN, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(CDN) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else { res.writeHead(200, { ...headers, 'content-length': size }); fs.createReadStream(file).pipe(res); }
  }).listen(CDN_PORT, '127.0.0.1');
}

async function resetDb() {
  const postgres = require('postgres');
  const admin = postgres(DB.replace(/\/[^/]+$/, '/postgres'), { max: 1, onnotice: () => {} });
  const name = DB.split('/').pop();
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  await admin.end();
  const env = { ...process.env, DATABASE_URL: DB, ADMIN_PASSWORD: ADMIN.password };
  execFileSync('npx', ['tsx', 'scripts/migrate.ts'], { cwd: ROOT, env, stdio: 'ignore' });
  execFileSync('npx', ['tsx', 'scripts/seed.ts'], { cwd: ROOT, env, stdio: 'ignore' });
  execFileSync('npx', ['tsx', 'scripts/create-admin.ts', ADMIN.email, 'Admin E2E'], { cwd: ROOT, env, stdio: 'ignore' });
}

function buildApp() {
  // Compilación aparte (.next-e2e) que admite el CDN de pruebas en la CSP; no toca la compilación normal.
  execFileSync('npx', ['next', 'build'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, NEXT_DIST_DIR: '.next-e2e', CSP_EXTRA_SOURCES: `http://127.0.0.1:${CDN_PORT} http://127.0.0.1:${MUX_PORT}`, DATABASE_URL: DB, NEXT_PUBLIC_SITE_URL: BASE } });
}

async function startApp() {
  const env = { ...process.env, NEXT_DIST_DIR: '.next-e2e', DATABASE_URL: DB, PORT: String(APP_PORT), NEXT_PUBLIC_SITE_URL: BASE, LOCAL_STORAGE_DIR: path.join(OUT, 'storage'), STORAGE_DRIVER: 'local',
    MUX_TOKEN_ID: 'sim', MUX_TOKEN_SECRET: 'sim', MUX_API_BASE: `http://127.0.0.1:${MUX_PORT}`, MUX_WEBHOOK_SECRET: '', NODE_ENV: 'production', ALLOW_INSECURE_VIDEO_LINKS: '1' };
    try { await fetch(`${BASE}/api/v1/health`); throw new Error(`El puerto ${APP_PORT} ya está ocupado: detén ese servidor o usa E2E_PORT.`); } catch (e) { if (e.message.includes('ocupado')) throw e; }
  const app = spawn('npx', ['next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/v1/health`); if (r.ok) return { app, log: () => log }; } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La app no arrancó:\n${log}`);
}

async function videoTime(page) { return page.evaluate(() => document.querySelector('video')?.currentTime ?? -1); }
async function waitPlaying(page, min = 2, timeout = 25000) {
  await page.waitForFunction((m) => { const v = document.querySelector('video'); return v && v.currentTime > m && !v.paused; }, min, { timeout });
}
async function expectOk(page, text) { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 }); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('Preparando material de prueba, base de datos y servidores…');
  fixtures();
  const cdn = cdnServer();
  const fakeMux = startFakeMux(MUX_PORT);
  await resetDb();
  if (!process.env.E2E_SKIP_BUILD) { console.log('Compilando la app para pruebas…'); buildApp(); }
  const { app, log } = await startApp();
  const browser = await chromium.launch();
  const consoleErrors = [];
  const watch = (page, who) => {
    openPages.push(page);
    page.on('pageerror', (e) => consoleErrors.push(`[${who}] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|404|Failed to load resource/.test(m.text())) consoleErrors.push(`[${who}] ${m.text()}`); });
    page.on('dialog', (d) => d.accept());
  };
  let seriesId, episodeId;
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  try {
    // ------------------------------------------------------------------ Administración
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await adminCtx.newPage(); watch(a, 'admin');
    console.log('Administración');
    await step('impide el acceso anónimo a /admin', async () => {
      await a.goto(`${BASE}/admin`);
      assert(a.url().includes('/cuenta/entrar'), `esperaba redirección a login, URL: ${a.url()}`);
    });
    await step('inicia sesión como administrador', async () => {
      await a.fill('#email', ADMIN.email); await a.fill('#password', ADMIN.password);
      await a.click('button:has-text("Entrar")');
      await a.waitForURL(`${BASE}/admin`);
    });
    await step('crea una película (borrador)', async () => {
      await a.goto(`${BASE}/admin/titulos`);
      await a.selectOption('#f-type', 'movie'); await a.fill('#f-title', 'Película de prueba E2E');
      await a.click('button:has-text("Crear y editar")');
      await a.waitForURL(/\/admin\/titulos\/[0-9a-f-]{36}$/);
    });
    await step('completa la ficha de la serie inaugural', async () => {
      await a.goto(`${BASE}/admin/titulos`);
      await a.click('a:has-text("Los Convidados al Ágape")');
      await a.waitForURL(/\/admin\/titulos\/[0-9a-f-]{36}/);
      seriesId = a.url().split('/').pop().split('?')[0];
      await a.fill('#f-tagline', 'Texto de prueba E2E');
      await a.fill('#f-synopsis_short', 'Sinopsis de PRUEBA para verificar el flujo de publicación.');
      await a.fill('#f-age_rating', '+13');
      await a.click('button:has-text("Guardar ficha")');
      await expectOk(a, 'Ficha guardada.');
    });
    await step('bloquea publicar sin materiales ni derechos', async () => {
      await a.selectOption('#to', 'published'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Falta para publicar');
    });
    await step('sube póster y fondo', async () => {
      for (const [kind, file] of [['poster', 'poster.jpg'], ['backdrop', 'backdrop.jpg']]) {
        await a.goto(`${BASE}/admin/titulos/${seriesId}?tab=medios`);
        await a.selectOption('select[name=kind]', kind);
        await a.setInputFiles('input[name=file]', path.join(CDN, 'img', file));
        await a.fill('#f-alt_text', `Imagen de prueba (${kind})`);
        await a.click('button:has-text("Subir")');
        await expectOk(a, 'Imagen subida.');
      }
    });
    await step('registra derechos verificados y publica la serie', async () => {
      await a.goto(`${BASE}/admin/titulos/${seriesId}?tab=derechos`);
      await a.check('input[name=verified]'); await a.click('button:has-text("Registrar")');
      await expectOk(a, 'Derechos registrados.');
      await a.selectOption('#to', 'published'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Estado actualizado.');
    });
    await step('vincula el video del episodio 1, lo previsualiza y lo aprueba', async () => {
      await a.goto(`${BASE}/admin/titulos/${seriesId}?tab=temporadas`);
      await a.click('a:has-text("La petición en la montaña")');
      await a.waitForURL(/\/admin\/episodios\//);
      episodeId = a.url().split('/').pop();
      await a.fill('input[name=url]', `http://127.0.0.1:${CDN_PORT}/hls/master.m3u8`);
      await a.click('button:has-text("Verificar y vincular")');
      await expectOk(a, 'Video verificado');
      await a.reload();
      const preview = await a.getAttribute('a:has-text("Previsualizar")', 'href');
      const p = await adminCtx.newPage(); watch(p, 'preview');
      await p.goto(`${BASE}${preview}`);
      await p.getByText('Previsualización privada').waitFor();
      await waitPlaying(p, 1);
      await p.close();
      await a.click('button:has-text("Aprobar video")');
      await expectOk(a, 'Versión vigente: v1');
    });
    await step('sube subtítulos y publica el episodio', async () => {
      await a.fill('input[name=language]', 'es'); await a.fill('input[name=label]', 'Español');
      await a.setInputFiles('input[accept=".vtt,.srt,text/vtt"]', path.join(CDN, 'subs-es.vtt'));
      await a.check('input[name=is_default]');
      await a.click('button:has-text("Añadir")');
      await expectOk(a, 'Subtítulos añadidos.');
      await a.selectOption('#to', 'published'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Estado actualizado.');
    });
    await step('crea el tráiler, vincula su video, lo aprueba y lo publica', async () => {
      await a.goto(`${BASE}/admin/titulos/${seriesId}?tab=extras`);
      await a.fill('#f-name', 'Tráiler oficial (prueba)'); await a.check('input[name=is_primary]');
      await a.click('button:has-text("Crear y subir video")');
      await a.waitForURL(/\/admin\/extras\//);
      await a.fill('input[name=url]', `http://127.0.0.1:${CDN_PORT}/trailer.webm`);
      await a.click('button:has-text("Verificar y vincular")');
      await expectOk(a, 'Video verificado');
      await a.reload();
      await a.click('button:has-text("Aprobar video")');
      await expectOk(a, 'Versión vigente: v1');
      await a.check('input[name=is_published]'); await a.click('button:has-text("Guardar")');
      await expectOk(a, 'Guardado.');
    });
    await step('programa un estreno anunciado (sin fecha confirmada)', async () => {
      await a.goto(`${BASE}/admin/estrenos`);
      const panel = a.locator('section', { has: a.locator('h2', { hasText: 'La petición en la montaña' }) }).first();
      await panel.locator('input[name=date_label]').fill('Próximamente');
      await panel.locator('input[name=is_public]').check();
      await panel.locator('button:has-text("Guardar")').click();
      await expectOk(a, 'Estreno guardado.');
    });
    await step('sube un episodio con el asistente (Mux simulado, sin webhook)', async () => {
      await a.goto(`${BASE}/admin/titulos/${seriesId}?tab=temporadas`);
      const epForm = a.locator('form', { has: a.locator('button:has-text("Añadir episodio")') }).first();
      await epForm.locator('input[name=name]').fill('Episodio subido con el asistente');
      await epForm.locator('button:has-text("Añadir episodio")').click();
      await a.waitForURL(/\/admin\/episodios\//);
      const epId = a.url().split('/').pop();
      await a.goto(`${BASE}/admin/subir?episodio=${epId}`);
      const paso = (n) => a.locator('section', { has: a.locator(`#paso-${n}`) });
      await paso(5).locator('input[type=file]').setInputFiles(path.join(CDN, 'trailer.webm'));
      await paso(5).locator('button:has-text("Subir episodio")').click();
      await a.getByText('Versión v1 procesada').waitFor({ timeout: 60000 });
      await paso(5).locator('button:has-text("Aprobar video")').click();
      await a.getByText('Versión vigente: v1').waitFor();
      await paso(6).locator('select[name=to]').selectOption('published');
      await paso(6).locator('button:has-text("Aplicar")').click();
      await a.getByText('¡Publicado!').waitFor();
      await shot(a, '12-asistente-subida');
      // Se retira para no interferir con las pruebas de reproducción (su video apunta al Mux simulado)
      await a.goto(`${BASE}/admin/episodios/${epId}`);
      await a.selectOption('#to', 'withdrawn'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Estado actualizado.');
    });
    await shot(a, '10-admin-episodio');
    await a.goto(`${BASE}/admin`); await shot(a, '11-admin-panel');

    // ------------------------------------------------------------------ Espectador anónimo
    console.log('Espectador anónimo');
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const v = await anon.newPage(); watch(v, 'anónimo');
    await step('la portada muestra la serie inaugural', async () => {
      await v.goto(BASE);
      await v.getByRole('heading', { name: 'Los Convidados al Ágape', level: 1 }).waitFor();
      await v.click('button:has-text("Sólo lo esencial")');
      await shot(v, '01-portada');
    });
    await step('reproduce el tráiler en un modal y lo cierra', async () => {
      await v.click('button:has-text("Ver tráiler")');
      await v.locator('[role=dialog] video').waitFor();
      await waitPlaying(v, 1);
      await shot(v, '02-trailer');
      await v.keyboard.press('Escape');
      await v.locator('[role=dialog] video').waitFor({ state: 'detached' });
    });
    await step('abre la ficha de la serie y el episodio', async () => {
      await v.goto(`${BASE}/series/los-convidados-al-agape`);
      await v.getByRole('heading', { name: 'Episodios' }).waitFor();
      await shot(v, '03-serie');
      await v.click('a:has-text("La petición en la montaña")');
      await v.waitForURL(/temporada-1\/episodio-1$/);
      await shot(v, '04-episodio');
    });
    await step('reproduce el episodio sin registro (HLS adaptativo)', async () => {
      await v.click('a:has-text("Ver episodio")');
      await v.waitForURL(/\/ver$/);
      await waitPlaying(v, 3);
      await v.mouse.move(700, 450);
      await shot(v, '05-reproductor');
    });
    await step('pausa y reanuda con el teclado', async () => {
      await v.keyboard.press('k');
      await v.waitForFunction(() => document.querySelector('video').paused);
      const t = await videoTime(v);
      await v.keyboard.press('k');
      await v.waitForFunction((x) => document.querySelector('video').currentTime > x + 0.5, t);
    });
    await step('ofrece calidades, subtítulos y velocidad', async () => {
      await v.mouse.move(600, 400);
      await v.click('button[aria-label="Calidad"]');
      await v.getByRole('menuitemradio', { name: /720p/ }).waitFor();
      await v.getByRole('menuitemradio', { name: /360p/ }).click();
      await v.click('button[aria-label="Subtítulos"]');
      await v.getByRole('menuitemradio', { name: 'Español' }).click();
      const showing = await v.evaluate(() => Array.from(document.querySelector('video').textTracks).some((t) => t.mode === 'showing'));
      assert(showing, 'los subtítulos no se activaron');
      await v.click('button[aria-label="Velocidad"]');
      await v.getByRole('menuitemradio', { name: '1.5×' }).click();
      assert(await v.evaluate(() => document.querySelector('video').playbackRate) === 1.5, 'velocidad no aplicada');
      await v.mouse.move(650, 420);
      await shot(v, '06-subtitulos');
    });
    await step('busca un título real y no inventa resultados', async () => {
      await v.goto(`${BASE}/buscar?q=convidados`);
      await v.locator('a[href="/series/los-convidados-al-agape"]').first().waitFor();
      await v.goto(`${BASE}/buscar?q=dragones%20espaciales`);
      await expectOk(v, 'No encontramos obras');
    });
    await step('muestra el estreno anunciado sin cuenta regresiva', async () => {
      await v.goto(`${BASE}/estrenos`);
      await expectOk(v, 'Fecha orientativa, aún no confirmada.');
      assert(!(await v.locator('[role=timer]').count()), 'no debe haber cuenta regresiva sin fecha confirmada');
    });
    await step('comparte la ficha (enlace oficial)', async () => {
      await v.goto(`${BASE}/series/los-convidados-al-agape`);
      await v.click('button:has-text("Compartir")');
      await v.getByText('Copiar enlace').waitFor();
      const og = await v.getAttribute('meta[property="og:url"]', 'content');
      assert(og === `${BASE}/series/los-convidados-al-agape`, `og:url inesperado: ${og}`);
      const ld = await v.locator('script[type="application/ld+json"]').first().textContent();
      assert(JSON.parse(ld)['@type'] === 'TVSeries', 'falta JSON-LD de la serie');
    });

    // ------------------------------------------------------------------ Espectador registrado
    console.log('Espectador registrado');
    const userCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const u = await userCtx.newPage(); watch(u, 'usuario');
    await step('crea una cuenta', async () => {
      await u.goto(`${BASE}/cuenta/registro`);
      await u.fill('#name', 'Espectadora E2E'); await u.fill('#email', 'espectadora@e2e.test'); await u.fill('#password', 'Espectadora2026');
      await u.check('input[name=terms]');
      await u.click('button:has-text("Crear cuenta")');
      await u.waitForURL(`${BASE}/`);
    });
    await step('guarda el progreso al pausar y continúa desde ese punto', async () => {
      await u.goto(`${BASE}/series/los-convidados-al-agape/temporada-1/episodio-1/ver`);
      await waitPlaying(u, 1);
      await u.evaluate(() => { document.querySelector('video').currentTime = 24; });
      await waitPlaying(u, 25);
      await u.keyboard.press('k');
      await u.waitForTimeout(1500);
      await u.goto(`${BASE}/series/los-convidados-al-agape/temporada-1/episodio-1/ver`);
      await expectOk(u, 'Continuando desde 0:2');
      const t = await u.waitForFunction(() => document.querySelector('video')?.currentTime > 20).then(() => videoTime(u));
      assert(t > 20, `no reanudó (t=${t})`);
      await u.keyboard.press('k');
    });
    await step('añade a Mi lista y aparece en «Continúa viendo»', async () => {
      await u.goto(`${BASE}/series/los-convidados-al-agape`);
      await u.click('button:has-text("Mi lista")');
      await u.getByRole('button', { name: 'En mi lista' }).waitFor();
      await u.goto(`${BASE}/mi-lista`);
      await expectOk(u, 'Continúa viendo');
      await expectOk(u, 'Guardadas');
      await shot(u, '07-mi-lista');
    });
    await step('un espectador no puede entrar al panel', async () => {
      await u.goto(`${BASE}/admin`);
      assert(!u.url().includes('/admin'), `acceso indebido: ${u.url()}`);
    });

    // ------------------------------------------------------------------ Retirada y móvil
    console.log('Retirada y dispositivos');
    await step('retira el episodio y deja de estar disponible', async () => {
      await a.goto(`${BASE}/admin/episodios/${episodeId}`);
      await a.selectOption('#to', 'withdrawn'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Estado actualizado.');
      const res = await v.goto(`${BASE}/series/los-convidados-al-agape/temporada-1/episodio-1/ver`);
      assert(res.status() === 404, `esperaba 404, obtuvo ${res.status()}`);
      await a.selectOption('#to', 'published'); await a.click('button:has-text("Aplicar")');
      await expectOk(a, 'Estado actualizado.');
    });
    await step('funciona en un teléfono', async () => {
      const m = await browser.newContext({ ...devices['iPhone 13'] });
      const p = await m.newPage(); watch(p, 'móvil');
      await p.goto(BASE);
      await p.getByRole('heading', { name: 'Los Convidados al Ágape', level: 1 }).waitFor();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `desbordamiento horizontal de ${overflow}px`);
      await p.click('button:has-text("Sólo lo esencial")');
      await shot(p, '08-movil-portada');
      await p.goto(`${BASE}/series/los-convidados-al-agape/temporada-1/episodio-1/ver`);
      await waitPlaying(p, 1);
      await shot(p, '09-movil-reproductor');
      await m.close();
    });
    assert(consoleErrors.length === 0, `errores en consola:\n${consoleErrors.join('\n')}`);
  } finally {
    await browser.close();
    try { process.kill(-app.pid, 'SIGTERM'); } catch { app.kill('SIGTERM'); }
    cdn.close();
    fakeMux.close();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors, serverLog: log().slice(-5000) }, null, 2));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} pasos correctos. Capturas en tests/e2e/artifacts/`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
