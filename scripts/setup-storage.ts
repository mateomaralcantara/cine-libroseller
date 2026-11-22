// Crea (o corrige) el bucket público de Supabase Storage para imágenes y subtítulos.
// Uso: npm run storage:setup
import './load-env';

const LIMIT = 15 * 1024 * 1024;
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'text/vtt'];

async function main() {
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET || 'media').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) throw new Error('SUPABASE_URL debe ser https://<id-del-proyecto>.supabase.co (Project Settings → API).');
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (Project Settings → API Keys → service_role).');
  const headers = { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' };
  const settings = { public: true, file_size_limit: LIMIT, allowed_mime_types: MIME };
  const get = await fetch(`${base}/storage/v1/bucket/${bucket}`, { headers });
  const body = await get.json().catch(() => ({})) as { error?: string; message?: string; statusCode?: string };
  if (get.ok) {
    const put = await fetch(`${base}/storage/v1/bucket/${bucket}`, { method: 'PUT', headers, body: JSON.stringify(settings) });
    if (!put.ok) throw new Error(`No se pudo actualizar el bucket: ${put.status} ${await put.text()}`);
    console.log(`✓ El bucket «${bucket}» ya existía: queda público, con límite de 15 MB y sólo imágenes y .vtt.`);
    return;
  }
  if (/jwt|jws|signature|unauthorized/i.test(`${body.error} ${body.message}`)) throw new Error('Supabase rechazó la clave: usa la «service_role», no la «anon».');
  const post = await fetch(`${base}/storage/v1/bucket`, { method: 'POST', headers, body: JSON.stringify({ id: bucket, name: bucket, ...settings }) });
  if (!post.ok) throw new Error(`No se pudo crear el bucket: ${post.status} ${await post.text()}`);
  console.log(`✓ Bucket «${bucket}» creado: público, límite de 15 MB, sólo imágenes y subtítulos .vtt.`);
}

main().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exitCode = 1; });
