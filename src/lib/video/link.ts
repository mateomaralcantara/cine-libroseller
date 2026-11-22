// Proveedor «enlace»: el video ya está alojado y optimizado en un CDN externo (HLS o MP4).
// La plataforma nunca sirve el archivo; sólo comprueba que la URL responde y es un formato reproducible.

const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];
const MP4_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export type LinkKind = 'hls' | 'mp4';

export function linkKind(url: string): LinkKind {
  return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4';
}

// ALLOW_INSECURE_VIDEO_LINKS=1 sólo para pruebas locales (CDN de pruebas por HTTP). Nunca en producción.
const insecureAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_INSECURE_VIDEO_LINKS === '1';

export async function validateVideoLink(raw: string, { allowHttp = insecureAllowed(), fetcher = fetch } = {}): Promise<{ ok: true; kind: LinkKind } | { ok: false; error: string }> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: 'La URL no es válida.' }; }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return { ok: false, error: 'La URL debe usar HTTPS.' };
  if (['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname) && !allowHttp) return { ok: false, error: 'No se permiten direcciones locales.' };
  let res: Response;
  try {
    res = await fetcher(url, { method: 'GET', headers: { range: 'bytes=0-2047' }, redirect: 'follow', signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  } catch (e) {
    return { ok: false, error: `No se pudo acceder al archivo: ${(e as Error).message}` };
  }
  if (!res.ok && res.status !== 206) return { ok: false, error: `El servidor del video respondió ${res.status}.` };
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const head = Buffer.from(await res.arrayBuffer()).subarray(0, 2048).toString('latin1');
  if (HLS_TYPES.includes(type) || head.startsWith('#EXTM3U')) {
    if (!head.startsWith('#EXTM3U')) return { ok: false, error: 'La lista HLS no empieza por #EXTM3U.' };
    return { ok: true, kind: 'hls' };
  }
  if (MP4_TYPES.includes(type) || head.slice(4, 8) === 'ftyp' || head.startsWith('\x1aE\xdf\xa3')) return { ok: true, kind: 'mp4' };
  return { ok: false, error: `Formato no reproducible (${type || 'desconocido'}). Usa una lista HLS (.m3u8) o un MP4.` };
}
