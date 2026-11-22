// Ciclo de vida de los videos:
// pending → uploading → processing → in_review → ready → published   (o → error en cualquier paso)
//
// - Mux: el navegador sube el archivo directamente a Mux; Mux avisa por webhook firmado.
// - Enlace: el video ya está en un CDN; se valida la URL y pasa a revisión.
// Un video sólo se considera reproducible cuando el proveedor lo confirma (ready/published).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { sql, type Tx } from '../db';
import { env } from '../env';
import { audit } from '../audit';
import { mux, verifyMuxSignature, ProviderError, type MuxAsset } from './mux';
import { validateVideoLink } from './link';

export type OwnerType = 'episode' | 'title' | 'trailer';
export class VideoError extends Error {}

const ALLOWED_MIME = /^video\/(mp4|quicktime|x-matroska|webm|x-msvideo|mpeg|mxf)$|^application\/mxf$/;
export const MAX_UPLOAD_BYTES = 200 * 1024 ** 3; // 200 GB (límite práctico; Mux admite archivos maestros grandes)

async function ownerExists(ownerType: OwnerType, ownerId: string, db: Tx = sql) {
  const table = ownerType === 'episode' ? 'episodes' : ownerType === 'title' ? 'titles' : 'trailers';
  const [row] = await db`select id from ${db(table)} where id = ${ownerId}`;
  if (!row) throw new VideoError('La producción indicada no existe.');
}

async function nextVersion(ownerType: OwnerType, ownerId: string, db: Tx) {
  const [r] = await db`select coalesce(max(version), 0) + 1 as v from video_assets where owner_type = ${ownerType} and owner_id = ${ownerId}`;
  return Number(r.v);
}

export function validateUploadRequest(file: { name: string; size: number; type: string }) {
  if (!file.name || !file.size) throw new VideoError('Selecciona un archivo de video.');
  if (file.size > MAX_UPLOAD_BYTES) throw new VideoError('El archivo supera el tamaño máximo admitido.');
  const okExt = /\.(mp4|mov|m4v|mkv|webm|avi|mpg|mpeg|mxf)$/i.test(file.name);
  if (!(file.type && ALLOWED_MIME.test(file.type)) && !okExt) throw new VideoError(`Formato no admitido (${file.type || file.name}). Usa MP4, MOV, MKV, WebM o MXF.`);
}

/** Paso 1-5: registra el trabajo y obtiene una URL de subida directa (y reanudable) de Mux. */
export async function createMuxUpload(actorId: string, input: { ownerType: OwnerType; ownerId: string; file: { name: string; size: number; type: string }; signed: boolean; corsOrigin: string }) {
  validateUploadRequest(input.file);
  await ownerExists(input.ownerType, input.ownerId);
  if (!env.mux.configured) throw new VideoError('Mux no está configurado. Añade MUX_TOKEN_ID y MUX_TOKEN_SECRET, o vincula un video ya alojado en un CDN.');
  const asset = await sql.begin(async (tx) => {
    const version = await nextVersion(input.ownerType, input.ownerId, tx);
    const [a] = await tx`insert into video_assets (owner_type, owner_id, provider, status, playback_policy, version, original_filename, created_by)
      values (${input.ownerType}, ${input.ownerId}, 'mux', 'pending', ${input.signed ? 'signed' : 'public'}, ${version}, ${input.file.name.slice(0, 250)}, ${actorId})
      returning id`;
    await tx`insert into media_upload_jobs (video_asset_id, provider, file_name, file_size, mime_type, created_by)
      values (${a.id}, 'mux', ${input.file.name.slice(0, 250)}, ${input.file.size}, ${input.file.type || null}, ${actorId})`;
    return a;
  });
  try {
    const upload = await mux.createDirectUpload({ corsOrigin: input.corsOrigin, signed: input.signed, passthrough: asset.id });
    await sql`update video_assets set provider_upload_id = ${upload.id}, status = 'uploading' where id = ${asset.id}`;
    await sql`update media_upload_jobs set status = 'uploading', attempts = attempts + 1 where video_asset_id = ${asset.id}`;
    await audit(actorId, 'video.upload_created', input.ownerType, input.ownerId, { asset: asset.id, file: input.file.name });
    return { assetId: asset.id as string, uploadUrl: upload.url };
  } catch (e) {
    await failAsset(asset.id, (e as Error).message);
    throw e instanceof ProviderError ? new VideoError(e.message) : e;
  }
}

