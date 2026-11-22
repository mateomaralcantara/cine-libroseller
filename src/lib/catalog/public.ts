// Consultas del portal público. Sólo devuelven contenido publicado (o programado cuya hora ya llegó).
import { sql } from '../db';

export const VISIBLE = (alias: string) =>
  sql.unsafe(`(${alias}.status = 'published' or (${alias}.status = 'scheduled' and ${alias}.publish_at <= now()))`);

export interface Images { poster?: Img; backdrop?: Img; banner?: Img; logo?: Img; social?: Img; thumbnail?: Img; still?: Img }
export interface Img { url: string; alt: string; width: number | null; height: number | null }

export interface TitleCard {
  id: string; slug: string; type: string; title: string; tagline: string | null; synopsis_short: string | null;
  release_date: string | null; runtime_minutes: number | null; age_rating: string | null; access: string;
  genres: string[]; images: Images; episodes_available: number;
}

async function imagesFor(ownerType: string, ids: string[]): Promise<Record<string, Images & { gallery: Img[]; behind: Img[] }>> {
  const out: Record<string, Images & { gallery: Img[]; behind: Img[] }> = {};
  if (!ids.length) return out;
  const rows = await sql`select owner_id, kind, url, alt_text, width, height from media_images
    where owner_type = ${ownerType} and owner_id in ${sql(ids)} and is_public order by position, created_at`;
  for (const r of rows) {
    const o = (out[r.owner_id] ??= { gallery: [], behind: [] });
    const img: Img = { url: r.url, alt: r.alt_text, width: r.width, height: r.height };
    const slot = o as unknown as Record<string, Img | undefined>;
    if (r.kind === 'gallery' || r.kind === 'still') o.gallery.push(img);
    if (r.kind === 'behind_scenes') o.behind.push(img);
    else if (r.kind !== 'gallery' && !slot[r.kind]) slot[r.kind] = img;
  }
  return out;
}

async function toCards(rows: Record<string, any>[]): Promise<TitleCard[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const imgs = await imagesFor('title', ids);
  const genres = await sql`select tg.title_id, g.name from title_genres tg join genres g on g.id = tg.genre_id
    where tg.title_id in ${sql(ids)} order by g.position, g.name`;
  const eps = await sql`select e.title_id, count(*)::int as n from episodes e where e.title_id in ${sql(ids)} and ${VISIBLE('e')} group by e.title_id`;
  const epMap = Object.fromEntries(eps.map((e) => [e.title_id, e.n]));
  return rows
    .map((r) => ({
      id: r.id, slug: r.slug, type: r.type, title: r.title, tagline: r.tagline, synopsis_short: r.synopsis_short,
      release_date: r.release_date ? String(r.release_date instanceof Date ? r.release_date.toISOString() : r.release_date).slice(0, 10) : null,
      runtime_minutes: r.runtime_minutes, age_rating: r.age_rating, access: r.access,
      genres: genres.filter((g) => g.title_id === r.id).map((g) => g.name),
      images: imgs[r.id] ?? {}, episodes_available: epMap[r.id] ?? 0,
    }))
    // Un título sin póster ni imagen horizontal no se muestra en filas públicas
    .filter((c) => c.images.poster || c.images.backdrop || c.images.banner);
}

const TITLE_COLS = sql`t.id, t.slug, t.type, t.title, t.tagline, t.synopsis_short, t.release_date, t.runtime_minutes, t.age_rating, t.access, t.published_at`;

export async function visibleTitles(where = sql``, order = sql`order by coalesce(t.published_at, t.created_at) desc`, limit = 24) {
  const rows = await sql`select ${TITLE_COLS} from titles t where ${VISIBLE('t')} ${where} ${order} limit ${limit}`;
  return toCards(rows);
}

