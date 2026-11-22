// Verifica la configuración de .env.local SIN mostrar contraseñas ni claves.
// Uso: npm run env:check
import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { passwordProblem } from '../src/lib/auth/password';

let errors = 0;
let warnings = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => { warnings++; console.log(`  ⚠ ${m}`); };
const fail = (m: string) => { errors++; console.log(`  ✗ ${m}`); };
const section = (t: string) => console.log(`\n${t}`);
const env = (k: string) => (process.env[k] || '').trim();
const PLACEHOLDER = /xxxx|\[TU-CONTRASEÑA\]|\[YOUR-PASSWORD\]|CONTRASEÑA@/i;

function explainDbError(e: unknown): string {
  const err = e as { code?: string; message?: string };
  const msg = err.message || String(e);
  if (/tenant\/user .* not found/i.test(msg)) return 'Supabase no reconoce el usuario. En el pooler el usuario es «postgres.<id-del-proyecto>»: copia la cadena completa desde Supabase.';
  if (err.code === '28P01' || /password authentication failed/i.test(msg)) return 'Contraseña incorrecta. Restablécela en Supabase (Project Settings → Database → Reset database password) y actualiza .env.local.';
  if (err.code === 'ENOTFOUND') return 'No se encuentra el servidor. Revisa que el host esté bien copiado y que tengas conexión a internet.';
  if (err.code === 'ECONNREFUSED') return 'El servidor rechazó la conexión. Si es una base local, ¿está PostgreSQL encendido? Si es Supabase, revisa host y puerto.';
  if (err.code === 'ETIMEDOUT' || /timeout/i.test(msg)) return 'Tiempo de espera agotado. Puede que tu red o un firewall bloquee el puerto 5432/6543. Prueba con el pooler (puerto 6543).';
  if (err.code === '3D000') return 'La base de datos indicada al final de la URL no existe (normalmente debe ser «/postgres»).';
  if (/self.signed|certificate/i.test(msg)) return 'Problema de certificado SSL. Añade «?sslmode=require» al final de DATABASE_URL.';
  return msg;
}