/** El navegador terminó de enviar el archivo: queda «procesando» hasta que Mux confirme. */
export async function markUploadSent(assetId: string) {
  await sql`update video_assets set status = 'processing' where id = ${assetId} and status = 'uploading'`;
  await sql`update media_upload_jobs set status = 'uploaded' where video_asset_id = ${assetId} and status = 'uploading'`;
}

export async function markUploadFailed(assetId: string, message: string) {
  await failAsset(assetId, `La subida falló en el navegador: ${message.slice(0, 300)}`);
}

async function failAsset(assetId: string, message: string, db: Tx = sql) {
  await db`update video_assets set status = 'error', error_message = ${message.slice(0, 1000)} where id = ${assetId}`;
  await db`update media_upload_jobs set status = 'failed', error_message = ${message.slice(0, 1000)} where video_asset_id = ${assetId} and status not in ('completed', 'cancelled')`;
}

/** Vincula un video ya alojado (HLS/MP4 en CDN). Se valida de verdad antes de aceptarlo. */
export async function linkVideo(actorId: string | null, input: { ownerType: OwnerType; ownerId: string; url: string }, fetcher: typeof fetch = fetch) {
  await ownerExists(input.ownerType, input.ownerId);
  const check = await validateVideoLink(input.url, { fetcher });
  const [a] = await sql.begin(async (tx) => {
    const version = await nextVersion(input.ownerType, input.ownerId, tx);
    return tx`insert into video_assets (owner_type, owner_id, provider, source_url, status, error_message, version, created_by)
      values (${input.ownerType}, ${input.ownerId}, 'link', ${input.url.trim()}, ${check.ok ? 'in_review' : 'error'}, ${check.ok ? null : check.error}, ${version}, ${actorId})
      returning *`;
  });
  await audit(actorId, 'video.linked', input.ownerType, input.ownerId, { asset: a.id, ok: check.ok });
  if (!check.ok) throw new VideoError(check.error);
  return a;
}

function applyMuxAsset(asset: MuxAsset) {
  const video = asset.tracks?.find((t) => t.type === 'video');
  const playback = asset.playback_ids?.[0];
  return {
    playback_id: playback?.id ?? null,
    playback_policy: playback?.policy ?? 'public',
    duration_seconds: asset.duration ?? null,
    aspect_ratio: asset.aspect_ratio ?? null,
    max_resolution: asset.max_stored_resolution || asset.resolution_tier || (video?.max_height ? `${video.max_height}p` : null),
  };
}

async function storeMuxReady(assetRowId: string, asset: MuxAsset, db: Tx) {
  const f = applyMuxAsset(asset);
  if (!f.playback_id) {
    await failAsset(assetRowId, 'Mux marcó el video como listo pero sin playback ID.', db);
    return;
  }
  await db`update video_assets set provider_asset_id = ${asset.id}, playback_id = ${f.playback_id}, playback_policy = ${f.playback_policy},
    duration_seconds = ${f.duration_seconds}, aspect_ratio = ${f.aspect_ratio}, max_resolution = ${f.max_resolution},
    status = case when status in ('ready', 'published') then status else 'in_review' end, error_message = null
    where id = ${assetRowId}`;
  await db`update media_upload_jobs set status = 'completed', completed_at = now(), error_message = null where video_asset_id = ${assetRowId}`;
  await db`delete from video_tracks where video_asset_id = ${assetRowId}`;
  for (const t of asset.tracks ?? []) {
    if (t.type === 'text') continue;
    await db`insert into video_tracks (video_asset_id, kind, language, name, provider_track_id, is_primary)
      values (${assetRowId}, ${t.type}, ${t.language_code ?? null}, ${t.name ?? null}, ${t.id}, ${!!t.primary})`;
    if (t.type === 'video' && t.max_height) {
      await db`insert into video_encodings (video_asset_id, rendition, width, height)
        values (${assetRowId}, ${`${t.max_height}p`}, ${t.max_width ?? null}, ${t.max_height})
        on conflict (video_asset_id, rendition) do nothing`;
    }
  }
}

