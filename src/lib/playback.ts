// Decide si un espectador puede reproducir algo y entrega la fuente adecuada (con token firmado si procede).
import { sql } from './db';
import { VISIBLE } from './catalog/public';
import { canEdit, type Viewer } from './auth/core';
import { muxUrls, ProviderError } from './video/mux';
import { linkKind } from './video/link';
import { episodePath, titlePath } from './format';

export type ContentType = 'episode' | 'title' | 'trailer';

export type PlaybackDenied = { ok: false; status: 401 | 403 | 404 | 409 | 503; reason: 'not_found' | 'login_required' | 'premium_required' | 'not_available_region' | 'not_available_yet' | 'expired' | 'processing' | 'provider_error'; message: string };
export type PlaybackGranted = {
  ok: true;
  contentType: ContentType;
  contentId: string;
  titleId: string;
  src: string;
  kind: 'hls' | 'mp4';
  poster: string | null;
  storyboard: string | null;
  durationSeconds: number | null;
  subtitles: { language: string; label: string; kind: string; url: string; default: boolean }[];
  heading: string;
  subheading: string | null;
  backHref: string;
  next: { id: string; label: string; href: string; watchHref: string } | null;
  resumeAt: number;
  preview: boolean;
};

function deny(status: PlaybackDenied['status'], reason: PlaybackDenied['reason'], message: string): PlaybackDenied {
  return { ok: false, status, reason, message };
}

async function hasEntitlement(profileId: string, titleId: string) {
  const [r] = await sql`select 1 from access_entitlements where profile_id = ${profileId}
    and (title_id is null or title_id = ${titleId}) and starts_at <= now() and (ends_at is null or ends_at > now())`;
  return !!r;
}

async function checkAvailability(contentType: 'title' | 'episode', contentId: string, country: string | null): Promise<PlaybackDenied | null> {
  const [a] = await sql`select * from content_availability where content_type = ${contentType} and content_id = ${contentId}`;
  if (!a) return null;
  if (a.starts_at && new Date(a.starts_at) > new Date()) return deny(403, 'not_available_yet', 'Este contenido todavía no está disponible.');
  if (a.ends_at && new Date(a.ends_at) <= new Date()) return deny(403, 'expired', 'Este contenido ya no está disponible.');
  const c = (country || '').toUpperCase();
  if (a.blocked_countries.length && c && a.blocked_countries.includes(c)) return deny(403, 'not_available_region', 'Este contenido no está disponible en tu país.');
  if (a.allowed_countries.length && (!c || !a.allowed_countries.includes(c))) return deny(403, 'not_available_region', 'Este contenido no está disponible en tu país.');
  return null;
}