export async function getHero() {
  const [f] = await sql`select f.*, t.slug from featured_content f join titles t on t.id = f.title_id
    where f.is_active and ${VISIBLE('t')} and (f.starts_at is null or f.starts_at <= now()) and (f.ends_at is null or f.ends_at > now())
    order by f.position, f.created_at desc limit 1`;
  const id = f?.title_id ?? (await sql`select t.id from titles t where ${VISIBLE('t')} order by t.published_at desc nulls last limit 1`)[0]?.id;
  if (!id) return null;
  const detail = await getTitleById(id);
  if (!detail) return null;
  return { ...detail, headline: f?.headline ?? null };
}

// ------------------------------------------------------------------ Ficha de título
export async function getTitleById(id: string) {
  const [t] = await sql`select * from titles t where t.id = ${id} and ${VISIBLE('t')}`;
  return t ? buildTitle(t) : null;
}

export async function getTitleBySlug(slug: string, type?: 'series' | 'film') {
  const [t] = await sql`select * from titles t where t.slug = ${slug} and ${VISIBLE('t')}`;
  if (!t) return null;
  if (type === 'series' && t.type !== 'series') return null;
  if (type === 'film' && t.type === 'series') return null;
  return buildTitle(t);
}

async function buildTitle(t: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const imgs = (await imagesFor('title', [t.id]))[t.id] ?? { gallery: [], behind: [] };
  const genres = await sql`select g.slug, g.name from title_genres tg join genres g on g.id = tg.genre_id where tg.title_id = ${t.id} order by g.position`;
  const categories = await sql`select c.slug, c.name from title_categories tc join categories c on c.id = tc.category_id where tc.title_id = ${t.id}`;
  const credits = await sql`select tc.role, tc.credit_note, p.name, p.slug, p.photo_url, ch.name as character_name, ch.slug as character_slug
    from title_credits tc join people p on p.id = tc.person_id left join characters ch on ch.id = tc.character_id and ch.is_published
    where tc.title_id = ${t.id} and tc.episode_id is null order by tc.position, p.name`;
  const characters = await sql`select c.slug, c.name, c.summary, c.image_url, c.digital_identity, p.name as actor_name
    from characters c left join people p on p.id = c.actor_id where c.title_id = ${t.id} and c.is_published order by c.position, c.name`;
  const extras = await sql`select tr.id, tr.name, tr.kind, tr.description, tr.is_primary, tr.episode_id, va.duration_seconds, va.playback_id, va.provider
    from trailers tr join video_assets va on va.owner_type = 'trailer' and va.owner_id = tr.id and va.is_current and va.status in ('ready','published')
    where tr.title_id = ${t.id} and tr.is_published order by tr.is_primary desc, tr.position, tr.created_at`;
  const seasons = t.type === 'series' ? await getSeasons(t.id) : [];
  const [movieAsset] = t.type !== 'series'
    ? await sql`select duration_seconds from video_assets where owner_type = 'title' and owner_id = ${t.id} and is_current and status in ('ready','published')`
    : [];
  const releases = await sql`select r.id, r.headline, r.release_at, r.date_label, r.is_confirmed, r.status, e.name as episode_name, e.number as episode_number, s.number as season_number
    from release_schedules r left join episodes e on e.id = r.episode_id left join seasons s on s.id = e.season_id
    where r.title_id = ${t.id} and r.is_public and r.status in ('announced','confirmed','postponed') order by r.release_at nulls last`;
  return {
    id: t.id as string, slug: t.slug as string, type: t.type as string, title: t.title as string,
    international_title: t.international_title, tagline: t.tagline, synopsis_short: t.synopsis_short, synopsis_long: t.synopsis_long,
    release_date: t.release_date ? new Date(t.release_date).toISOString().slice(0, 10) : null,
    production_date: t.production_date ? new Date(t.production_date).toISOString().slice(0, 10) : null,
    runtime_minutes: t.runtime_minutes as number | null, country: t.country, languages: t.languages as string[],
    age_rating: t.age_rating, production_company: t.production_company, access: t.access as string,
    ai_disclosure: t.ai_disclosure as string, ai_disclosure_note: t.ai_disclosure_note,
    source_book: t.source_book as null | { title: string; author?: string; publisher?: string; cover_url?: string; synopsis?: string; relation?: string; purchase_url?: string },
    related_links: t.related_links as { label: string; url: string }[],
    seo_title: t.seo_title, seo_description: t.seo_description, published_at: t.published_at,
    images: imgs, genres: genres as unknown as { slug: string; name: string }[], categories: categories as unknown as { slug: string; name: string }[],
    credits: credits as unknown as { role: string; credit_note: string | null; name: string; slug: string; photo_url: string | null; character_name: string | null; character_slug: string | null }[],
    characters: characters as unknown as { slug: string; name: string; summary: string | null; image_url: string | null; digital_identity: string | null; actor_name: string | null }[],
    extras: extras as unknown as { id: string; name: string; kind: string; description: string | null; is_primary: boolean; episode_id: string | null; duration_seconds: string | null }[],
    seasons, playable: t.type !== 'series' ? !!movieAsset : seasons.some((s) => s.episodes.length > 0),
    releases: releases as unknown as { id: string; headline: string | null; release_at: Date | null; date_label: string | null; is_confirmed: boolean; status: string; episode_name: string | null; episode_number: number | null; season_number: number | null }[],
  };
}
export type TitleDetail = NonNullable<Awaited<ReturnType<typeof getTitleById>>>;