async function findAssetRow(db: Tx, ids: { passthrough?: string; assetId?: string; uploadId?: string }) {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (ids.passthrough && uuid.test(ids.passthrough)) {
    const [r] = await db`select * from video_assets where id = ${ids.passthrough} and provider = 'mux'`;
    if (r) return r;
  }
  if (ids.assetId) {
    const [r] = await db`select * from video_assets where provider = 'mux' and provider_asset_id = ${ids.assetId}`;
    if (r) return r;
  }
  if (ids.uploadId) {
    const [r] = await db`select * from video_assets where provider = 'mux' and provider_upload_id = ${ids.uploadId}`;
    if (r) return r;
  }
  return null;
}

/**
 * Procesa un webhook de Mux. Verifica firma, deduplica por id de evento y actualiza el estado.
 * Devuelve el resultado para registrar y responder (nunca lanza por eventos desconocidos).
 */
export async function handleMuxWebhook(rawBody: string, signatureHeader: string | null): Promise<{ status: number; result: string }> {
  const secret = env.mux.webhookSecret;
  if (!secret) return { status: 503, result: 'MUX_WEBHOOK_SECRET no configurado' };
  if (!verifyMuxSignature(rawBody, signatureHeader, secret)) return { status: 401, result: 'firma inválida' };
  let event: { id: string; type: string; data: Record<string, unknown> };
  try { event = JSON.parse(rawBody); } catch { return { status: 400, result: 'JSON inválido' }; }
  if (!event?.id || !event?.type) return { status: 400, result: 'evento incompleto' };

  const [stored] = await sql`insert into webhook_events (provider, event_id, event_type, payload)
    values ('mux', ${event.id}, ${event.type}, ${sql.json(event as never)})
    on conflict (provider, event_id) do nothing returning id`;
  if (!stored) return { status: 200, result: 'duplicado' };

  try {
    const d = event.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let outcome = 'ignored';
    await sql.begin(async (tx) => {
      switch (event.type) {
        case 'video.upload.asset_created': {
          const row = await findAssetRow(tx, { uploadId: d.id });
          if (row) {
            await tx`update video_assets set provider_asset_id = ${d.asset_id}, status = case when status in ('pending','uploading') then 'processing' else status end where id = ${row.id}`;
            await tx`update media_upload_jobs set status = 'processing' where video_asset_id = ${row.id} and status in ('created','uploading','uploaded')`;
            outcome = 'processed';
          }
          break;
        }
        case 'video.asset.created': {
          const row = await findAssetRow(tx, { passthrough: d.passthrough, assetId: d.id, uploadId: d.upload_id });
          if (row) {
            await tx`update video_assets set provider_asset_id = ${d.id}, status = case when status in ('pending','uploading') then 'processing' else status end where id = ${row.id}`;
            outcome = 'processed';
          }
          break;
        }
        case 'video.asset.ready': {
          const row = await findAssetRow(tx, { passthrough: d.passthrough, assetId: d.id, uploadId: d.upload_id });
          if (row) { await storeMuxReady(row.id, d as MuxAsset, tx); outcome = 'processed'; }
          break;
        }
        case 'video.asset.errored': {
          const row = await findAssetRow(tx, { passthrough: d.passthrough, assetId: d.id, uploadId: d.upload_id });
          if (row) {
            const msg = (d.errors?.messages as string[] | undefined)?.join(' ') || d.errors?.type || 'Mux no pudo procesar el archivo.';
            await failAsset(row.id, `Mux: ${msg}`, tx);
            outcome = 'processed';
          }
          break;
        }
        case 'video.upload.errored':
        case 'video.upload.cancelled': {
          const row = await findAssetRow(tx, { uploadId: d.id });
          if (row) {
            await failAsset(row.id, event.type === 'video.upload.cancelled' ? 'La subida se canceló.' : `Mux: ${d.error?.message || 'error de subida'}`, tx);
            outcome = 'processed';
          }
          break;
        }
        case 'video.asset.deleted': {
          const row = await findAssetRow(tx, { assetId: d.id });
          if (row && row.status !== 'published') { await failAsset(row.id, 'El asset fue eliminado en Mux.', tx); outcome = 'processed'; }
          break;
        }
        default:
          break;
      }
      await tx`update webhook_events set status = ${outcome === 'processed' ? 'processed' : 'ignored'}, processed_at = now() where id = ${stored.id}`;
    });
    return { status: 200, result: outcome };
  } catch (e) {
    await sql`update webhook_events set status = 'failed', error_message = ${(e as Error).message.slice(0, 1000)} where id = ${stored.id}`;
    return { status: 500, result: 'error interno' };
  }
}