async function main() {
  console.log('Comprobando la configuración de CINE LIBROSELLER (no se muestran secretos)…');

  section('Archivo');
  const file = path.resolve('.env.local');
  if (fs.existsSync(file)) {
    ok('.env.local encontrado');
    const raw = fs.readFileSync(file, 'utf8');
    if (/^\s*DATABASE_URL\s*=\s*["'].*["']\s*$/m.test(raw)) ok('DATABASE_URL entre comillas (se aceptan)');
    const dupes = raw.split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1]).filter(Boolean).filter((k, i, a) => a.indexOf(k) !== i);
    if (dupes.length) warn(`Variables repetidas (cuenta la primera): ${[...new Set(dupes)].join(', ')}`);
  } else {
    fail('No existe .env.local en esta carpeta. Copia .env.example como .env.local (Copy-Item .env.example .env.local).');
  }

  section('Base de datos (DATABASE_URL)');
  const dbUrl = env('DATABASE_URL');
  let url: URL | null = null;
  if (!dbUrl) fail('Falta DATABASE_URL.');
  else if (PLACEHOLDER.test(dbUrl)) fail('DATABASE_URL sigue teniendo el valor de ejemplo. Copia la URI real desde Supabase (Connect → Transaction pooler) y pon tu contraseña sin corchetes.');
  else {
    try { url = new URL(dbUrl); } catch { fail('DATABASE_URL no es una URL válida. Si la contraseña tiene símbolos (@ # / ? %), cámbiala en Supabase por una sólo con letras y números.'); }
  }
  if (url) {
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail(`Debe empezar por postgresql:// (empieza por ${url.protocol}//).`);
    const masked = `${url.protocol}//${url.username}:••••@${url.hostname}:${url.port || '5432'}${url.pathname}`;
    ok(`Formato correcto: ${masked}`);
    if (!url.password && url.hostname.includes('supabase')) fail('La URL no lleva contraseña: Supabase la necesita.');
    if (/\[|\]/.test(decodeURIComponent(url.password))) fail('La contraseña contiene corchetes: quita los [ ] que rodeaban «YOUR-PASSWORD».');
    if (url.hostname.includes('pooler.supabase.com') && !url.username.startsWith('postgres.')) fail('Con el pooler de Supabase el usuario debe ser «postgres.<id-del-proyecto>», no sólo «postgres».');
    if (url.hostname.includes('pooler.supabase.com') && url.port === '5432') warn('Usas el pooler en modo sesión (5432). Funciona; para Vercel se recomienda el modo transacción (6543).');

    const sql = postgres(dbUrl, { max: 1, connect_timeout: 10, prepare: false, onnotice: () => {} });
    try {
      const t = Date.now();
      const [{ version }] = await sql`select version()`;
      ok(`Conexión correcta (${Date.now() - t} ms) · ${String(version).split(' on ')[0]}`);
      const [{ exists }] = await sql`select to_regclass('public.schema_migrations') is not null as exists`;
      const files = fs.readdirSync(path.resolve('supabase/migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
      if (!exists) fail('La base de datos está vacía: ejecuta «npm run db:migrate».');
      else {
        const done = new Set((await sql`select version from schema_migrations`).map((r) => r.version as string));
        const pending = files.filter((f) => !done.has(f));
        if (pending.length) fail(`Migraciones pendientes (${pending.length}): ejecuta «npm run db:migrate».`);
        else ok(`Migraciones al día (${files.length})`);
        const [{ genres }] = await sql`select count(*)::int as genres from genres`;
        const [{ sections }] = await sql`select count(*)::int as sections from homepage_sections`;
        if (!genres || !sections) fail('Faltan los datos base: ejecuta «npm run db:seed».');
        else ok(`Datos base cargados (${genres} géneros, ${sections} secciones de portada)`);
        const [{ admins }] = await sql`select count(*)::int as admins from profiles where role = 'admin' and status = 'active'`;
        if (!admins) fail('No hay ningún administrador: ejecuta «npm run admin:create -- tu@email.com "Tu nombre"».');
        else ok(`${admins} ${admins === 1 ? 'cuenta' : 'cuentas'} de administración`);
        const [{ series }] = await sql`select count(*)::int as series from titles where slug = 'los-convidados-al-agape'`;
        if (series) ok('Serie inaugural «Los Convidados al Ágape» creada');
      }
    } catch (e) {
      fail(`No se pudo conectar: ${explainDbError(e)}`);
    } finally {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  }

  section('Sitio');
  const site = env('NEXT_PUBLIC_SITE_URL');
  if (!site) warn('Falta NEXT_PUBLIC_SITE_URL (se usará http://localhost:3000). En producción: https://cine.libroseller.com');
  else {
    try {
      const u = new URL(site);
      if (u.pathname !== '/' || site.endsWith('/')) warn('NEXT_PUBLIC_SITE_URL no debe llevar ruta ni barra final (ej.: http://localhost:3000).');
      if (u.hostname === 'cine.libroseller.com') ok('NEXT_PUBLIC_SITE_URL apunta a producción (en local puedes usar http://localhost:3000)');
      else ok(`NEXT_PUBLIC_SITE_URL = ${u.origin}`);
    } catch { fail('NEXT_PUBLIC_SITE_URL no es una URL válida.'); }
  }

  section('Imágenes y subtítulos');
  const driver = env('STORAGE_DRIVER') || 'local';
  if (driver === 'local') ok('STORAGE_DRIVER=local (archivos en la carpeta ./storage: ideal para desarrollo)');
  else if (driver === 'supabase') {
    const su = env('SUPABASE_URL'); const key = env('SUPABASE_SERVICE_ROLE_KEY'); const bucket = env('SUPABASE_STORAGE_BUCKET') || 'media';
    if (!su || PLACEHOLDER.test(su)) fail('STORAGE_DRIVER=supabase necesita SUPABASE_URL real (https://<id>.supabase.co). Para probar en tu PC usa STORAGE_DRIVER=local.');
    if (!key) fail('Falta SUPABASE_SERVICE_ROLE_KEY (Project Settings → API → service_role).');
    if (su && key && !PLACEHOLDER.test(su)) {
      try {
        const r = await fetch(`${su.replace(/\/$/, '')}/storage/v1/bucket/${bucket}`, { headers: { authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
          const b = await r.json() as { public?: boolean };
          if (b.public) ok(`Bucket «${bucket}» accesible y público`);
          else fail(`El bucket «${bucket}» existe pero no es público: márcalo como público en Supabase Storage.`);
        } else if (r.status === 404 || r.status === 400) fail(`No existe el bucket «${bucket}»: créalo en Supabase → Storage (público).`);
        else fail(`Supabase Storage respondió ${r.status}: revisa SUPABASE_SERVICE_ROLE_KEY.`);
      } catch (e) { warn(`No se pudo comprobar Supabase Storage: ${(e as Error).message}`); }
    }
  } else fail(`STORAGE_DRIVER debe ser «local» o «supabase» (tiene «${driver}»).`);

  section('Video (Mux)');
  const id = env('MUX_TOKEN_ID'); const secret = env('MUX_TOKEN_SECRET');
  if (!id && !secret) ok('Mux sin configurar: podrás VINCULAR videos alojados en un CDN; la subida directa se activa al añadir las claves.');
  else if (!id || !secret) fail('Falta una de las dos claves de Mux (MUX_TOKEN_ID y MUX_TOKEN_SECRET van juntas).');
  else {
    try {
      const r = await fetch('https://api.mux.com/video/v1/assets?limit=1', { headers: { authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') }, signal: AbortSignal.timeout(10_000) });
      if (r.ok) ok('Credenciales de Mux válidas');
      else if (r.status === 401) fail('Mux rechazó las credenciales (401): revisa MUX_TOKEN_ID y MUX_TOKEN_SECRET.');
      else if (r.status === 403) fail('El token de Mux no tiene permiso de Mux Video (lectura y escritura).');
      else warn(`Mux respondió ${r.status}.`);
    } catch (e) { warn(`No se pudo contactar con Mux: ${(e as Error).message}`); }
    if (!env('MUX_WEBHOOK_SECRET')) fail('Con Mux configurado hace falta MUX_WEBHOOK_SECRET; sin él los videos se quedan en «Procesando». (En local, Mux no puede llamar a localhost: usa «Consultar proveedor» en el panel.)');
    else ok('MUX_WEBHOOK_SECRET definido');
  }
  const kid = env('MUX_SIGNING_KEY_ID'); const pk = env('MUX_SIGNING_PRIVATE_KEY');
  if (kid || pk) {
    if (!kid || !pk) fail('La reproducción firmada necesita MUX_SIGNING_KEY_ID y MUX_SIGNING_PRIVATE_KEY juntas.');
    else {
      try { crypto.createPrivateKey(Buffer.from(pk, 'base64').toString('utf8')); ok('Clave de firma de Mux válida'); }
      catch { fail('MUX_SIGNING_PRIVATE_KEY no es válida: pega la clave privada en base64 tal como la entrega Mux.'); }
    }
  }

  section('Otros');
  if (env('CRON_SECRET')) ok(env('CRON_SECRET').length >= 16 ? 'CRON_SECRET definido' : 'CRON_SECRET definido (conviene que tenga 16+ caracteres)');
  else warn('CRON_SECRET vacío: no hace falta en local; en Vercel defínelo para activar los estrenos programados.');
  const ap = env('ADMIN_PASSWORD');
  if (ap) { const p = passwordProblem(ap); if (p) fail(`ADMIN_PASSWORD: ${p}`); else ok('ADMIN_PASSWORD cumple la política'); }
  if (env('ALLOW_INSECURE_VIDEO_LINKS') === '1') warn('ALLOW_INSECURE_VIDEO_LINKS=1 es sólo para pruebas: quítalo fuera de tu PC.');

  console.log(`\n${errors ? `✗ ${errors} ${errors === 1 ? 'problema' : 'problemas'}` : '✓ Configuración correcta'}${warnings ? ` · ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}` : ''}`);
  if (!errors) console.log('  Siguiente paso: npm run dev  →  http://localhost:3000');
  process.exit(errors ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