export interface EpisodeItem {
  id: string; number: number; name: string; synopsis: string | null; runtime_minutes: number | null;
  release_date: string | null; access: string; thumbnail: Img | null; season_number: number; playable: boolean;
}

export async function getSeasons(titleId: string) {
  const seasons = await sql`select * from seasons s where s.title_id = ${titleId} and s.status = 'published' order by s.number`;
  if (!seasons.length) return [];
  const eps = await sql`select e.*, s.number as season_number,
      exists(select 1 from video_assets va where va.owner_type = 'episode' and va.owner_id = e.id and va.is_current and va.status in ('ready','published')) as playable
    from episodes e join seasons s on s.id = e.season_id
    where e.title_id = ${titleId} and ${VISIBLE('e')} order by s.number, e.number`;
  const thumbs = await imagesFor('episode', eps.map((e) => e.id));
  return seasons.map((s) => ({
    id: s.id as string, number: s.number as number, name: s.name as string | null, synopsis: s.synopsis as string | null,
    episodes: eps.filter((e) => e.season_id === s.id).map((e): EpisodeItem => ({
      id: e.id, number: e.number, name: e.name, synopsis: e.synopsis, runtime_minutes: e.runtime_minutes,
      release_date: e.release_date ? new Date(e.release_date).toISOString().slice(0, 10) : null, access: e.access,
      thumbnail: thumbs[e.id]?.thumbnail ?? thumbs[e.id]?.still ?? null, season_number: e.season_number, playable: e.playable,
    })),
  }));
}

export async function getEpisode(seriesSlug: string, seasonNumber: number, episodeNumber: number) {
  const series = await getTitleBySlug(seriesSlug, 'series');
  if (!series) return null;
  const season = series.seasons.find((s) => s.number === seasonNumber);
  const episode = season?.episodes.find((e) => e.number === episodeNumber);
  if (!season || !episode) return null;
  const all = series.seasons.flatMap((s) => s.episodes);
  const idx = all.findIndex((e) => e.id === episode.id);
  const characters = await sql`select c.slug, c.name, c.image_url from character_appearances ca join characters c on c.id = ca.character_id
    where ca.episode_id = ${episode.id} and c.is_published order by c.position`;
  return { series, season, episode, previous: all[idx - 1] ?? null, next: all[idx + 1] ?? null, characters };
}

