// Analítica de streaming con minimización de datos: sin IP, sin huella del navegador.
// Una visita a la ficha (page_view) NUNCA cuenta como reproducción; una reproducción válida
// (play_valid) exige 30 s reales de visionado o el 50 % de una pieza corta.
import { z } from 'zod';
import { sql } from './db';
import { deviceFromUA } from './auth/core';

export const eventSchema = z.object({
  event: z.enum(['page_view', 'play_start', 'play_valid', 'heartbeat', 'pause', 'complete', 'error', 'trailer_start', 'share', 'book_click']),
  contentType: z.enum(['episode', 'title', 'trailer']),
  contentId: z.string().uuid(),
  sessionKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  position: z.number().min(0).max(86400).optional(),
  watched: z.number().min(0).max(600).optional(), // segundos vistos desde el último latido
  errorCode: z.string().max(80).optional(),
  source: z.string().max(80).optional(),
  utm: z.object({ source: z.string().max(80).optional(), medium: z.string().max(80).optional(), campaign: z.string().max(120).optional() }).optional(),
});
export type PlaybackEventInput = z.infer<typeof eventSchema>;

export async function recordEvent(e: PlaybackEventInput, ctx: { viewerProfileId: string | null; userAgent: string | null; country: string | null; consent: boolean }) {
  const table = e.contentType === 'episode' ? sql`episodes` : e.contentType === 'title' ? sql`titles` : sql`trailers`;
  const [owner] = await sql`select ${e.contentType === 'title' ? sql`id` : sql`title_id`} as title_id from ${table} where id = ${e.contentId}`;
  if (!owner) return false;
  const [asset] = await sql`select id from video_assets where owner_type = ${e.contentType} and owner_id = ${e.contentId} and is_current`;
  await sql`insert into playback_events (event_type, content_type, content_id, title_id, video_asset_id, viewer_profile_id, session_key,
      position_seconds, watched_seconds, device, country, source, utm_source, utm_medium, utm_campaign, error_code)
    values (${e.event}, ${e.contentType}, ${e.contentId}, ${owner.title_id}, ${asset?.id ?? null},
      ${ctx.consent ? ctx.viewerProfileId : null}, ${ctx.consent ? e.sessionKey ?? null : null},
      ${e.position != null ? Math.floor(e.position) : null}, ${e.watched != null ? Math.round(e.watched) : null},
      ${deviceFromUA(ctx.userAgent)}, ${ctx.consent ? (ctx.country || '').slice(0, 2).toUpperCase() || null : null},
      ${e.source ?? null}, ${e.utm?.source ?? null}, ${e.utm?.medium ?? null}, ${e.utm?.campaign ?? null}, ${e.errorCode ?? null})`;
  return true;
}

export async function dashboardStats(days = 30) {
  const since = sql`now() - make_interval(days => ${days})`;
  const [catalog] = await sql`select
      count(*) filter (where status = 'published')::int as published,
      count(*) filter (where type <> 'series')::int as films,
      count(*) filter (where type = 'series')::int as series,
      count(*) filter (where status in ('draft', 'in_review'))::int as drafts
    from titles`;
  const [eps] = await sql`select count(*)::int as total, count(*) filter (where status = 'published')::int as published from episodes`;
  const videos = await sql`select status, count(*)::int as n from video_assets group by status`;
  const [plays] = await sql`select
      count(*) filter (where event_type = 'page_view')::int as page_views,
      count(*) filter (where event_type = 'play_start')::int as starts,
      count(*) filter (where event_type = 'play_valid')::int as valid,
      count(*) filter (where event_type = 'complete')::int as completes,
      count(*) filter (where event_type = 'trailer_start')::int as trailer_starts,
      count(*) filter (where event_type = 'error')::int as errors,
      coalesce(sum(watched_seconds) filter (where event_type in ('heartbeat', 'pause', 'complete')), 0)::bigint as watched_seconds,
      count(distinct viewer_profile_id)::int as active_viewers
    from playback_events where created_at > ${since}`;
  const [users] = await sql`select count(*)::int as total, count(*) filter (where created_at > ${since})::int as new from profiles where role = 'viewer'`;
  const top = await sql`select pe.content_type, pe.content_id, coalesce(e.name, tr.name, t.title) as name, t.title as title,
      count(*) filter (where pe.event_type = 'play_valid')::int as valid,
      count(*) filter (where pe.event_type = 'play_start')::int as starts,
      count(*) filter (where pe.event_type = 'complete')::int as completes,
      coalesce(sum(pe.watched_seconds), 0)::bigint as watched
    from playback_events pe left join titles t on t.id = pe.title_id
    left join episodes e on pe.content_type = 'episode' and e.id = pe.content_id
    left join trailers tr on pe.content_type = 'trailer' and tr.id = pe.content_id
    where pe.created_at > ${since} and pe.event_type in ('play_start', 'play_valid', 'complete', 'heartbeat', 'pause', 'trailer_start')
    group by pe.content_type, pe.content_id, e.name, tr.name, t.title order by valid desc, starts desc limit 10`;
  const devices = await sql`select device, count(*)::int as n from playback_events where event_type = 'play_start' and created_at > ${since} group by device order by n desc`;
  const sources = await sql`select coalesce(utm_source, source, 'directo') as source, count(*)::int as n from playback_events
    where event_type = 'page_view' and created_at > ${since} group by 1 order by n desc limit 8`;
  const daily = await sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n from playback_events
    where event_type = 'play_valid' and created_at > ${since} group by 1 order by 1`;
  const recentErrors = await sql`select pe.error_code, pe.created_at, coalesce(e.name, t.title) as name, pe.device from playback_events pe
    left join titles t on t.id = pe.title_id left join episodes e on pe.content_type = 'episode' and e.id = pe.content_id
    where pe.event_type = 'error' order by pe.created_at desc limit 8`;
  const failedVideos = await sql`select va.id, va.owner_type, va.owner_id, va.error_message, va.updated_at from video_assets va where va.status = 'error' order by va.updated_at desc limit 8`;
  const upcoming = await sql`select r.release_at, r.date_label, r.is_confirmed, t.title, e.name as episode_name from release_schedules r join titles t on t.id = r.title_id
    left join episodes e on e.id = r.episode_id where r.status in ('announced', 'confirmed', 'postponed') order by r.release_at nulls last limit 6`;
  const [notify] = await sql`select (select count(*) from release_notifications where unsubscribed_at is null)::int as release_alerts,
    (select count(*) from newsletter_subscriptions where unsubscribed_at is null)::int as newsletter`;
  const [revenue] = await sql`select coalesce(sum(amount_cents), 0)::bigint as cents, count(*)::int as n from payments where status = 'succeeded' and confirmed_at is not null`;
  return {
    days, catalog, episodes: eps,
    videos: Object.fromEntries(videos.map((v) => [v.status, v.n])) as Record<string, number>,
    plays: { ...plays, watched_minutes: Math.round(Number(plays.watched_seconds) / 60) } as Record<string, number>,
    users, top, devices, sources, daily, recentErrors, failedVideos, upcoming, notify,
    revenue: { cents: Number(revenue.cents), payments: revenue.n },
  };
}