/** Recuperación: consulta a Mux el estado real (por si un webhook se perdió). */
export async function refreshFromProvider(actorId: string, assetId: string, { quiet = false } = {}) {
  const [row] = await sql`select * from video_assets where id = ${assetId}`;
  if (!row) throw new VideoError('Video no encontrado.');
  if (row.provider === 'local') {
    if (row.status !== 'uploading' && !localVideoExists(row.source_url)) await failAsset(assetId, 'El archivo local ya no existe en la carpeta storage.');
    return (await sql`select * from video_assets where id = ${assetId}`)[0];
  }
  if (row.provider !== 'mux') {
    if (row.provider === 'link') {
      const check = await validateVideoLink(row.source_url);
      if (check.ok && row.status === 'error') await sql`update video_assets set status = 'in_review', error_message = null where id = ${assetId}`;
      if (!check.ok) await failAsset(assetId, check.error);
    }
    return (await sql`select * from video_assets where id = ${assetId}`)[0];
  }
  try {
    let providerAssetId = row.provider_asset_id as string | null;
    if (!providerAssetId && row.provider_upload_id) {
      const up = await mux.getUpload(row.provider_upload_id);
      if (up.status === 'errored' || up.status === 'cancelled' || up.status === 'timed_out') {
        await failAsset(assetId, `Mux: subida ${up.status}${up.error ? ` (${up.error.message})` : ''}`);
      }
      providerAssetId = up.asset_id ?? null;
      if (providerAssetId) await sql`update video_assets set provider_asset_id = ${providerAssetId}, status = case when status in ('pending','uploading') then 'processing' else status end where id = ${assetId}`;
    }
    if (providerAssetId) {
      const a = await mux.getAsset(providerAssetId);
      if (a.status === 'ready') await sql.begin((tx) => storeMuxReady(assetId, a, tx));
      else if (a.status === 'errored') await failAsset(assetId, `Mux: ${a.errors?.messages?.join(' ') || 'error de procesamiento'}`);
    }
  } catch (e) {
    throw new VideoError(e instanceof ProviderError ? e.message : 'No se pudo consultar el proveedor.');
  }
  if (!quiet) await audit(actorId, 'video.refreshed', 'video_asset', assetId);
  return (await sql`select * from video_assets where id = ${assetId}`)[0];
}

/**
 * Paso 9: el administrador revisó la previsualización privada y aprueba el video.
 * Pasa a «listo» y se convierte en la versión vigente de la obra (las anteriores quedan en el historial).
 */
export async function approveAsset(actorId: string, assetId: string) {
  return sql.begin(async (tx) => {
    const [a] = await tx`select * from video_assets where id = ${assetId} for update`;
    if (!a) throw new VideoError('Video no encontrado.');
    if (a.status !== 'in_review') throw new VideoError(`Sólo se aprueban videos en revisión (estado actual: ${a.status}).`);
    const [prev] = await tx`select * from video_assets where owner_type = ${a.owner_type} and owner_id = ${a.owner_id} and is_current`;
    const ownerLive = prev?.status === 'published';
    await tx`update video_assets set is_current = false where owner_type = ${a.owner_type} and owner_id = ${a.owner_id} and is_current`;
    if (prev) await tx`update video_assets set status = 'ready' where id = ${prev.id} and status = 'published'`;
    // Si la obra ya estaba publicada, la nueva versión sustituye a la anterior sin despublicar.
    await tx`update video_assets set is_current = true, status = ${ownerLive ? 'published' : 'ready'} where id = ${a.id}`;
    if (a.duration_seconds) {
      const minutes = Math.max(1, Math.round(Number(a.duration_seconds) / 60));
      if (a.owner_type === 'episode') await tx`update episodes set runtime_minutes = coalesce(runtime_minutes, ${minutes}) where id = ${a.owner_id}`;
      if (a.owner_type === 'title') await tx`update titles set runtime_minutes = coalesce(runtime_minutes, ${minutes}) where id = ${a.owner_id}`;
    }
    await audit(actorId, 'video.approved', a.owner_type, a.owner_id, { asset: a.id, version: a.version, replaced: prev?.id ?? null }, tx);
    return a.id as string;
  });
}