// ------------------------------------------------------------------ Descubrimiento
/** Recomendación nivel 1: géneros y categorías compartidos, sin repetir el título actual. */
export async function relatedTitles(titleId: string, limit = 12) {
  const rows = await sql`
    select ${TITLE_COLS}, (
      (select count(*) from title_genres a join title_genres b on a.genre_id = b.genre_id where a.title_id = t.id and b.title_id = ${titleId}) * 2 +
      (select count(*) from title_categories a join title_categories b on a.category_id = b.category_id where a.title_id = t.id and b.title_id = ${titleId})
    ) as score
    from titles t where ${VISIBLE('t')} and t.id <> ${titleId}
    order by score desc, t.published_at desc nulls last limit ${limit}`;
  return toCards(rows.filter((r) => Number(r.score) > 0));
}

export async function upcomingReleases(limit = 12) {
  const rows = await sql`
    select r.id, r.headline, r.release_at, r.date_label, r.is_confirmed, r.status, t.id as title_id, t.slug, t.type, t.title, t.synopsis_short,
      e.name as episode_name, e.number as episode_number, s.number as season_number
    from release_schedules r join titles t on t.id = r.title_id
    left join episodes e on e.id = r.episode_id left join seasons s on s.id = e.season_id
    where r.is_public and r.status in ('announced', 'confirmed', 'postponed') and (r.release_at is null or r.release_at > now())
      and t.status <> 'archived'
    order by r.release_at nulls last limit ${limit}`;
  const imgs = await imagesFor('title', [...new Set(rows.map((r) => r.title_id))]);
  return rows.map((r) => ({ ...r, images: imgs[r.title_id] ?? {} })) as unknown as {
    id: string; headline: string | null; release_at: Date | null; date_label: string | null; is_confirmed: boolean; status: string;
    title_id: string; slug: string; type: string; title: string; synopsis_short: string | null; episode_name: string | null;
    episode_number: number | null; season_number: number | null; images: Images;
  }[];
}

export async function newEpisodes(days = 60, limit = 12) {
  const rows = await sql`select e.id, e.name, e.number, e.synopsis, e.runtime_minutes, s.number as season_number, t.slug, t.title, t.id as title_id
    from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id
    where ${VISIBLE('e')} and ${VISIBLE('t')} and coalesce(e.published_at, e.publish_at) > now() - make_interval(days => ${days})
    order by coalesce(e.published_at, e.publish_at) desc limit ${limit}`;
  const thumbs = await imagesFor('episode', rows.map((r) => r.id));
  const timgs = await imagesFor('title', [...new Set(rows.map((r) => r.title_id))]);
  return rows.map((r) => ({ ...r, image: thumbs[r.id]?.thumbnail ?? thumbs[r.id]?.still ?? timgs[r.title_id]?.backdrop ?? null })) as unknown as {
    id: string; name: string; number: number; synopsis: string | null; runtime_minutes: number | null; season_number: number; slug: string; title: string; image: Img | null;
  }[];
}

export async function behindTheScenes(limit = 12) {
  const rows = await sql`select tr.id, tr.name, tr.kind, tr.description, t.slug, t.type, t.title, t.id as title_id, va.duration_seconds
    from trailers tr join titles t on t.id = tr.title_id
    join video_assets va on va.owner_type = 'trailer' and va.owner_id = tr.id and va.is_current and va.status in ('ready','published')
    where tr.is_published and tr.kind in ('behind_the_scenes', 'interview', 'featurette', 'lecture') and ${VISIBLE('t')}
    order by tr.created_at desc limit ${limit}`;
  const timgs = await imagesFor('title', [...new Set(rows.map((r) => r.title_id))]);
  return rows.map((r) => ({ ...r, image: timgs[r.title_id]?.backdrop ?? timgs[r.title_id]?.banner ?? null })) as unknown as {
    id: string; name: string; kind: string; description: string | null; slug: string; type: string; title: string; title_id: string; duration_seconds: string | null; image: Img | null;
  }[];
}

