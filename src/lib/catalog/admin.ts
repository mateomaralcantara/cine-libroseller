// Servicios de administración del catálogo. Toda escritura deja auditoría y, si cambia contenido, una revisión.
import { z } from 'zod';
import { sql, type Tx } from '../db';
import { audit, snapshot } from '../audit';
import { slugify } from '../format';
import { currentAsset, markOwnerVideoPublished } from '../video/service';

export class ValidationError extends Error {
  constructor(message: string, public fields: Record<string, string> = {}) { super(message); }
}

export type PubStatus = 'draft' | 'in_review' | 'scheduled' | 'published' | 'withdrawn' | 'archived';

const TRANSITIONS: Record<PubStatus, PubStatus[]> = {
  draft: ['in_review', 'scheduled', 'published', 'archived'],
  in_review: ['draft', 'scheduled', 'published', 'archived'],
  scheduled: ['draft', 'in_review', 'published', 'withdrawn'],
  published: ['withdrawn', 'archived'],
  withdrawn: ['draft', 'in_review', 'scheduled', 'published', 'archived'],
  archived: ['draft'],
};

const empty = (v: unknown) => (v === '' || v === undefined ? null : v);
const optText = (max: number) => z.preprocess(empty, z.string().trim().max(max).nullable());
const optDate = z.preprocess(empty, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').nullable());
const optInt = z.preprocess((v) => (empty(v) === null ? null : Number(v)), z.number().int().positive().max(100000).nullable());
const optUrl = z.preprocess(empty, z.string().trim().url('URL inválida').refine((u) => /^https?:\/\//.test(u), 'URL inválida').nullable());

export const sourceBookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: optText(160),
  publisher: optText(160),
  cover_url: optUrl,
  synopsis: optText(3000),
  relation: optText(500),
  purchase_url: optUrl,
  libroseller_id: optText(80),
}).nullable();

export const titleSchema = z.object({
  type: z.enum(['movie', 'series', 'short', 'documentary', 'special']),
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  slug: z.preprocess(empty, z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Sólo minúsculas, números y guiones').max(90).nullable()),
  international_title: optText(200),
  tagline: optText(200),
  synopsis_short: optText(400),
  synopsis_long: optText(6000),
  production_date: optDate,
  release_date: optDate,
  runtime_minutes: optInt,
  country: optText(80),
  original_language: z.preprocess((v) => empty(v) ?? 'es', z.string().trim().min(2).max(10)),
  languages: z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v ?? ['es']), z.array(z.string().max(10)).max(20)),
  age_rating: optText(20),
  production_company: z.preprocess((v) => empty(v) ?? 'Cine LibroSeller Studios', z.string().trim().max(160)),
  access: z.enum(['free', 'registered', 'premium']).default('free'),
  ai_disclosure: z.enum(['none', 'assisted', 'modified', 'generated']).default('none'),
  ai_disclosure_note: optText(1000),
  seo_title: optText(70),
  seo_description: optText(170),
  source_book: sourceBookSchema.optional(),
  genre_ids: z.array(z.string().uuid()).max(10).optional(),
  category_ids: z.array(z.string().uuid()).max(10).optional(),
});
export type TitleInput = z.input<typeof titleSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[String(i.path[0] ?? 'form')] ??= i.message;
    throw new ValidationError('Revisa los campos marcados.', fields);
  }
  return r.data;
}