export async function currentAsset(ownerType: OwnerType, ownerId: string, db: Tx = sql) {
  const [a] = await db`select * from video_assets where owner_type = ${ownerType} and owner_id = ${ownerId} and is_current and status in ('ready', 'published')`;
  return a ?? null;
}

/** Al publicar la obra, su video vigente pasa a «publicado». */
export async function markOwnerVideoPublished(ownerType: OwnerType, ownerId: string, published: boolean, db: Tx = sql) {
  await db`update video_assets set status = ${published ? 'published' : 'ready'}
    where owner_type = ${ownerType} and owner_id = ${ownerId} and is_current and status in ('ready', 'published')`;
}

// ------------------------------------------------------------------ Proveedor «local» (pruebas en tu PC)
// El archivo se sube por partes al propio servidor y se guarda en <LOCAL_STORAGE_DIR>/public/videos.
// Sólo con STORAGE_DRIVER=local y fuera de Vercel (que no tiene disco persistente).

export const LOCAL_CHUNK_BYTES = 8 * 1024 * 1024;
const LOCAL_MAX_BYTES = (Number(process.env.LOCAL_VIDEO_MAX_GB) || 20) * 1024 ** 3;
const localRoot = () => path.resolve(env.storage.localDir);
const partFile = (id: string) => path.join(localRoot(), 'uploads', `${id}.part`);

export function localUploadsAvailable(): { ok: true } | { ok: false; reason: string } {
  if (env.storage.driver !== 'local') return { ok: false, reason: 'La subida local necesita STORAGE_DRIVER=local en .env.local.' };
  if (process.env.VERCEL) return { ok: false, reason: 'En Vercel no hay disco persistente: usa Mux o vincula un video alojado en un CDN.' };
  return { ok: true };
}

export async function createLocalUpload(actorId: string, input: { ownerType: OwnerType; ownerId: string; file: { name: string; size: number; type: string } }) {
  const avail = localUploadsAvailable();
  if (!avail.ok) throw new VideoError(avail.reason);
  validateUploadRequest(input.file);
  if (!/\.(mp4|m4v|webm)$/i.test(input.file.name)) {
    throw new VideoError('Sin Mux, el navegador reproduce el archivo tal cual: sube un MP4 (H.264 + AAC) o WebM. Un MOV/ProRes o MKV no se vería.');
  }
  if (input.file.size > LOCAL_MAX_BYTES) throw new VideoError(`El archivo supera el máximo para la subida local (${LOCAL_MAX_BYTES / 1024 ** 3} GB).`);
  await ownerExists(input.ownerType, input.ownerId);
  const asset = await sql.begin(async (tx) => {
    const version = await nextVersion(input.ownerType, input.ownerId, tx);
    const [a] = await tx`insert into video_assets (owner_type, owner_id, provider, status, version, original_filename, created_by)
      values (${input.ownerType}, ${input.ownerId}, 'local', 'uploading', ${version}, ${input.file.name.slice(0, 250)}, ${actorId}) returning id`;
    await tx`insert into media_upload_jobs (video_asset_id, provider, status, file_name, file_size, mime_type, created_by)
      values (${a.id}, 'local', 'uploading', ${input.file.name.slice(0, 250)}, ${input.file.size}, ${input.file.type || null}, ${actorId})`;
    return a;
  });
  await fsp.mkdir(path.dirname(partFile(asset.id)), { recursive: true });
  await fsp.writeFile(partFile(asset.id), Buffer.alloc(0));
  await audit(actorId, 'video.local_upload_created', input.ownerType, input.ownerId, { asset: asset.id, file: input.file.name, size: input.file.size });
  return { assetId: asset.id as string, chunkSize: LOCAL_CHUNK_BYTES };
}