export async function resolvePlayback(input: { contentType: ContentType; contentId: string; viewer: Viewer | null; country: string | null; preview?: boolean }): Promise<PlaybackDenied | PlaybackGranted> {
  const { contentType, contentId, viewer } = input;
  if (!/^[0-9a-f-]{36}$/i.test(contentId)) return deny(404, 'not_found', 'Contenido no encontrado.');
  const preview = !!input.preview && canEdit(viewer);
  const vis = (alias: string) => (preview ? sql`true` : VISIBLE(alias));

  let titleId: string;
  let access = 'free';
  let heading = '';
  let subheading: string | null = null;
  let backHref = '/';
  let next: PlaybackGranted['next'] = null;
  let ownerForSubs: { type: ContentType; id: string } = { type: contentType, id: contentId };

  if (contentType === 'episode') {
    const [e] = await sql`select e.*, s.number as season_number, t.slug, t.title as series_title, t.access as title_access
      from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id
      where e.id = ${contentId} and ${vis('e')} and ${vis('t')}`;
    if (!e) return deny(404, 'not_found', 'Episodio no disponible.');
    titleId = e.title_id;
    access = e.access === 'free' ? e.title_access : e.access;
    heading = e.series_title;
    subheading = `T${e.season_number}:E${e.number} · ${e.name}`;
    backHref = episodePath(e.slug, e.season_number, e.number);
    const [n] = await sql`select e2.id, e2.number, e2.name, s2.number as season_number from episodes e2 join seasons s2 on s2.id = e2.season_id
      where e2.title_id = ${e.title_id} and ${vis('e2')} and s2.status = 'published'
        and (s2.number, e2.number) > (${e.season_number}, ${e.number})
        and exists (select 1 from video_assets va where va.owner_type = 'episode' and va.owner_id = e2.id and va.is_current and va.status in ('ready','published'))
      order by s2.number, e2.number limit 1`;
    if (n) {
      const href = episodePath(e.slug, n.season_number, n.number);
      next = { id: n.id, label: `T${n.season_number}:E${n.number} · ${n.name}`, href, watchHref: `${href}/ver` };
    }
    const denied = (await checkAvailability('title', e.title_id, input.country)) || (await checkAvailability('episode', e.id, input.country));
    if (denied && !preview) return denied;
  } else if (contentType === 'title') {
    const [t] = await sql`select * from titles t where t.id = ${contentId} and t.type <> 'series' and ${vis('t')}`;
    if (!t) return deny(404, 'not_found', 'Título no disponible.');
    titleId = t.id;
    access = t.access;
    heading = t.title;
    backHref = titlePath(t as unknown as { type: string; slug: string });
    const denied = await checkAvailability('title', t.id, input.country);
    if (denied && !preview) return denied;
  } else {
    const [tr] = await sql`select tr.*, t.slug, t.type, t.title from trailers tr join titles t on t.id = tr.title_id
      where tr.id = ${contentId} and (${preview ? sql`true` : sql`tr.is_published`})
        and (${vis('t')} or (t.status not in ('withdrawn', 'archived') and exists (
          select 1 from release_schedules r where r.title_id = t.id and r.is_public and r.status <> 'cancelled')))`;
    if (!tr) return deny(404, 'not_found', 'Tráiler no disponible.');
    titleId = tr.title_id;
    heading = tr.title;
    subheading = tr.name;
    backHref = titlePath(tr as unknown as { type: string; slug: string });
    ownerForSubs = { type: 'trailer', id: tr.id };
  }

  // Nivel de acceso: los tráilers siempre son libres
  if (contentType !== 'trailer' && !preview) {
    if (access === 'registered' && !viewer) return deny(401, 'login_required', 'Crea una cuenta gratuita o inicia sesión para ver este contenido.');
    if (access === 'premium') {
      if (!viewer) return deny(401, 'login_required', 'Inicia sesión para ver este contenido.');
      if (!canEdit(viewer) && !(await hasEntitlement(viewer.id, titleId))) return deny(403, 'premium_required', 'Este contenido requiere acceso premium.');
    }
  }

  const [asset] = await sql`select * from video_assets where owner_type = ${contentType} and owner_id = ${contentId} and is_current
    and status in (${preview ? sql`'in_review', 'ready', 'published'` : sql`'ready', 'published'`})`;
  let previewAsset = asset;
  if (!previewAsset && preview) {
    [previewAsset] = await sql`select * from video_assets where owner_type = ${contentType} and owner_id = ${contentId} and status = 'in_review' order by version desc limit 1`;
  }
  if (!previewAsset) return deny(409, 'processing', 'El video todavía no está listo para reproducirse.');

  let src: string; let kind: 'hls' | 'mp4'; let poster: string | null = null; let storyboard: string | null = null;
  try {
    if (previewAsset.provider === 'mux') {
      const urls = muxUrls(previewAsset.playback_id, previewAsset.playback_policy === 'signed');
      src = urls.hls; kind = 'hls'; poster = urls.poster; storyboard = urls.storyboard;
    } else {
      src = previewAsset.source_url; kind = linkKind(previewAsset.source_url);
    }
  } catch (e) {
    return deny(503, 'provider_error', e instanceof ProviderError ? e.message : 'El proveedor de video no está disponible.');
  }

  const subtitles = (await sql`select language, label, kind, url, is_default from subtitle_tracks
    where owner_type = ${ownerForSubs.type} and owner_id = ${ownerForSubs.id} order by is_default desc, label`)
    .map((s) => ({ language: s.language, label: s.label, kind: s.kind, url: s.url, default: s.is_default }));

  // Póster de respaldo: imagen del episodio o del título
  if (!poster || contentType !== 'trailer') {
    const [img] = await sql`select url from media_images where is_public and (
        (owner_type = 'episode' and owner_id = ${contentType === 'episode' ? contentId : null} and kind in ('thumbnail','still'))
        or (owner_type = 'title' and owner_id = ${titleId} and kind in ('backdrop','banner')))
      order by (owner_type = 'episode') desc, position limit 1`;
    poster = img?.url ?? poster;
  }

  let resumeAt = 0;
  if (viewer?.viewerProfileId && contentType !== 'trailer') {
    const [p] = await sql`select position_seconds, completed from watch_progress where viewer_profile_id = ${viewer.viewerProfileId}
      and content_type = ${contentType} and content_id = ${contentId}`;
    if (p && !p.completed) resumeAt = p.position_seconds;
  }

  return {
    ok: true, contentType, contentId, titleId, src, kind, poster, storyboard,
    durationSeconds: previewAsset.duration_seconds ? Number(previewAsset.duration_seconds) : null,
    subtitles, heading, subheading, backHref, next, resumeAt, preview,
  };
}

