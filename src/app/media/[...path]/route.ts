// Sirve imágenes y subtítulos guardados en disco local (desarrollo o servidor propio).
// En Vercel se usa Supabase Storage (STORAGE_DRIVER=supabase) y esta ruta no interviene.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', vtt: 'text/vtt; charset=utf-8' };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (parts.some((p) => p === '..' || p.startsWith('.') || p.includes('\\'))) return new Response('No encontrado', { status: 404 });
  const root = path.resolve(env.storage.localDir, 'public');
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) return new Response('No encontrado', { status: 404 });
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!TYPES[ext]) return new Response('No encontrado', { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { 'content-type': TYPES[ext], 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return new Response('No encontrado', { status: 404 });
  }
}
