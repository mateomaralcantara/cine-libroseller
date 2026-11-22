// Flujos obligatorios (sección 32) verificados contra PostgreSQL real.
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { resetDb, makeUser, muxWebhook, mockFetch, json, addImage, verifyRights } from '../helpers';
import { sql } from '@/lib/db';
import type { Viewer } from '@/lib/auth/core';
import { login, AuthError } from '@/lib/auth/core';
import { createTitle, updateTitle, createSeason, createEpisode, setEpisodeStatus, setTitleStatus, titleReadiness, upsertRelease, activateScheduled, ValidationError, setAvailability } from '@/lib/catalog/admin';
import { createMuxUpload, markUploadSent, handleMuxWebhook, approveAsset, linkVideo, refreshFromProvider, VideoError } from '@/lib/video/service';
import { resolvePlayback, saveProgress, setInWatchlist } from '@/lib/playback';
import { getTitleBySlug, getEpisode, searchCatalog, continueWatching, getHomeSections, upcomingReleases, watchlistTitles } from '@/lib/catalog/public';
import { storeSubtitle, toWebVTT } from '@/lib/media/storage';
import { recordEvent, dashboardStats } from '@/lib/analytics';
import { verifyMuxSignature } from '@/lib/video/mux';

let admin: Viewer;
let viewer: Viewer;
let seriesId: string;
let seasonId: string;
let ep1: string;
let ep2: string;

afterEach(() => { vi.unstubAllGlobals(); });

/** Simula el ciclo completo de Mux para un episodio: subida → asset_created → ready. */
async function uploadAndProcess(ownerType: 'episode' | 'title' | 'trailer', ownerId: string, n: number) {
  const uploadId = `upload-${n}-${crypto.randomBytes(3).toString('hex')}`;
  mockFetch({ 'https://mux.test/video/v1/uploads': () => json({ id: uploadId, url: `https://storage.mux.test/${uploadId}`, status: 'waiting' }, 201) });
  const { assetId, uploadUrl } = await createMuxUpload(admin.id, { ownerType, ownerId, file: { name: 'master.mov', size: 5e9, type: 'video/quicktime' }, signed: false, corsOrigin: 'http://localhost:3000' });
  expect(uploadUrl).toContain(uploadId);
  await markUploadSent(assetId);
  const muxAssetId = `asset-${n}-${crypto.randomBytes(3).toString('hex')}`;
  let w = muxWebhook('video.upload.asset_created', { id: uploadId, asset_id: muxAssetId, status: 'asset_created' });
  expect((await handleMuxWebhook(w.body, w.header)).result).toBe('processed');
  w = muxWebhook('video.asset.ready', {
    id: muxAssetId, status: 'ready', duration: 912.4, aspect_ratio: '16:9', max_stored_resolution: 'UHD', passthrough: assetId, upload_id: uploadId,
    playback_ids: [{ id: `play${n}`, policy: 'public' }],
    tracks: [{ id: 'v1', type: 'video', max_width: 3840, max_height: 2160 }, { id: 'a1', type: 'audio', language_code: 'es', name: 'Español', primary: true }],
  });
  expect((await handleMuxWebhook(w.body, w.header)).result).toBe('processed');
  return assetId;
}