async function uniqueSlug(base: string, table: 'titles', excludeId?: string, db: Tx = sql) {
  let slug = base || 'titulo';
  for (let i = 2; i < 200; i++) {
    const [hit] = await db`select 1 from ${db(table)} where slug = ${slug} and id <> ${excludeId ?? '00000000-0000-0000-0000-000000000000'}`;
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
  throw new ValidationError('No se pudo generar un slug único.');
}

async function setTaxonomies(titleId: string, genreIds: string[] | undefined, categoryIds: string[] | undefined, db: Tx) {
  if (genreIds) {
    await db`delete from title_genres where title_id = ${titleId}`;
    for (const g of genreIds) await db`insert into title_genres (title_id, genre_id) values (${titleId}, ${g}) on conflict do nothing`;
  }
  if (categoryIds) {
    await db`delete from title_categories where title_id = ${titleId}`;
    for (const c of categoryIds) await db`insert into title_categories (title_id, category_id) values (${titleId}, ${c}) on conflict do nothing`;
  }
}

function titleColumns(d: z.infer<typeof titleSchema>) {
  return {
    type: d.type, title: d.title, international_title: d.international_title, tagline: d.tagline,
    synopsis_short: d.synopsis_short, synopsis_long: d.synopsis_long, production_date: d.production_date,
    release_date: d.release_date, runtime_minutes: d.runtime_minutes, country: d.country,
    original_language: d.original_language, languages: d.languages, age_rating: d.age_rating,
    production_company: d.production_company, access: d.access, ai_disclosure: d.ai_disclosure,
    ai_disclosure_note: d.ai_disclosure_note, seo_title: d.seo_title, seo_description: d.seo_description,
  };
}

export async function createTitle(actorId: string, input: unknown) {
  const d = parse(titleSchema, input);
  return sql.begin(async (tx) => {
    const slug = await uniqueSlug(d.slug || slugify(d.title), 'titles', undefined, tx);
    const cols = { ...titleColumns(d), slug, created_by: actorId, source_book: d.source_book ? tx.json(d.source_book as never) : null };
    const [row] = await tx`insert into titles ${tx(cols as never)} returning *`;
    await setTaxonomies(row.id, d.genre_ids, d.category_ids, tx);
    await audit(actorId, 'title.create', 'title', row.id, { title: d.title, type: d.type }, tx);
    return row;
  });
}

export async function updateTitle(actorId: string, id: string, input: unknown) {
  const d = parse(titleSchema, input);
  return sql.begin(async (tx) => {
    const [existing] = await tx`select id, type, status from titles where id = ${id} for update`;
    if (!existing) throw new ValidationError('Título no encontrado.');
    if (existing.type !== d.type && (existing.type === 'series') !== (d.type === 'series')) {
      const [eps] = await tx`select count(*)::int as n from seasons where title_id = ${id}`;
      if (eps.n > 0) throw new ValidationError('No se puede convertir una serie con temporadas en película.', { type: 'Tiene temporadas' });
    }
    await snapshot('title', id, actorId, tx);
    const slug = await uniqueSlug(d.slug || slugify(d.title), 'titles', id, tx);
    const cols: Record<string, unknown> = { ...titleColumns(d), slug };
    if (d.source_book !== undefined) cols.source_book = d.source_book ? tx.json(d.source_book as never) : null;
    const [row] = await tx`update titles set ${tx(cols as never)} where id = ${id} returning *`;
    await setTaxonomies(id, d.genre_ids, d.category_ids, tx);
    await audit(actorId, 'title.update', 'title', id, undefined, tx);
    return row;
  });
}

/** Lista de requisitos pendientes para publicar un título. Vacía = se puede publicar. */
export async function titleReadiness(titleId: string, db: Tx = sql): Promise<string[]> {
  const [t] = await db`select * from titles where id = ${titleId}`;
  if (!t) return ['El título no existe'];
  const missing: string[] = [];
  if (!t.synopsis_short) missing.push('Sinopsis corta');
  const imgs = await db`select kind from media_images where owner_type = 'title' and owner_id = ${titleId} and is_public`;
  const kinds = new Set(imgs.map((i) => i.kind));
  if (!kinds.has('poster')) missing.push('Póster vertical');
  if (!kinds.has('backdrop') && !kinds.has('banner')) missing.push('Imagen horizontal (backdrop o banner)');
  if (t.type !== 'series' && !(await currentAsset('title', titleId, db))) missing.push('Video principal procesado y aprobado');
  const [rights] = await db`select 1 from content_rights where title_id = ${titleId} and verified
    and rights_type in ('distribution', 'streaming') and (ends_at is null or ends_at >= current_date)`;
  if (!rights) missing.push('Derechos de distribución o streaming verificados');
  return missing;
}

export async function episodeReadiness(episodeId: string, db: Tx = sql): Promise<string[]> {
  const [e] = await db`select * from episodes where id = ${episodeId}`;
  if (!e) return ['El episodio no existe'];
  const missing: string[] = [];
  if (!e.name) missing.push('Nombre del episodio');
  if (!(await currentAsset('episode', episodeId, db))) missing.push('Video del episodio procesado y aprobado');
  const [rights] = await db`select 1 from content_rights where title_id = ${e.title_id} and verified
    and rights_type in ('distribution', 'streaming') and (ends_at is null or ends_at >= current_date)`;
  if (!rights) missing.push('Derechos de la serie verificados');
  return missing;
}

function checkTransition(from: PubStatus, to: PubStatus) {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) throw new ValidationError(`No se puede pasar de «${from}» a «${to}».`);
}

function parsePublishAt(to: PubStatus, publishAt: string | Date | null | undefined): Date | null {
  if (to !== 'scheduled') return null;
  const d = publishAt ? new Date(publishAt) : null;
  if (!d || Number.isNaN(d.getTime())) throw new ValidationError('Indica fecha y hora de estreno.', { publish_at: 'Obligatoria' });
  if (d.getTime() <= Date.now()) throw new ValidationError('La fecha de estreno programado debe ser futura.', { publish_at: 'Debe ser futura' });
  return d;
}

