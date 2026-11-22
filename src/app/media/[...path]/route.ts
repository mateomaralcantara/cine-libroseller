// Sirve imágenes, subtítulos y (en modo local) videos guardados en disco, con soporte de Range
// para que el reproductor pueda avanzar y retroceder. En Vercel se usa Supabase Storage y Mux.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { sql } from '@/lib/db';
import { viewerFromToken, canEdit } from '@/lib/auth/core';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', vtt: 'text/vtt; charset=utf-8',
  mp4: 'video/mp4', webm: 'video/webm',
};

const notFound = () => new Response('No encontrado', { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes('\\'))) return notFound();
  const root = path.resolve(env.storage.localDir, 'public');
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) return notFound();
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!TYPES[ext]) return notFound();
  // Videos locales: sólo se entregan si están publicados (o a editores, para la previsualización privada)
  if (parts[0] === 'videos') {
    const id = path.basename(file, path.extname(file));
    if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
    const [a] = await sql`select status from video_assets where id = ${id} and provider = 'local'`;
    if (!a) return notFound();
    if (a.status !== 'published' && !canEdit(await viewerFromToken(req.cookies.get('cls_session')?.value))) return notFound();
  }
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return notFound(); }
  if (!stat.isFile()) return notFound();

  const base: Record<string, string> = {
    'content-type': TYPES[ext], 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff',
    'cache-control': ext === 'mp4' || ext === 'webm' ? 'private, max-age=3600' : 'public, max-age=31536000, immutable',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start); end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...base, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...base, 'content-length': String(stat.size) } });
}
