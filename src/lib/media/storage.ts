// Almacenamiento de imágenes y subtítulos. Los videos NUNCA pasan por aquí: van directos al proveedor.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env';

export class UploadError extends Error {}

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const SUBTITLE_MAX_BYTES = 2 * 1024 * 1024;

export function detectImage(buf: Buffer): { ext: string; type: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  if (buf.subarray(4, 12).toString('latin1') === 'ftypavif') return { ext: 'avif', type: 'image/avif' };
  return null;
}

/** Lee ancho y alto de JPEG/PNG/WebP sin dependencias (null si no se puede). */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch { /* cabecera incompleta */ }
  return null;
}

/** Convierte SRT a WebVTT; valida que el resultado sea WebVTT. */
export function toWebVTT(text: string): string {
  let t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!t.startsWith('WEBVTT')) {
    if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/.test(t)) throw new UploadError('El archivo no es WebVTT ni SRT válido.');
    t = 'WEBVTT\n\n' + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  }
  if (/<script/i.test(t)) throw new UploadError('El subtítulo contiene marcado no permitido.');
  return t + '\n';
}

export async function saveObject(folder: string, body: Buffer, ext: string, contentType: string): Promise<{ url: string; path: string }> {
  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
  if (env.storage.driver === 'supabase') {
    const base = env.storage.supabaseUrl;
    const keyHeader = env.storage.supabaseServiceKey;
    if (!base || !keyHeader) throw new UploadError('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
    const res = await fetch(`${base}/storage/v1/object/${env.storage.bucket}/${key}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keyHeader}`, 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable', 'x-upsert': 'false' },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new UploadError(`Supabase Storage respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { url: `${base}/storage/v1/object/public/${env.storage.bucket}/${key}`, path: key };
  }
  const dir = path.resolve(env.storage.localDir, 'public', path.dirname(key));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.resolve(env.storage.localDir, 'public', key), body);
  return { url: `/media/${key}`, path: key };
}

export async function deleteObject(key: string | null | undefined) {
  if (!key) return;
  if (env.storage.driver === 'supabase') {
    await fetch(`${env.storage.supabaseUrl}/storage/v1/object/${env.storage.bucket}/${key}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${env.storage.supabaseServiceKey}` },
    }).catch(() => {});
    return;
  }
  const full = path.resolve(env.storage.localDir, 'public', key);
  if (full.startsWith(path.resolve(env.storage.localDir, 'public'))) await fs.rm(full, { force: true });
}

export async function storeImage(folder: string, file: File | Buffer): Promise<{ url: string; path: string; width: number | null; height: number | null }> {
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer());
  if (!buf.length) throw new UploadError('Selecciona una imagen.');
  if (buf.length > IMAGE_MAX_BYTES) throw new UploadError('La imagen supera 15 MB.');
  const kind = detectImage(buf);
  if (!kind) throw new UploadError('Formato de imagen no admitido. Usa JPG, PNG, WebP o AVIF.');
  const size = imageSize(buf);
  const saved = await saveObject(folder, buf, kind.ext, kind.type);
  return { ...saved, width: size?.width ?? null, height: size?.height ?? null };
}

export async function storeSubtitle(folder: string, file: File | Buffer) {
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer());
  if (!buf.length) throw new UploadError('Selecciona un archivo de subtítulos.');
  if (buf.length > SUBTITLE_MAX_BYTES) throw new UploadError('El subtítulo supera 2 MB.');
  const vtt = toWebVTT(buf.toString('utf8'));
  return saveObject(folder, Buffer.from(vtt, 'utf8'), 'vtt', 'text/vtt; charset=utf-8');
}