export async function setTitleStatus(actorId: string, titleId: string, to: PubStatus, publishAt?: string | Date | null) {
  return sql.begin(async (tx) => {
    const [t] = await tx`select id, status, type from titles where id = ${titleId} for update`;
    if (!t) throw new ValidationError('Título no encontrado.');
    checkTransition(t.status, to);
    if (to === 'published' || to === 'scheduled') {
      const missing = await titleReadiness(titleId, tx);
      if (missing.length) throw new ValidationError(`Falta para publicar: ${missing.join(', ')}.`, { status: missing.join(', ') });
    }
    const when = parsePublishAt(to, publishAt);
    await snapshot('title', titleId, actorId, tx);
    await tx`update titles set status = ${to}, publish_at = ${when},
      published_at = case when ${to} = 'published' then coalesce(published_at, now()) else published_at end
      where id = ${titleId}`;
    if (t.type !== 'series') await markOwnerVideoPublished('title', titleId, to === 'published', tx);
    await audit(actorId, `title.status.${to}`, 'title', titleId, { from: t.status, publish_at: when }, tx);
  });
}

// ------------------------------------------------------------------ Temporadas y episodios
const seasonSchema = z.object({
  number: z.coerce.number().int().positive().max(100),
  name: optText(160),
  synopsis: optText(3000),
  release_date: optDate,
});

export async function createSeason(actorId: string, titleId: string, input: unknown) {
  const d = parse(seasonSchema, input);
  const [t] = await sql`select type from titles where id = ${titleId}`;
  if (!t) throw new ValidationError('Serie no encontrada.');
  if (t.type !== 'series') throw new ValidationError('Sólo las series tienen temporadas.');
  try {
    const [row] = await sql`insert into seasons ${sql({ title_id: titleId, ...d } as never)} returning *`;
    await audit(actorId, 'season.create', 'season', row.id, { title: titleId, number: d.number });
    return row;
  } catch (e) {
    if (String((e as Error).message).includes('seasons_title_id_number_key')) throw new ValidationError(`Ya existe la temporada ${d.number}.`, { number: 'Duplicada' });
    throw e;
  }
}

export async function updateSeason(actorId: string, seasonId: string, input: unknown) {
  const d = parse(seasonSchema, input);
  await snapshot('season', seasonId, actorId);
  const [row] = await sql`update seasons set ${sql(d as never)} where id = ${seasonId} returning *`;
  if (!row) throw new ValidationError('Temporada no encontrada.');
  await audit(actorId, 'season.update', 'season', seasonId);
  return row;
}

const episodeSchema = z.object({
  number: z.coerce.number().int().positive().max(1000),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  synopsis: optText(3000),
  runtime_minutes: optInt,
  release_date: optDate,
  access: z.enum(['free', 'registered', 'premium']).default('free'),
});

export async function createEpisode(actorId: string, seasonId: string, input: unknown) {
  const d = parse(episodeSchema, input);
  const [s] = await sql`select id, title_id from seasons where id = ${seasonId}`;
  if (!s) throw new ValidationError('Temporada no encontrada.');
  try {
    const [row] = await sql`insert into episodes ${sql({ season_id: seasonId, title_id: s.title_id, ...d } as never)} returning *`;
    await audit(actorId, 'episode.create', 'episode', row.id, { season: seasonId, number: d.number });
    return row;
  } catch (e) {
    if (String((e as Error).message).includes('episodes_season_id_number_key')) throw new ValidationError(`Ya existe el episodio ${d.number} en esta temporada.`, { number: 'Duplicado' });
    throw e;
  }
}

export async function updateEpisode(actorId: string, episodeId: string, input: unknown) {
  const d = parse(episodeSchema, input);
  await snapshot('episode', episodeId, actorId);
  const [row] = await sql`update episodes set ${sql(d as never)} where id = ${episodeId} returning *`;
  if (!row) throw new ValidationError('Episodio no encontrado.');
  await audit(actorId, 'episode.update', 'episode', episodeId);
  return row;
}

/** Publica, programa o retira un episodio individual (no exige la temporada completa). */
export async function setEpisodeStatus(actorId: string, episodeId: string, to: PubStatus, publishAt?: string | Date | null) {
  return sql.begin(async (tx) => {
    const [e] = await tx`select id, status, season_id from episodes where id = ${episodeId} for update`;
    if (!e) throw new ValidationError('Episodio no encontrado.');
    checkTransition(e.status, to);
    if (to === 'published' || to === 'scheduled') {
      const missing = await episodeReadiness(episodeId, tx);
      if (missing.length) throw new ValidationError(`Falta para publicar: ${missing.join(', ')}.`, { status: missing.join(', ') });
    }
    const when = parsePublishAt(to, publishAt);
    await snapshot('episode', episodeId, actorId, tx);
    await tx`update episodes set status = ${to}, publish_at = ${when},
      published_at = case when ${to} = 'published' then coalesce(published_at, now()) else published_at end
      where id = ${episodeId}`;
    if (to === 'published' || to === 'scheduled') {
      await tx`update seasons set status = 'published' where id = ${e.season_id} and status <> 'published'`;
    }
    await markOwnerVideoPublished('episode', episodeId, to === 'published', tx);
    await audit(actorId, `episode.status.${to}`, 'episode', episodeId, { from: e.status, publish_at: when }, tx);
  });
}