export async function approvedComparisons(titleId?: string) {
  return sql`select c.*, t.title as title_name, t.slug as title_slug, t.type as title_type from media_comparisons c left join titles t on t.id = c.title_id
    where c.approved_for_public and (c.title_id is null or ${VISIBLE('t')}) ${titleId ? sql`and c.title_id = ${titleId}` : sql``}
    order by c.position, c.created_at`;
}

export async function mostViewed(limit = 12) {
  const rows = await sql`select ${TITLE_COLS}, count(pe.id) as plays from titles t
    join playback_events pe on pe.title_id = t.id and pe.event_type = 'play_valid' and pe.created_at > now() - interval '30 days'
    where ${VISIBLE('t')} group by t.id having count(pe.id) > 0 order by plays desc limit ${limit}`;
  return toCards(rows);
}

export async function getCharacter(seriesSlug: string, characterSlug: string) {
  const title = await getTitleBySlug(seriesSlug);
  if (!title) return null;
  const [c] = await sql`select c.*, p.name as actor_name, p.slug as actor_slug, p.bio as actor_bio, e.number as first_episode_number, s.number as first_season_number
    from characters c left join people p on p.id = c.actor_id left join episodes e on e.id = c.first_episode_id left join seasons s on s.id = e.season_id
    where c.title_id = ${title.id} and c.slug = ${characterSlug} and c.is_published`;
  if (!c) return null;
  const appearances = await sql`select e.number, e.name, s.number as season_number from character_appearances ca
    join episodes e on e.id = ca.episode_id join seasons s on s.id = e.season_id where ca.character_id = ${c.id} and ${VISIBLE('e')} order by s.number, e.number`;
  const imgs = (await imagesFor('character', [c.id]))[c.id];
  return { title, character: c, appearances, gallery: imgs?.gallery ?? [] };
}

// ------------------------------------------------------------------ Búsqueda
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ACCENT_FROM = 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙ';
const ACCENT_TO = 'aeiouunAEIOUUNaeiouAEIOU';

/**
 * Búsqueda por título, sinopsis, género, categoría, director, reparto, personaje, año, país y tipo.
 * Sólo recupera obras reales del catálogo publicado; si no hay coincidencias, devuelve una lista vacía.
 */