// ------------------------------------------------------------------ Progreso, historial y lista
const COMPLETE_RATIO = 0.95;

export async function saveProgress(viewer: Viewer, input: { contentType: 'episode' | 'title'; contentId: string; position: number; duration: number | null }) {
  const position = Math.max(0, Math.floor(input.position));
  const duration = input.duration && input.duration > 0 ? Math.floor(input.duration) : null;
  const table = input.contentType === 'episode' ? sql`episodes` : sql`titles`;
  const [owner] = await sql`select ${input.contentType === 'episode' ? sql`title_id` : sql`id as title_id`} from ${table} where id = ${input.contentId}`;
  if (!owner) return null;
  if (duration && position > duration + 5) return null;
  // Vista al alcanzar el 95 %: proporcional, para que un corto de 40 s no se dé por terminado a mitad
  const completed = !!duration && position >= duration * COMPLETE_RATIO;
  const [row] = await sql`insert into watch_progress (viewer_profile_id, content_type, content_id, title_id, position_seconds, duration_seconds, completed)
    values (${viewer.viewerProfileId}, ${input.contentType}, ${input.contentId}, ${owner.title_id}, ${position}, ${duration}, ${completed})
    on conflict (viewer_profile_id, content_type, content_id) do update set position_seconds = excluded.position_seconds,
      duration_seconds = coalesce(excluded.duration_seconds, watch_progress.duration_seconds),
      completed = excluded.completed, updated_at = now()
    returning *`;
  if (completed) {
    await sql`update watch_history set completed_at = now() where id = (select id from watch_history where viewer_profile_id = ${viewer.viewerProfileId}
      and content_type = ${input.contentType} and content_id = ${input.contentId} and completed_at is null order by started_at desc limit 1)`;
  }
  return row;
}

export async function startHistory(viewer: Viewer, contentType: 'episode' | 'title', contentId: string, titleId: string) {
  // Una entrada de historial por sesión de visionado (no más de una cada 30 minutos por obra)
  const [recent] = await sql`select 1 from watch_history where viewer_profile_id = ${viewer.viewerProfileId} and content_type = ${contentType}
    and content_id = ${contentId} and started_at > now() - interval '30 minutes'`;
  if (!recent) await sql`insert into watch_history (viewer_profile_id, content_type, content_id, title_id) values (${viewer.viewerProfileId}, ${contentType}, ${contentId}, ${titleId})`;
}

export async function markWatched(viewer: Viewer, contentType: 'episode' | 'title', contentId: string, watched: boolean) {
  if (!watched) {
    await sql`delete from watch_progress where viewer_profile_id = ${viewer.viewerProfileId} and content_type = ${contentType} and content_id = ${contentId}`;
    return;
  }
  await saveProgress(viewer, { contentType, contentId, position: 1, duration: 1 });
  await sql`update watch_progress set completed = true where viewer_profile_id = ${viewer.viewerProfileId} and content_type = ${contentType} and content_id = ${contentId}`;
}

export async function progressForTitle(viewer: Viewer | null, titleId: string) {
  if (!viewer) return {};
  const rows = await sql`select content_id, position_seconds, duration_seconds, completed from watch_progress
    where viewer_profile_id = ${viewer.viewerProfileId} and title_id = ${titleId}`;
  return Object.fromEntries(rows.map((r) => [r.content_id, { position: r.position_seconds, duration: r.duration_seconds, completed: r.completed }])) as Record<string, { position: number; duration: number | null; completed: boolean }>;
}

async function defaultWatchlist(viewer: Viewer) {
  const [w] = await sql`select id from watchlists where viewer_profile_id = ${viewer.viewerProfileId} and is_default`;
  if (w) return w.id as string;
  const [n] = await sql`insert into watchlists (viewer_profile_id) values (${viewer.viewerProfileId}) returning id`;
  return n.id as string;
}

export async function setInWatchlist(viewer: Viewer, titleId: string, inList: boolean) {
  const [t] = await sql`select id from titles t where t.id = ${titleId} and ${VISIBLE('t')}`;
  if (!t) return false;
  const list = await defaultWatchlist(viewer);
  if (inList) await sql`insert into watchlist_items (watchlist_id, title_id) values (${list}, ${titleId}) on conflict do nothing`;
  else await sql`delete from watchlist_items where watchlist_id = ${list} and title_id = ${titleId}`;
  return true;
}

export async function isInWatchlist(viewer: Viewer | null, titleId: string) {
  if (!viewer) return false;
  const [r] = await sql`select 1 from watchlist_items wi join watchlists w on w.id = wi.watchlist_id
    where w.viewer_profile_id = ${viewer.viewerProfileId} and w.is_default and wi.title_id = ${titleId}`;
  return !!r;
}