describe('flujos de streaming', () => {
  beforeAll(async () => {
    await resetDb();
    admin = await makeUser('admin');
    viewer = await makeUser('viewer');
  });

  it('1. crea una película', async () => {
    const t = await createTitle(admin.id, { type: 'movie', title: 'El Silencio de Dios', synopsis_short: 'Una monja duda.', runtime_minutes: 92 });
    expect(t.slug).toBe('el-silencio-de-dios');
    expect(t.status).toBe('draft');
    await expect(createTitle(admin.id, { type: 'movie', title: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('2-4. crea una serie, una temporada y episodios', async () => {
    const [s] = await sql`select id from titles where slug = 'los-convidados-al-agape'`;
    seriesId = s.id;
    await updateTitle(admin.id, seriesId, { type: 'series', title: 'Los Convidados al Ágape', synopsis_short: 'Sinopsis aprobada para pruebas.' });
    const [season] = await sql`select id from seasons where title_id = ${seriesId} and number = 1`;
    seasonId = season.id;
    await expect(createSeason(admin.id, seriesId, { number: 1 })).rejects.toThrow(/Ya existe/);
    const s2 = await createSeason(admin.id, seriesId, { number: 2, name: 'Temporada 2' });
    expect(s2.number).toBe(2);
    const [e1] = await sql`select id from episodes where season_id = ${seasonId} and number = 1`;
    ep1 = e1.id;
    ep2 = (await createEpisode(admin.id, seasonId, { number: 2, name: 'El banquete', runtime_minutes: 15 })).id;
    await expect(createEpisode(admin.id, seasonId, { number: 2, name: 'Duplicado' })).rejects.toThrow(/Ya existe/);
  });

  it('no publica un título sin materiales ni derechos, ni oculta qué falta', async () => {
    const missing = await titleReadiness(seriesId);
    expect(missing).toEqual(expect.arrayContaining(['Póster vertical', 'Derechos de distribución o streaming verificados']));
    await expect(setTitleStatus(admin.id, seriesId, 'published')).rejects.toThrow(/Falta para publicar/);
    expect(await getTitleBySlug('los-convidados-al-agape')).toBeNull();
  });

  it('5-6. sube un video a Mux y lo procesa mediante webhooks firmados', async () => {
    const assetId = await uploadAndProcess('episode', ep1, 1);
    const [a] = await sql`select * from video_assets where id = ${assetId}`;
    expect(a.status).toBe('in_review'); // procesado, pendiente de revisión: aún NO se publica
    expect(a.playback_id).toBe('play1');
    expect(Number(a.duration_seconds)).toBeCloseTo(912.4);
    const tracks = await sql`select kind, language from video_tracks where video_asset_id = ${assetId} order by kind`;
    expect(tracks.map((t) => t.kind)).toEqual(['audio', 'video']);
    const [job] = await sql`select status from media_upload_jobs where video_asset_id = ${assetId}`;
    expect(job.status).toBe('completed');
    // Previsualización privada sólo para el equipo
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer, country: 'DO', preview: true })).ok).toBe(false);
    const prev = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: admin, country: 'DO', preview: true });
    expect(prev.ok && prev.src).toBe('https://stream.mux.com/play1.m3u8');
    await approveAsset(admin.id, assetId);
    const [b] = await sql`select status, is_current from video_assets where id = ${assetId}`;
    expect(b).toMatchObject({ status: 'ready', is_current: true });
  });

  it('rechaza webhooks con firma inválida, antiguos o duplicados', async () => {
    const w = muxWebhook('video.asset.ready', { id: 'x' });
    expect((await handleMuxWebhook(w.body, 't=1,v1=00')).status).toBe(401);
    expect(verifyMuxSignature(w.body, w.header, 'otro-secreto')).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    const sig = crypto.createHmac('sha256', process.env.MUX_WEBHOOK_SECRET!).update(`${old}.${w.body}`).digest('hex');
    expect((await handleMuxWebhook(w.body, `t=${old},v1=${sig}`)).status).toBe(401);
    const dup = muxWebhook('video.asset.created', { id: 'nada' }, 'evt-fijo');
    expect((await handleMuxWebhook(dup.body, dup.header)).result).toBe('ignored');
    expect((await handleMuxWebhook(dup.body, dup.header)).result).toBe('duplicado');
  });

  it('17. publica un episodio individual (y su temporada) cuando la serie está lista', async () => {
    await expect(setEpisodeStatus(admin.id, ep1, 'published')).rejects.toThrow(/Derechos/);
    await verifyRights(admin.id, seriesId);
    await addImage('title', seriesId, 'poster');
    await addImage('title', seriesId, 'backdrop');
    await setTitleStatus(admin.id, seriesId, 'published');
    await setEpisodeStatus(admin.id, ep1, 'published');
    const [season] = await sql`select status from seasons where id = ${seasonId}`;
    expect(season.status).toBe('published');
    const [a] = await sql`select status from video_assets where owner_id = ${ep1} and is_current`;
    expect(a.status).toBe('published');
    const ep = await getEpisode('los-convidados-al-agape', 1, 1);
    expect(ep?.episode.name).toBe('La petición en la montaña');
    // El episodio 2 sigue en borrador: no aparece
    expect(await getEpisode('los-convidados-al-agape', 1, 2)).toBeNull();
  });

  it('7. reproduce el episodio publicado sin cuenta (contenido gratuito)', async () => {
    const p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.src).toBe('https://stream.mux.com/play1.m3u8');
    expect(p.kind).toBe('hls');
    expect(p.heading).toBe('Los Convidados al Ágape');
    expect(p.subheading).toContain('La petición en la montaña');
    expect(p.backHref).toBe('/series/los-convidados-al-agape/temporada-1/episodio-1');
  });

  it('8-9 y 13. guarda el progreso al pausar y reanuda desde ese punto (usuario autenticado)', async () => {
    await saveProgress(viewer, { contentType: 'episode', contentId: ep1, position: 301.7, duration: 912 });
    const p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer, country: 'DO' });
    expect(p.ok && p.resumeAt).toBe(301);
    const cw = await continueWatching(viewer.viewerProfileId);
    expect(cw[0]).toMatchObject({ content_id: ep1, position_seconds: 301, episode_number: 1 });
    // Al terminar se marca como visto y sale de «Continúa viendo»
    await saveProgress(viewer, { contentType: 'episode', contentId: ep1, position: 900, duration: 912 });
    expect(await continueWatching(viewer.viewerProfileId)).toHaveLength(0);
    // Posiciones imposibles se ignoran
    expect(await saveProgress(viewer, { contentType: 'episode', contentId: ep1, position: 99999, duration: 912 })).toBeNull();
  });

  it('10. navega al siguiente episodio sólo cuando está publicado y listo', async () => {
    let p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok && p.next).toBeNull();
    await uploadAndProcess('episode', ep2, 2);
    const [a] = await sql`select id from video_assets where owner_id = ${ep2} order by created_at desc limit 1`;
    await approveAsset(admin.id, a.id);
    await setEpisodeStatus(admin.id, ep2, 'published');
    p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok && p.next?.watchHref).toBe('/series/los-convidados-al-agape/temporada-1/episodio-2/ver');
  });

  it('11. convierte SRT a WebVTT y entrega los subtítulos al reproductor', async () => {
    expect(() => toWebVTT('esto no es un subtítulo')).toThrow();
    const srt = '1\n00:00:01,000 --> 00:00:04,000\nSubimos a la montaña.\n';
    const saved = await storeSubtitle('subtitles', Buffer.from(srt));
    await sql`insert into subtitle_tracks (owner_type, owner_id, language, label, url, storage_path, is_default)
      values ('episode', ${ep1}, 'es', 'Español', ${saved.url}, ${saved.path}, true)`;
    const p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok && p.subtitles).toEqual([{ language: 'es', label: 'Español', kind: 'subtitles', url: saved.url, default: true }]);
    const fs = await import('node:fs/promises');
    const vtt = await fs.readFile(`storage-test/public/${saved.path}`, 'utf8');
    expect(vtt).toMatch(/^WEBVTT\n\n1\n00:00:01\.000 --> 00:00:04\.000/);
  });

  it('12. muestra el tráiler de una película aún no publicada si su estreno es público', async () => {
    const movie = await createTitle(admin.id, { type: 'movie', title: 'La Montaña Interior', synopsis_short: 'Próximo estreno.' });
    const [tr] = await sql`insert into trailers (title_id, name, kind, is_primary, is_published) values (${movie.id}, 'Tráiler oficial', 'trailer', true, true) returning id`;
    const asset = await uploadAndProcess('trailer', tr.id, 3);
    await approveAsset(admin.id, asset);
    expect((await resolvePlayback({ contentType: 'trailer', contentId: tr.id, viewer: null, country: 'DO' })).ok).toBe(false);
    await upsertRelease(admin.id, null, { title_id: movie.id, date_label: 'Primavera 2027', is_public: 'on' });
    const p = await resolvePlayback({ contentType: 'trailer', contentId: tr.id, viewer: null, country: 'DO' });
    expect(p.ok && p.src).toBe('https://stream.mux.com/play3.m3u8');
    // La película en sí no es reproducible
    expect((await resolvePlayback({ contentType: 'title', contentId: movie.id, viewer: null, country: 'DO' })).ok).toBe(false);
    const up = await upcomingReleases();
    expect(up.find((u) => u.title === 'La Montaña Interior')).toMatchObject({ is_confirmed: false, date_label: 'Primavera 2027' });
    await expect(upsertRelease(admin.id, null, { title_id: movie.id, is_confirmed: 'on' })).rejects.toThrow(/necesita fecha/);
  });

  it('15. busca por título, palabras de sinopsis, género, personaje y año sin inventar resultados', async () => {
    expect((await searchCatalog('convidados')).map((t) => t.slug)).toEqual(['los-convidados-al-agape']);
    expect((await searchCatalog('AGAPE')).length).toBe(1); // sin tildes ni mayúsculas
    expect((await searchCatalog('suspenso')).length).toBe(1); // por género
    expect((await searchCatalog('petición montaña')).length).toBe(1); // por episodio
    expect(await searchCatalog('una película sobre dragones espaciales')).toEqual([]);
    expect(await searchCatalog('silencio')).toEqual([]); // existe pero en borrador
  });

  it('16. programa un estreno y lo activa al llegar la hora', async () => {
    const ep3 = (await createEpisode(admin.id, seasonId, { number: 3, name: 'La espera' })).id;
    const asset = await uploadAndProcess('episode', ep3, 4);
    await approveAsset(admin.id, asset);
    await expect(setEpisodeStatus(admin.id, ep3, 'scheduled', new Date(Date.now() - 1000))).rejects.toThrow(/futura/);
    await setEpisodeStatus(admin.id, ep3, 'scheduled', new Date(Date.now() + 3600_000));
    expect(await getEpisode('los-convidados-al-agape', 1, 3)).toBeNull();
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep3, viewer: null, country: 'DO' })).ok).toBe(false);
    await sql`update episodes set publish_at = now() - interval '1 second' where id = ${ep3}`; // llega la hora
    expect(await getEpisode('los-convidados-al-agape', 1, 3)).not.toBeNull();
    expect((await activateScheduled()).episodes).toBe(1);
    const [e] = await sql`select status from episodes where id = ${ep3}`;
    expect(e.status).toBe('published');
  });

  it('18. retira un episodio: deja de verse y de reproducirse', async () => {
    await setEpisodeStatus(admin.id, ep2, 'withdrawn');
    expect(await getEpisode('los-convidados-al-agape', 1, 2)).toBeNull();
    const p = await resolvePlayback({ contentType: 'episode', contentId: ep2, viewer: null, country: 'DO' });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.status).toBe(404);
    const [a] = await sql`select status from video_assets where owner_id = ${ep2} and is_current`;
    expect(a.status).toBe('ready');
  });

  it('19. impide el acceso no autorizado', async () => {
    await sql`update episodes set access = 'registered' where id = ${ep1}`;
    let p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok === false && p.reason).toBe('login_required');
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer, country: 'DO' })).ok).toBe(true);
    await sql`update episodes set access = 'premium' where id = ${ep1}`;
    p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer, country: 'DO' });
    expect(p.ok === false && p.reason).toBe('premium_required');
    await sql`insert into access_entitlements (profile_id, title_id, source) values (${viewer.id}, ${seriesId}, 'grant')`;
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer, country: 'DO' })).ok).toBe(true);
    await sql`update episodes set access = 'free' where id = ${ep1}`;
    // Territorios
    await setAvailability(admin.id, 'title', seriesId, { allowed_countries: 'DO, MX', blocked_countries: '' });
    p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'ES' });
    expect(p.ok === false && p.reason).toBe('not_available_region');
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'MX' })).ok).toBe(true);
    await sql`delete from content_availability`;
    // Un espectador no puede previsualizar borradores
    const [draft] = await sql`select id from titles where slug = 'el-silencio-de-dios'`;
    expect((await resolvePlayback({ contentType: 'title', contentId: draft.id, viewer, country: 'DO', preview: true })).ok).toBe(false);
    // Contraseña incorrecta y bloqueo tras 5 intentos
    for (let i = 0; i < 5; i++) await expect(login(viewer.email, 'mala-clave-123')).rejects.toBeInstanceOf(AuthError);
    await expect(login(viewer.email, 'Prueba2026segura')).rejects.toThrow(/Demasiados intentos/);
  });

  it('reproducción firmada: genera un JWT RS256 válido para Mux', async () => {
    const [a] = await sql`select id from video_assets where owner_id = ${ep1} and is_current`;
    await sql`update video_assets set playback_policy = 'signed' where id = ${a.id}`;
    const p = await resolvePlayback({ contentType: 'episode', contentId: ep1, viewer: null, country: 'DO' });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const token = new URL(p.src).searchParams.get('token')!;
    const [h, b, s] = token.split('.');
    const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(process.env.TEST_MUX_PUBLIC_KEY!, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toMatchObject({ sub: 'play1', aud: 'v' });
    await sql`update video_assets set playback_policy = 'public' where id = ${a.id}`;
  });

  it('20. se recupera de fallos del proveedor de video', async () => {
    const movie = await createTitle(admin.id, { type: 'short', title: 'Corto de prueba', synopsis_short: 'x' });
    // a) Mux no responde al crear la subida → error real registrado, sin asset fantasma «listo»
    mockFetch({ 'https://mux.test/': () => new Response('upstream down', { status: 503 }) });
    await expect(createMuxUpload(admin.id, { ownerType: 'title', ownerId: movie.id, file: { name: 'a.mp4', size: 100, type: 'video/mp4' }, signed: false, corsOrigin: 'x' }))
      .rejects.toThrow(/Mux respondió 503/);
    const [failed] = await sql`select status, error_message from video_assets where owner_id = ${movie.id}`;
    expect(failed.status).toBe('error');
    // b) El procesamiento falla en Mux → estado error con el mensaje del proveedor
    const uploadId = 'up-fail';
    mockFetch({ 'https://mux.test/video/v1/uploads': () => json({ id: uploadId, url: 'https://x', status: 'waiting' }, 201) });
    const { assetId } = await createMuxUpload(admin.id, { ownerType: 'title', ownerId: movie.id, file: { name: 'b.mp4', size: 100, type: 'video/mp4' }, signed: false, corsOrigin: 'x' });
    let w = muxWebhook('video.asset.errored', { id: 'mx-fail', passthrough: assetId, upload_id: uploadId, errors: { type: 'invalid_input', messages: ['File is not a valid video'] } });
    await handleMuxWebhook(w.body, w.header);
    const [errored] = await sql`select status, error_message from video_assets where id = ${assetId}`;
    expect(errored).toMatchObject({ status: 'error', error_message: 'Mux: File is not a valid video' });
    await expect(approveAsset(admin.id, assetId)).rejects.toBeInstanceOf(VideoError);
    // c) Se perdió el webhook de «listo»: la consulta al proveedor recupera el estado real
    mockFetch({ 'https://mux.test/video/v1/uploads': () => json({ id: 'up-lost', url: 'https://x', status: 'waiting' }, 201) });
    const second = await createMuxUpload(admin.id, { ownerType: 'title', ownerId: movie.id, file: { name: 'c.mp4', size: 100, type: 'video/mp4' }, signed: false, corsOrigin: 'x' });
    w = muxWebhook('video.upload.asset_created', { id: 'up-lost', asset_id: 'mx-lost' });
    await handleMuxWebhook(w.body, w.header);
    mockFetch({ 'https://mux.test/video/v1/assets/mx-lost': () => json({ id: 'mx-lost', status: 'ready', duration: 300, playback_ids: [{ id: 'play-lost', policy: 'public' }], tracks: [] }) });
    const refreshed = await refreshFromProvider(admin.id, second.assetId);
    expect(refreshed).toMatchObject({ status: 'in_review', playback_id: 'play-lost' });
    // d) Enlace roto o formato inválido → error explicado, nunca «procesado»
    mockFetch({ 'https://cdn.test/roto.m3u8': () => new Response('no', { status: 404 }), 'https://cdn.test/pagina.html': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) });
    await expect(linkVideo(admin.id, { ownerType: 'title', ownerId: movie.id, url: 'https://cdn.test/roto.m3u8' })).rejects.toThrow(/respondió 404/);
    await expect(linkVideo(admin.id, { ownerType: 'title', ownerId: movie.id, url: 'https://cdn.test/pagina.html' })).rejects.toThrow(/Formato no reproducible/);
    // e) Enlace HLS válido → en revisión
    mockFetch({ 'https://cdn.test/ok/master.m3u8': () => new Response('#EXTM3U\n#EXT-X-VERSION:3\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }) });
    const linked = await linkVideo(admin.id, { ownerType: 'title', ownerId: movie.id, url: 'https://cdn.test/ok/master.m3u8' });
    expect(linked.status).toBe('in_review');
  });

  it('sustituye el video sin perder metadatos ni métricas', async () => {
    await recordEvent({ event: 'play_valid', contentType: 'episode', contentId: ep1 }, { viewerProfileId: null, userAgent: 'Mozilla iPhone', country: 'DO', consent: false });
    const [before] = await sql`select id, version from video_assets where owner_id = ${ep1} and is_current`;
    const newAsset = await uploadAndProcess('episode', ep1, 9);
    await approveAsset(admin.id, newAsset);
    const [after] = await sql`select id, version, status from video_assets where owner_id = ${ep1} and is_current`;
    expect(after.id).toBe(newAsset);
    expect(after.version).toBe(before.version + 1);
    expect(after.status).toBe('published'); // el episodio sigue publicado con la versión nueva
    const versions = await sql`select count(*)::int as n from video_assets where owner_id = ${ep1}`;
    expect(versions[0].n).toBe(2);
    const [{ n }] = await sql`select count(*)::int as n from playback_events where content_id = ${ep1} and event_type = 'play_valid'`;
    expect(n).toBe(1);
  });

  it('analítica: una visita a la ficha no cuenta como reproducción y sin consentimiento no guarda identificadores', async () => {
    await recordEvent({ event: 'page_view', contentType: 'title', contentId: seriesId, utm: { source: 'instagram' } }, { viewerProfileId: viewer.viewerProfileId, userAgent: 'Mozilla', country: 'DO', consent: false });
    const [pv] = await sql`select viewer_profile_id, country, utm_source from playback_events where event_type = 'page_view' order by id desc limit 1`;
    expect(pv).toMatchObject({ viewer_profile_id: null, country: null, utm_source: 'instagram' });
    const stats = await dashboardStats();
    expect(stats.plays.page_views).toBe(1);
    expect(stats.plays.valid).toBe(1);
    expect(stats.devices[0]).toBeUndefined(); // ningún play_start registrado todavía
  });

  it('mi lista y portada: filas vacías ocultas y sin catálogo inflado', async () => {
    expect(await setInWatchlist(viewer, seriesId, true)).toBe(true);
    expect((await watchlistTitles(viewer.viewerProfileId)).map((t) => t.slug)).toEqual(['los-convidados-al-agape']);
    const [draft] = await sql`select id from titles where slug = 'el-silencio-de-dios'`;
    expect(await setInWatchlist(viewer, draft.id, true)).toBe(false); // no se pueden guardar borradores
    const home = await getHomeSections(null);
    const headings = home.map((s) => s.heading);
    expect(headings).toContain('Gran estreno');
    expect(headings).toContain('Series originales');
    expect(headings).not.toContain('Películas originales'); // no hay películas publicadas
    expect(headings).not.toContain('Continúa viendo'); // sin sesión
    for (const s of home) if (s.kind !== 'spotlight') expect(s.items.length).toBeGreaterThan(0);
  });
});