export async function searchCatalog(q: string, filters: { type?: string; genre?: string; year?: string } = {}) {
  const term = norm(q).slice(0, 100);
  const words = term.split(/\s+/).filter((w) => w.length >= 2).slice(0, 8);
  const f = (col: string) => sql.unsafe(`lower(translate(coalesce(${col}, ''), '${ACCENT_FROM}', '${ACCENT_TO}'))`);
  const year = /^\d{4}$/.test(term) ? term : filters.year && /^\d{4}$/.test(filters.year) ? filters.year : null;
  const textWords = words.filter((w) => w !== year);
  const matches = textWords.map((w) => {
    const like = `%${w.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    return sql`(
      ${f('t.title')} like ${like} or ${f('t.international_title')} like ${like} or ${f('t.tagline')} like ${like}
      or ${f('t.synopsis_short')} like ${like} or ${f('t.synopsis_long')} like ${like} or ${f('t.country')} like ${like}
      or exists (select 1 from title_genres tg join genres g on g.id = tg.genre_id where tg.title_id = t.id and ${f('g.name')} like ${like})
      or exists (select 1 from title_categories tc join categories c on c.id = tc.category_id where tc.title_id = t.id and (${f('c.name')} like ${like} or ${f('c.description')} like ${like}))
      or exists (select 1 from title_credits cr join people p on p.id = cr.person_id where cr.title_id = t.id and ${f('p.name')} like ${like})
      or exists (select 1 from characters ch where ch.title_id = t.id and ch.is_published and (${f('ch.name')} like ${like} or ${f('ch.summary')} like ${like}))
      or exists (select 1 from episodes e where e.title_id = t.id and ${VISIBLE('e')} and (${f('e.name')} like ${like} or ${f('e.synopsis')} like ${like}))
    )`;
  });
  if (!matches.length && !year && !filters.type && !filters.genre) return [];
  let where = sql`and true`;
  for (const m of matches) where = sql`${where} and ${m}`;
  if (year) where = sql`${where} and (extract(year from t.release_date)::text = ${year} or extract(year from t.production_date)::text = ${year})`;
  if (filters.type) where = sql`${where} and t.type = ${filters.type}`;
  if (filters.genre) where = sql`${where} and exists (select 1 from title_genres tg join genres g on g.id = tg.genre_id where tg.title_id = t.id and g.slug = ${filters.genre})`;
  return visibleTitles(where, sql`order by t.published_at desc nulls last`, 40);
}

export async function allGenres() {
  return sql`select g.slug, g.name from genres g where exists (select 1 from title_genres tg join titles t on t.id = tg.title_id where tg.genre_id = g.id and ${VISIBLE('t')}) order by g.position, g.name`;
}

// ------------------------------------------------------------------ Espectador
export async function continueWatching(viewerProfileId: string, limit = 12) {
  const rows = await sql`select wp.*, t.slug, t.type, t.title, e.name as episode_name, e.number as episode_number, s.number as season_number
    from watch_progress wp join titles t on t.id = wp.title_id
    left join episodes e on wp.content_type = 'episode' and e.id = wp.content_id left join seasons s on s.id = e.season_id
    where wp.viewer_profile_id = ${viewerProfileId} and not wp.completed and wp.position_seconds > 10 and ${VISIBLE('t')}
      and (wp.content_type = 'title' or ${VISIBLE('e')})
    order by wp.updated_at desc limit ${limit}`;
  const timgs = await imagesFor('title', [...new Set(rows.map((r) => r.title_id))]);
  const eimgs = await imagesFor('episode', rows.filter((r) => r.content_type === 'episode').map((r) => r.content_id));
  return rows.map((r) => ({
    ...r,
    image: (r.content_type === 'episode' ? eimgs[r.content_id]?.thumbnail ?? eimgs[r.content_id]?.still : null) ?? timgs[r.title_id]?.backdrop ?? timgs[r.title_id]?.banner ?? null,
  })) as unknown as {
    content_type: string; content_id: string; title_id: string; slug: string; type: string; title: string; position_seconds: number;
    duration_seconds: number | null; episode_name: string | null; episode_number: number | null; season_number: number | null; image: Img | null;
  }[];
}

export async function watchlistTitles(viewerProfileId: string) {
  const rows = await sql`select ${TITLE_COLS} from watchlist_items wi join watchlists w on w.id = wi.watchlist_id and w.is_default
    join titles t on t.id = wi.title_id where w.viewer_profile_id = ${viewerProfileId} and ${VISIBLE('t')} order by wi.added_at desc`;
  return toCards(rows);
}

/** Recomendaciones personales nivel 1: géneros de lo que la persona vio o guardó. */
export async function recommendedFor(viewerProfileId: string, limit = 12) {
  const rows = await sql`
    with seen as (
      select title_id from watch_progress where viewer_profile_id = ${viewerProfileId}
      union select wi.title_id from watchlist_items wi join watchlists w on w.id = wi.watchlist_id where w.viewer_profile_id = ${viewerProfileId}
    ), liked as (select distinct tg.genre_id from title_genres tg where tg.title_id in (select title_id from seen))
    select ${TITLE_COLS}, (select count(*) from title_genres tg where tg.title_id = t.id and tg.genre_id in (select genre_id from liked)) as score
    from titles t where ${VISIBLE('t')} and t.id not in (select title_id from seen)
    order by score desc, t.published_at desc nulls last limit ${limit}`;
  return toCards(rows.filter((r) => Number(r.score) > 0));
}

// ------------------------------------------------------------------ Portada configurable
export type HomeSection =
  | { id: string; kind: 'titles'; heading: string; subheading: string | null; items: TitleCard[] }
  | { id: string; kind: 'continue'; heading: string; subheading: string | null; items: Awaited<ReturnType<typeof continueWatching>> }
  | { id: string; kind: 'episodes'; heading: string; subheading: string | null; items: Awaited<ReturnType<typeof newEpisodes>> }
  | { id: string; kind: 'upcoming'; heading: string; subheading: string | null; items: Awaited<ReturnType<typeof upcomingReleases>> }
  | { id: string; kind: 'extras'; heading: string; subheading: string | null; items: Awaited<ReturnType<typeof behindTheScenes>> }
  | { id: string; kind: 'spotlight'; heading: string; subheading: string | null; title: TitleDetail };

export async function getHomeSections(viewerProfileId: string | null): Promise<HomeSection[]> {
  const sections = await sql`select * from homepage_sections where is_visible
    and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()) order by position, created_at`;
  const out: HomeSection[] = [];
  for (const s of sections) {
    const c = s.config as Record<string, string | number | undefined>;
    const limit = Number(c.limit) || 18;
    const base = { id: s.id as string, heading: s.heading as string, subheading: s.subheading as string | null };
    switch (s.kind) {
      case 'spotlight': {
        const t = c.title_id ? await getTitleById(String(c.title_id)) : null;
        if (t) out.push({ ...base, kind: 'spotlight', title: t });
        break;
      }
      case 'continue_watching':
        if (viewerProfileId) out.push({ ...base, kind: 'continue', items: await continueWatching(viewerProfileId, limit) });
        break;
      case 'recommended':
        if (viewerProfileId) out.push({ ...base, kind: 'titles', items: await recommendedFor(viewerProfileId, limit) });
        break;
      case 'by_type':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(sql`and t.type = ${String(c.type)}`, undefined, limit) });
        break;
      case 'by_genre':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(sql`and exists (select 1 from title_genres tg join genres g on g.id = tg.genre_id where tg.title_id = t.id and g.slug = ${String(c.genre)})`, undefined, limit) });
        break;
      case 'by_category':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(sql`and exists (select 1 from title_categories tc join categories ca on ca.id = tc.category_id where tc.title_id = t.id and ca.slug = ${String(c.category)})`, undefined, limit) });
        break;
      case 'collection':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(
          sql`and t.id in (select ci.title_id from collection_items ci join collections co on co.id = ci.collection_id where co.slug = ${String(c.collection)} and co.is_visible)`,
          sql`order by (select ci.position from collection_items ci join collections co on co.id = ci.collection_id where co.slug = ${String(c.collection)} and ci.title_id = t.id)`, limit) });
        break;
      case 'manual':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(
          sql`and t.id in (select title_id from homepage_section_items where section_id = ${s.id})`,
          sql`order by (select position from homepage_section_items where section_id = ${s.id} and title_id = t.id)`, limit) });
        break;
      case 'recent':
        out.push({ ...base, kind: 'titles', items: await visibleTitles(sql`and t.published_at > now() - interval '120 days'`, undefined, limit) });
        break;
      case 'most_viewed':
        out.push({ ...base, kind: 'titles', items: await mostViewed(limit) });
        break;
      case 'new_episodes':
        out.push({ ...base, kind: 'episodes', items: await newEpisodes(Number(c.days) || 60, limit) });
        break;
      case 'upcoming':
        out.push({ ...base, kind: 'upcoming', items: await upcomingReleases(limit) });
        break;
      case 'behind_scenes':
        out.push({ ...base, kind: 'extras', items: await behindTheScenes(limit) });
        break;
    }
  }
  // Las filas vacías no se muestran
  return out.filter((s) => s.kind === 'spotlight' || s.items.length > 0);
}