/** Activa los estrenos programados cuya hora ya llegó (cron). La visibilidad pública ya lo contempla. */
export async function activateScheduled() {
  const titles = await sql`update titles set status = 'published', published_at = coalesce(published_at, now())
    where status = 'scheduled' and publish_at <= now() returning id, type`;
  for (const t of titles) if (t.type !== 'series') await markOwnerVideoPublished('title', t.id, true);
  const eps = await sql`update episodes set status = 'published', published_at = coalesce(published_at, now())
    where status = 'scheduled' and publish_at <= now() returning id`;
  for (const e of eps) await markOwnerVideoPublished('episode', e.id, true);
  await sql`update release_schedules set status = 'released' where status in ('announced', 'confirmed') and is_confirmed and release_at <= now()`;
  return { titles: titles.length, episodes: eps.length };
}

// ------------------------------------------------------------------ Derechos y disponibilidad
const rightsSchema = z.object({
  rights_type: z.enum(['distribution', 'streaming', 'music', 'likeness', 'adaptation', 'other']),
  holder: z.string().trim().min(1, 'Indica el titular').max(200),
  territories: z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : v ?? []), z.array(z.string().regex(/^[A-Z]{2}$/, 'Códigos ISO de 2 letras')).max(250)),
  starts_at: optDate,
  ends_at: optDate,
  document_url: optUrl,
  verified: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
  notes: optText(2000),
});

export async function addRights(actorId: string, titleId: string, input: unknown) {
  const d = parse(rightsSchema, input);
  const [row] = await sql`insert into content_rights ${sql({ title_id: titleId, ...d } as never)} returning *`;
  await audit(actorId, 'rights.add', 'title', titleId, { type: d.rights_type, verified: d.verified });
  return row;
}

const availabilitySchema = z.object({
  allowed_countries: rightsSchema.shape.territories,
  blocked_countries: rightsSchema.shape.territories,
  starts_at: z.preprocess(empty, z.coerce.date().nullable()),
  ends_at: z.preprocess(empty, z.coerce.date().nullable()),
});

export async function setAvailability(actorId: string, contentType: 'title' | 'episode', contentId: string, input: unknown) {
  const d = parse(availabilitySchema, input);
  await sql`insert into content_availability (content_type, content_id, allowed_countries, blocked_countries, starts_at, ends_at)
    values (${contentType}, ${contentId}, ${d.allowed_countries}, ${d.blocked_countries}, ${d.starts_at}, ${d.ends_at})
    on conflict (content_type, content_id) do update set allowed_countries = excluded.allowed_countries,
      blocked_countries = excluded.blocked_countries, starts_at = excluded.starts_at, ends_at = excluded.ends_at`;
  await audit(actorId, 'availability.set', contentType, contentId, d);
}

// ------------------------------------------------------------------ Estrenos
const releaseSchema = z.object({
  title_id: z.string().uuid(),
  episode_id: z.preprocess(empty, z.string().uuid().nullable()),
  headline: optText(200),
  release_at: z.preprocess(empty, z.coerce.date().nullable()),
  date_label: optText(80),
  is_confirmed: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
  status: z.enum(['announced', 'confirmed', 'released', 'postponed', 'cancelled']).default('announced'),
  is_public: z.preprocess((v) => v === undefined ? true : v === true || v === 'on' || v === 'true', z.boolean()),
});

export async function upsertRelease(actorId: string, id: string | null, input: unknown) {
  const d = parse(releaseSchema, input);
  if (d.is_confirmed && !d.release_at) throw new ValidationError('Un estreno confirmado necesita fecha.', { release_at: 'Obligatoria si está confirmado' });
  if (!d.release_at && !d.date_label) throw new ValidationError('Indica una fecha o un texto de fecha aproximada.', { date_label: 'Ej.: «Primavera 2027»' });
  const status = d.is_confirmed && d.status === 'announced' ? 'confirmed' : d.status;
  const row = id
    ? (await sql`update release_schedules set ${sql({ ...d, status } as never)} where id = ${id} returning *`)[0]
    : (await sql`insert into release_schedules ${sql({ ...d, status } as never)} returning *`)[0];
  if (!row) throw new ValidationError('Estreno no encontrado.');
  await audit(actorId, id ? 'release.update' : 'release.create', 'release', row.id, { confirmed: d.is_confirmed });
  return row;
}
