// Imagen para compartir en redes (WhatsApp, Facebook, Instagram, X, Telegram, LinkedIn…).
// Recibe la portada original y devuelve un JPEG 1200×630 ligero: es el formato que todas las redes
// muestran en grande. Las portadas verticales (pósters) se centran sobre un fondo desenfocado de sí mismas.
// Sólo acepta imágenes de nuestro almacenamiento (Supabase, disco local o Mux), nunca URLs arbitrarias.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const W = 1200;
const H = 630;
const MAX_BYTES = 30 * 1024 * 1024;

function allowedHosts() {
  const hosts = new Set(['image.mux.com']);
  if (env.storage.supabaseUrl) {
    try { hosts.add(new URL(env.storage.supabaseUrl).hostname); } catch { /* URL inválida: se ignora */ }
  }
  return hosts;
}

async function loadSource(src: string): Promise<Buffer | null> {
  // Archivos del almacenamiento local (/media/imagenes/...): se leen de disco, nunca videos
  if (src.startsWith('/media/')) {
    const parts = src.slice('/media/'.length).split('?')[0].split('/').map(decodeURIComponent);
    if (parts[0] === 'videos' || parts.some((p) => !p || p === '..' || p.startsWith('.') || p.includes('\\'))) return null;
    const root = path.resolve(env.storage.localDir, 'public');
    const file = path.resolve(root, ...parts);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      const st = await fs.stat(file);
      return st.isFile() && st.size <= MAX_BYTES ? await fs.readFile(file) : null;
    } catch { return null; }
  }
  let url: URL;
  try { url = new URL(src); } catch { return null; }
  if (url.protocol !== 'https:' || !allowedHosts().has(url.hostname)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= MAX_BYTES ? buf : null;
  } catch { return null; }
}

async function render(input: Buffer): Promise<Buffer> {
  const img = sharp(input, { failOn: 'none', limitInputPixels: 60_000_000 }).rotate();
  const meta = await img.metadata();
  const ratio = meta.width && meta.height ? meta.width / meta.height : W / H;
  // Horizontal (o casi): se recorta para llenar el marco, priorizando la zona con más interés visual
  if (ratio >= 1.3) {
    return img.resize(W, H, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();
  }
  // Vertical o cuadrada: póster completo centrado sobre un fondo desenfocado y oscurecido de la misma imagen
  const [bg, fg] = await Promise.all([
    // Se difumina una versión más grande y se recorta el centro: así los bordes no quedan claros
    sharp(input, { failOn: 'none' }).rotate().resize(W + 160, H + 160, { fit: 'cover' }).blur(28).modulate({ brightness: 0.55 })
      .extract({ left: 80, top: 80, width: W, height: H }).toBuffer(),
    sharp(input, { failOn: 'none' }).rotate().resize({ height: H - 40, width: W - 80, fit: 'inside' }).toBuffer(),
  ]);
  return sharp(bg).composite([{ input: fg, gravity: 'center' }])
    .jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();
}

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('src') ?? '';
  const fallback = () => Response.redirect(new URL('/opengraph-image', env.siteUrl), 302);
  if (!src || src.length > 2048) return fallback();
  const input = await loadSource(src);
  if (!input) return fallback();
  let out: Buffer;
  try { out = await render(input); } catch { return fallback(); }
  return new Response(new Uint8Array(out), {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(out.length),
      // Las redes guardan su propia copia; aquí cacheamos en el CDN para no recalcular en cada visita
      'cache-control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