async function localJob(assetId: string) {
  const [a] = await sql`select va.id, va.status, va.provider, j.file_size from video_assets va join media_upload_jobs j on j.video_asset_id = va.id where va.id = ${assetId}`;
  if (!a || a.provider !== 'local') throw new VideoError('Subida no encontrada.');
  return a;
}

/** Bytes ya recibidos (para reanudar una subida interrumpida). */
export async function localUploadOffset(assetId: string) {
  const a = await localJob(assetId);
  const size = await fsp.stat(partFile(assetId)).then((s) => s.size).catch(() => 0);
  return { status: a.status as string, received: size, total: Number(a.file_size) };
}

export async function appendLocalChunk(assetId: string, offset: number, chunk: Buffer) {
  const a = await localJob(assetId);
  if (a.status !== 'uploading') throw new VideoError('Esta subida ya no admite más datos.');
  if (chunk.length > LOCAL_CHUNK_BYTES * 2) throw new VideoError('Parte demasiado grande.');
  const current = await fsp.stat(partFile(assetId)).then((s) => s.size).catch(() => -1);
  if (current < 0) throw new VideoError('Falta el archivo temporal de la subida: empieza de nuevo.');
  if (offset !== current) return { received: current, mismatch: true };
  if (current + chunk.length > Number(a.file_size)) throw new VideoError('Se recibieron más datos de los anunciados.');
  await fsp.appendFile(partFile(assetId), chunk);
  return { received: current + chunk.length, mismatch: false };
}

/** Lee la duración del átomo «mvhd» de un MP4 (sin dependencias). */
export function mp4Duration(buf: Buffer): number | null {
  const i = buf.indexOf('mvhd', 0, 'latin1');
  if (i < 4) return null;
  const version = buf[i + 4];
  const base = i + 8;
  const timescale = version === 1 ? buf.readUInt32BE(base + 16) : buf.readUInt32BE(base + 8);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(base + 20)) : buf.readUInt32BE(base + 12);
  return timescale > 0 && duration > 0 ? Math.round((duration / timescale) * 100) / 100 : null;
}

export async function completeLocalUpload(actorId: string, assetId: string) {
  const a = await localJob(assetId);
  if (a.status !== 'uploading') throw new VideoError('Esta subida ya se completó o falló.');
  const file = partFile(assetId);
  const size = (await fsp.stat(file)).size;
  if (size !== Number(a.file_size)) throw new VideoError(`Faltan datos: llegaron ${size} de ${a.file_size} bytes.`);
  const fh = await fsp.open(file, 'r');
  const head = Buffer.alloc(Math.min(size, 8 * 1024 * 1024));
  const tail = Buffer.alloc(Math.min(size, 8 * 1024 * 1024));
  await fh.read(head, 0, head.length, 0);
  await fh.read(tail, 0, tail.length, size - tail.length);
  await fh.close();
  const isMp4 = head.subarray(4, 8).toString('latin1') === 'ftyp';
  const isWebm = head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!isMp4 && !isWebm) {
    await failAsset(assetId, 'El archivo no es un MP4 ni un WebM válido.');
    await fsp.rm(file, { force: true });
    throw new VideoError('El archivo no es un MP4 ni un WebM válido.');
  }
  const ext = isMp4 ? 'mp4' : 'webm';
  const duration = isMp4 ? mp4Duration(head) ?? mp4Duration(tail) : null;
  const dest = path.join(localRoot(), 'public', 'videos', `${assetId}.${ext}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(file, dest);
  await sql`update video_assets set status = 'in_review', source_url = ${`/media/videos/${assetId}.${ext}`}, duration_seconds = ${duration}, error_message = null where id = ${assetId}`;
  await sql`update media_upload_jobs set status = 'completed', completed_at = now() where video_asset_id = ${assetId}`;
  await audit(actorId, 'video.local_upload_completed', 'video_asset', assetId, { size, duration });
  return { status: 'in_review', duration };
}

export function localVideoExists(sourceUrl: string | null) {
  if (!sourceUrl?.startsWith('/media/videos/')) return false;
  return fs.existsSync(path.join(localRoot(), 'public', sourceUrl.replace(/^\/media\//, '')));
}
