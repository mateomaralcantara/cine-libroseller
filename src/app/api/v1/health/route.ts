import { sql } from '@/lib/db';
import { json } from '@/lib/http';
import { env } from '@/lib/env';
import { localUploadsAvailable } from '@/lib/video/service';

export const dynamic = 'force-dynamic';

/** Diagnóstico sin secretos: dice qué falla en la base de datos y el almacenamiento, nunca valores. */
function databaseProblem(e: unknown): string {
  const err = e as { code?: string; message?: string; name?: string };
  const msg = String(err.message || '');
  const raw = process.env.DATABASE_URL || '';
  if (!raw.trim()) return 'DATABASE_URL no está definida';
  if (/xxxx|\[TU-CONTRASEÑA\]|\[YOUR-PASSWORD\]/i.test(raw)) return 'DATABASE_URL tiene el valor de ejemplo';
  let host = '';
  try { host = new URL(raw).hostname; } catch { return 'DATABASE_URL no es una URL válida (¿símbolos sin codificar en la contraseña?)'; }
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host) && process.env.VERCEL) return 'Usa la conexión directa de Supabase (sólo IPv6), que Vercel no puede usar: pon la cadena del «Transaction pooler» (puerto 6543)';
  if (/tenant\/user .* not found/i.test(msg)) return 'Supabase no reconoce el usuario: en el pooler debe ser postgres.<id-del-proyecto>';
  if (err.code === '28P01' || /password authentication failed/i.test(msg)) return 'Contraseña de la base de datos incorrecta';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'No se encuentra el servidor de la base de datos (host mal escrito o sin IPv4)';
  if (err.code === 'ECONNREFUSED') return 'El servidor de la base de datos rechazó la conexión';
  if (err.code === 'ETIMEDOUT' || err.code === 'CONNECT_TIMEOUT' || /timeout/i.test(msg)) return 'Tiempo de espera agotado al conectar con la base de datos';
  if (/relation .* does not exist/i.test(msg)) return 'La base de datos no tiene las tablas: ejecuta «npm run db:migrate» contra ella';
  return 'Error de conexión no identificado';
}

export async function GET() {
  let database = 'ok';
  let problem: string | undefined;
  try {
    await sql`select 1 from titles limit 1`;
  } catch (e) {
    database = 'error';
    problem = databaseProblem(e);
  }
  const local = localUploadsAvailable();
  const storageProblem = env.storage.driver === 'local' && process.env.VERCEL
    ? 'STORAGE_DRIVER=local no funciona en Vercel: usa STORAGE_DRIVER=supabase'
    : env.storage.driver === 'supabase' && (!env.storage.supabaseUrl || !env.storage.supabaseServiceKey) ? 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' : undefined;
  return json({
    ok: database === 'ok' && !storageProblem,
    database, ...(problem ? { database_problem: problem } : {}),
    storage: env.storage.driver, ...(storageProblem ? { storage_problem: storageProblem } : {}),
    video_provider: env.mux.configured ? 'mux' : local.ok ? 'local (pruebas) y enlaces' : 'solo enlaces',
    site_url: env.siteUrl,
  }, database === 'ok' ? 200 : 503);
}
