// Adaptador de Mux Video: subidas directas, consulta de assets, webhooks firmados y tokens de reproducción.
// Documentación: https://docs.mux.com/api-reference
import crypto from 'node:crypto';
import { env } from '../env';

export class ProviderError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

function auth() {
  if (!env.mux.configured) throw new ProviderError('Mux no está configurado (faltan MUX_TOKEN_ID / MUX_TOKEN_SECRET).');
  return 'Basic ' + Buffer.from(`${env.mux.tokenId}:${env.mux.tokenSecret}`).toString('base64');
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.mux.apiBase}${path}`, {
      method,
      headers: { authorization: auth(), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    throw new ProviderError(`No se pudo contactar con Mux: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: { data?: T; error?: { messages?: string[]; type?: string } } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    const msg = json.error?.messages?.join(' ') || text.slice(0, 300) || res.statusText;
    throw new ProviderError(`Mux respondió ${res.status}: ${msg}`, res.status);
  }
  return json.data as T;
}

export interface MuxUpload { id: string; url: string; status: string; asset_id?: string; error?: { type: string; message: string } }
export interface MuxTrack { id: string; type: 'video' | 'audio' | 'text'; max_width?: number; max_height?: number; language_code?: string; name?: string; primary?: boolean }
export interface MuxAsset {
  id: string;
  status: 'preparing' | 'ready' | 'errored';
  duration?: number;
  aspect_ratio?: string;
  resolution_tier?: string;
  max_stored_resolution?: string;
  playback_ids?: { id: string; policy: 'public' | 'signed' }[];
  tracks?: MuxTrack[];
  passthrough?: string;
  upload_id?: string;
  errors?: { type: string; messages: string[] };
}

export const mux = {
  createDirectUpload(opts: { corsOrigin: string; signed: boolean; passthrough: string }) {
    return call<MuxUpload>('POST', '/video/v1/uploads', {
      cors_origin: opts.corsOrigin,
      timeout: 3600 * 6,
      new_asset_settings: {
        playback_policy: [opts.signed ? 'signed' : 'public'],
        video_quality: 'plus',
        passthrough: opts.passthrough,
        max_resolution_tier: '2160p',
      },
    });
  },
  getUpload: (id: string) => call<MuxUpload>('GET', `/video/v1/uploads/${encodeURIComponent(id)}`),
  cancelUpload: (id: string) => call<MuxUpload>('PUT', `/video/v1/uploads/${encodeURIComponent(id)}/cancel`),
  getAsset: (id: string) => call<MuxAsset>('GET', `/video/v1/assets/${encodeURIComponent(id)}`),
};

/**
 * Verifica la cabecera `Mux-Signature: t=<unix>,v1=<hex>` (HMAC-SHA256 de "<t>.<cuerpo>").
 * Rechaza firmas con más de `toleranceSec` de antigüedad para evitar reenvíos.
 */
export function verifyMuxSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** JWT RS256 para reproducción firmada. aud: v = video, t = miniatura, s = storyboard. */
export function signPlaybackToken(playbackId: string, aud: 'v' | 't' | 's', ttlSeconds = 4 * 3600): string {
  const keyId = env.mux.signingKeyId;
  const key = env.mux.signingPrivateKey;
  if (!keyId || !key) throw new ProviderError('Faltan MUX_SIGNING_KEY_ID / MUX_SIGNING_PRIVATE_KEY para reproducir contenido restringido.');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }));
  const payload = b64url(JSON.stringify({ sub: playbackId, aud, exp: Math.floor(Date.now() / 1000) + ttlSeconds, kid: keyId }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${b64url(signature)}`;
}

export function muxUrls(playbackId: string, signed: boolean) {
  const q = (aud: 'v' | 't' | 's') => (signed ? `?token=${signPlaybackToken(playbackId, aud)}` : '');
  return {
    hls: `https://stream.mux.com/${playbackId}.m3u8${q('v')}`,
    poster: `https://image.mux.com/${playbackId}/thumbnail.webp${signed ? q('t') : '?width=1280&time=5'}`,
    storyboard: `https://image.mux.com/${playbackId}/storyboard.vtt${q('s')}`,
  };
}
