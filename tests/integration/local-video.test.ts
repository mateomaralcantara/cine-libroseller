import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import { resetDb, makeUser, addImage, verifyRights } from '../helpers';
import { sql } from '@/lib/db';
import type { Viewer } from '@/lib/auth/core';
import { createLocalUpload, appendLocalChunk, localUploadOffset, completeLocalUpload, approveAsset, mp4Duration, VideoError } from '@/lib/video/service';
import { setTitleStatus, setEpisodeStatus } from '@/lib/catalog/admin';
import { resolvePlayback } from '@/lib/playback';

/** MP4 mínimo: caja ftyp + moov/mvhd (duración 905,4 s) + relleno. */
function fakeMp4(totalBytes: number) {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
  const mvhd = Buffer.alloc(108); mvhd.writeUInt32BE(108, 0); mvhd.write('mvhd', 4, 'latin1');
  mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(905400, 24);
  const moov = Buffer.concat([Buffer.from([0, 0, 0, 116]), Buffer.from('moov'), mvhd]);
  return Buffer.concat([ftyp, moov, Buffer.alloc(totalBytes - ftyp.length - moov.length, 7)]);
}

let admin: Viewer;
let epId: string;
let seriesId: string;

describe('video local (pruebas sin Mux)', () => {
  beforeAll(async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    await resetDb();
    admin = await makeUser('admin');
    const [s] = await sql`select id from titles where slug = 'los-convidados-al-agape'`;
    seriesId = s.id;
    [{ id: epId }] = await sql`select id from episodes where title_id = ${seriesId} and number = 1`;
  });

  it('lee la duración del MP4', () => {
    expect(mp4Duration(fakeMp4(4096))).toBe(905.4);
  });

  it('rechaza formatos que el navegador no reproduce y el modo Supabase', async () => {
    await expect(createLocalUpload(admin.id, { ownerType: 'episode', ownerId: epId, file: { name: 'master.mov', size: 100, type: 'video/quicktime' } })).rejects.toThrow(/MP4/);
    vi.stubEnv('STORAGE_DRIVER', 'supabase');
    await expect(createLocalUpload(admin.id, { ownerType: 'episode', ownerId: epId, file: { name: 'e1.mp4', size: 100, type: 'video/mp4' } })).rejects.toBeInstanceOf(VideoError);
    vi.stubEnv('STORAGE_DRIVER', 'local');
  });

  it('sube por partes, reanuda tras un corte, verifica y queda «En revisión»', async () => {
    const file = fakeMp4(20 * 1024 * 1024 + 123);
    const { assetId, chunkSize } = await createLocalUpload(admin.id, { ownerType: 'episode', ownerId: epId, file: { name: 'episodio1.mp4', size: file.length, type: 'video/mp4' } });
    await appendLocalChunk(assetId, 0, file.subarray(0, chunkSize));
    // Corte: el cliente reintenta una parte desde un offset desfasado y el servidor le indica dónde seguir
    const mismatch = await appendLocalChunk(assetId, 0, file.subarray(0, chunkSize));
    expect(mismatch).toEqual({ received: chunkSize, mismatch: true });
    expect((await localUploadOffset(assetId)).received).toBe(chunkSize);
    for (let o = chunkSize; o < file.length; o += chunkSize) await appendLocalChunk(assetId, o, file.subarray(o, o + chunkSize));
    const done = await completeLocalUpload(admin.id, assetId);
    expect(done).toEqual({ status: 'in_review', duration: 905.4 });
    const [a] = await sql`select status, source_url, duration_seconds from video_assets where id = ${assetId}`;
    expect(a.source_url).toBe(`/media/videos/${assetId}.mp4`);
    expect(fs.existsSync(`storage-test/public/videos/${assetId}.mp4`)).toBe(true);
    expect(fs.statSync(`storage-test/public/videos/${assetId}.mp4`).size).toBe(file.length);

    // Aprobar, publicar y reproducir
    await approveAsset(admin.id, assetId);
    await verifyRights(admin.id, seriesId);
    await addImage('title', seriesId, 'poster'); await addImage('title', seriesId, 'backdrop');
    await sql`update titles set synopsis_short = 'Prueba' where id = ${seriesId}`;
    await setTitleStatus(admin.id, seriesId, 'published');
    await setEpisodeStatus(admin.id, epId, 'published');
    const p = await resolvePlayback({ contentType: 'episode', contentId: epId, viewer: null, country: 'DO' });
    expect(p.ok && { src: p.src, kind: p.kind }).toEqual({ src: `/media/videos/${assetId}.mp4`, kind: 'mp4' });
  });

  it('rechaza un archivo que no es video aunque se llame .mp4', async () => {
    const bogus = Buffer.from('esto no es un video'.repeat(10));
    const { assetId } = await createLocalUpload(admin.id, { ownerType: 'episode', ownerId: epId, file: { name: 'falso.mp4', size: bogus.length, type: 'video/mp4' } });
    await appendLocalChunk(assetId, 0, bogus);
    await expect(completeLocalUpload(admin.id, assetId)).rejects.toThrow(/no es un MP4/);
    const [a] = await sql`select status from video_assets where id = ${assetId}`;
    expect(a.status).toBe('error');
  });

  it('no acepta más datos de los anunciados ni completar sin todos los bytes', async () => {
    const { assetId } = await createLocalUpload(admin.id, { ownerType: 'episode', ownerId: epId, file: { name: 'b.mp4', size: 10, type: 'video/mp4' } });
    await expect(appendLocalChunk(assetId, 0, Buffer.alloc(11))).rejects.toThrow(/más datos/);
    await appendLocalChunk(assetId, 0, Buffer.alloc(5));
    await expect(completeLocalUpload(admin.id, assetId)).rejects.toThrow(/Faltan datos/);
  });
});
