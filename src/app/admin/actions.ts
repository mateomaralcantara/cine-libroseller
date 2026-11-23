'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireEditor, requireAdmin } from '@/lib/auth/session';
import { sql } from '@/lib/db';
import { audit } from '@/lib/audit';
import { slugify } from '@/lib/format';
import {
  createTitle, updateTitle, setTitleStatus, createSeason, updateSeason, createEpisode, updateEpisode, setEpisodeStatus,
  addRights, setAvailability, upsertRelease, ValidationError, type PubStatus,
} from '@/lib/catalog/admin';
import { linkVideo, approveAsset, refreshFromProvider, makeAssetPublic, VideoError, type OwnerType } from '@/lib/video/service';
import { storeImage, storeSubtitle, deleteObject, UploadError } from '@/lib/media/storage';

export type ActionState = { ok?: string; error?: string; fields?: Record<string, string> } | undefined;

async function run(fn: () => Promise<string | void>, paths: string[] = []): Promise<ActionState> {
  try {
    const ok = (await fn()) || 'Guardado.';
    for (const p of ['/admin', ...paths]) revalidatePath(p, 'layout');
    return { ok };
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message, fields: e.fields };
    if (e instanceof VideoError || e instanceof UploadError) return { error: e.message };
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect()
    console.error(e);
    return { error: 'No se pudo completar la acción. Revisa los datos e inténtalo de nuevo.' };
  }
}

const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === 'string' ? v : ''; };
const ids = (f: FormData, k: string) => f.getAll(k).map(String).filter(Boolean);
const UUID = /^[0-9a-f-]{36}$/i;

function titlePayload(f: FormData) {
  const bookTitle = str(f, 'book_title').trim();
  return {
    type: str(f, 'type'), title: str(f, 'title'), slug: str(f, 'slug'), international_title: str(f, 'international_title'),
    tagline: str(f, 'tagline'), synopsis_short: str(f, 'synopsis_short'), synopsis_long: str(f, 'synopsis_long'),
    production_date: str(f, 'production_date'), release_date: str(f, 'release_date'), runtime_minutes: str(f, 'runtime_minutes'),
    country: str(f, 'country'), original_language: str(f, 'original_language'), languages: str(f, 'languages'),
    age_rating: str(f, 'age_rating'), production_company: str(f, 'production_company'), access: str(f, 'access') || 'free',
    ai_disclosure: str(f, 'ai_disclosure') || 'none', ai_disclosure_note: str(f, 'ai_disclosure_note'),
    seo_title: str(f, 'seo_title'), seo_description: str(f, 'seo_description'),
    genre_ids: ids(f, 'genre_ids'), category_ids: ids(f, 'category_ids'),
    source_book: bookTitle ? {
      title: bookTitle, author: str(f, 'book_author'), publisher: str(f, 'book_publisher'), cover_url: str(f, 'book_cover_url'),
      synopsis: str(f, 'book_synopsis'), relation: str(f, 'book_relation'), purchase_url: str(f, 'book_purchase_url'), libroseller_id: str(f, 'book_libroseller_id'),
    } : null,
  };
}

// ------------------------------------------------------------------ Títulos
export async function createTitleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  let id = '';
  const r = await run(async () => { id = (await createTitle(v.id, { type: str(f, 'type'), title: str(f, 'title') })).id; });
  if (r?.error) return r;
  redirect(`/admin/titulos/${id}`);
}

export async function updateTitleAction(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => { await updateTitle(v.id, id, titlePayload(f)); return 'Ficha guardada.'; }, [`/admin/titulos/${id}`]);
}

export async function titleStatusAction(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  const to = str(f, 'to') as PubStatus;
  return run(async () => { await setTitleStatus(v.id, id, to, str(f, 'publish_at') || null); return 'Estado actualizado.'; }, ['/']);
}

export async function updateLinksAction(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const links = str(f, 'links').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20).map((l) => {
      const [label, url] = l.split('|').map((s) => s.trim());
      if (!url || !/^https?:\/\//.test(url)) throw new ValidationError(`Enlace inválido: «${l}». Usa «Texto | https://…»`);
      return { label: label.slice(0, 80), url: url.slice(0, 500) };
    });
    await sql`update titles set related_links = ${sql.json(links)} where id = ${id}`;
    await audit(v.id, 'title.links', 'title', id);
  });
}

// ------------------------------------------------------------------ Temporadas y episodios
export async function createSeasonAction(titleId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => { await createSeason(v.id, titleId, { number: str(f, 'number'), name: str(f, 'name'), synopsis: str(f, 'synopsis') }); return 'Temporada creada.'; });
}

export async function updateSeasonAction(seasonId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => { await updateSeason(v.id, seasonId, { number: str(f, 'number'), name: str(f, 'name'), synopsis: str(f, 'synopsis'), release_date: str(f, 'release_date') }); });
}

export async function createEpisodeAction(seasonId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  let id = '';
  const r = await run(async () => { id = (await createEpisode(v.id, seasonId, { number: str(f, 'number'), name: str(f, 'name'), runtime_minutes: str(f, 'runtime_minutes') })).id; });
  if (r?.error) return r;
  redirect(`/admin/episodios/${id}`);
}

export async function updateEpisodeAction(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    await updateEpisode(v.id, id, { number: str(f, 'number'), name: str(f, 'name'), synopsis: str(f, 'synopsis'), runtime_minutes: str(f, 'runtime_minutes'), release_date: str(f, 'release_date'), access: str(f, 'access') || 'free' });
    return 'Episodio guardado.';
  });
}

export async function episodeStatusAction(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => { await setEpisodeStatus(v.id, id, str(f, 'to') as PubStatus, str(f, 'publish_at') || null); return 'Estado actualizado.'; }, ['/']);
}

// ------------------------------------------------------------------ Imágenes y subtítulos
const OWNER_TYPES = ['title', 'season', 'episode', 'person', 'character', 'release'];
const IMAGE_KINDS = ['poster', 'backdrop', 'banner', 'logo', 'thumbnail', 'still', 'gallery', 'behind_scenes', 'social'];
const SINGLE_KINDS = ['poster', 'backdrop', 'banner', 'logo', 'thumbnail', 'social'];

export async function uploadImageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const ownerType = str(f, 'owner_type'); const ownerId = str(f, 'owner_id'); const kind = str(f, 'kind');
    if (!OWNER_TYPES.includes(ownerType) || !UUID.test(ownerId) || !IMAGE_KINDS.includes(kind)) throw new ValidationError('Datos de imagen inválidos.');
    const file = f.get('file');
    if (!(file instanceof File)) throw new UploadError('Selecciona una imagen.');
    const alt = str(f, 'alt_text').trim().slice(0, 300);
    if (!alt) throw new ValidationError('Describe la imagen (texto alternativo) para accesibilidad.', { alt_text: 'Obligatorio' });
    const saved = await storeImage(`images/${ownerType}`, file);
    if (SINGLE_KINDS.includes(kind)) {
      const old = await sql`delete from media_images where owner_type = ${ownerType} and owner_id = ${ownerId} and kind = ${kind} returning storage_path`;
      for (const o of old) await deleteObject(o.storage_path);
    }
    await sql`insert into media_images (owner_type, owner_id, kind, url, storage_path, width, height, alt_text)
      values (${ownerType}, ${ownerId}, ${kind}, ${saved.url}, ${saved.path}, ${saved.width}, ${saved.height}, ${alt})`;
    if (ownerType === 'person') await sql`update people set photo_url = ${saved.url} where id = ${ownerId}`;
    if (ownerType === 'character' && kind === 'poster') await sql`update characters set image_url = ${saved.url} where id = ${ownerId}`;
    await audit(v.id, 'image.upload', ownerType, ownerId, { kind, size: [saved.width, saved.height] });
    return 'Imagen subida.';
  });
}

export async function deleteImageAction(imageId: string) {
  const v = await requireEditor();
  const [img] = await sql`delete from media_images where id = ${imageId} returning *`;
  if (img) { await deleteObject(img.storage_path); await audit(v.id, 'image.delete', img.owner_type, img.owner_id, { kind: img.kind }); }
  revalidatePath('/admin', 'layout');
}

export async function uploadSubtitleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const ownerType = str(f, 'owner_type'); const ownerId = str(f, 'owner_id');
    if (!['episode', 'title', 'trailer'].includes(ownerType) || !UUID.test(ownerId)) throw new ValidationError('Destino inválido.');
    const language = str(f, 'language').trim().toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z]{2})?$/i.test(language)) throw new ValidationError('Código de idioma inválido (ej.: es, en, pt-BR).', { language: 'Inválido' });
    const file = f.get('file');
    if (!(file instanceof File)) throw new UploadError('Selecciona un archivo .vtt o .srt.');
    const saved = await storeSubtitle('subtitles', file);
    // Un solo archivo por idioma: si ya había uno, el nuevo lo sustituye (si no, se verían dos veces)
    const previous = await sql`delete from subtitle_tracks where owner_type = ${ownerType} and owner_id = ${ownerId} and lower(language) = ${language} returning storage_path`;
    for (const p of previous) await deleteObject(p.storage_path);
    const isDefault = f.get('is_default') === 'on';
    if (isDefault) await sql`update subtitle_tracks set is_default = false where owner_type = ${ownerType} and owner_id = ${ownerId}`;
    await sql`insert into subtitle_tracks (owner_type, owner_id, language, label, kind, url, storage_path, is_default)
      values (${ownerType}, ${ownerId}, ${language}, ${str(f, 'label').trim().slice(0, 60) || language}, ${str(f, 'kind') === 'captions' ? 'captions' : 'subtitles'}, ${saved.url}, ${saved.path}, ${isDefault})`;
    await audit(v.id, 'subtitle.upload', ownerType, ownerId, { language });
    return previous.length ? 'Subtítulos reemplazados (ya había un archivo en ese idioma).' : 'Subtítulos añadidos.';
  });
}

export async function deleteSubtitleAction(id: string) {
  const v = await requireEditor();
  const [s] = await sql`delete from subtitle_tracks where id = ${id} returning *`;
  if (s) { await deleteObject(s.storage_path); await audit(v.id, 'subtitle.delete', s.owner_type, s.owner_id); }
  revalidatePath('/admin', 'layout');
}

// ------------------------------------------------------------------ Video
export async function linkVideoAction(ownerType: OwnerType, ownerId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => { await linkVideo(v.id, { ownerType, ownerId, url: str(f, 'url') }); return 'Video verificado. Revísalo en la previsualización y apruébalo.'; });
}

export async function approveVideoAction(assetId: string) {
  const v = await requireEditor();
  const r = await run(async () => { await approveAsset(v.id, assetId); return 'Video aprobado.'; });
  if (r?.error) throw new Error(r.error);
}

export async function makePublicVideoAction(assetId: string) {
  const v = await requireEditor();
  const r = await run(async () => { await makeAssetPublic(v.id, assetId); return 'El video ahora es de reproducción pública.'; });
  if (r?.error) throw new Error(r.error);
}

export async function refreshVideoAction(assetId: string) {
  const v = await requireEditor();
  await run(async () => { await refreshFromProvider(v.id, assetId); });
}

export async function originForUploads() {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  return `${proto}://${h.get('x-forwarded-host') || h.get('host')}`;
}

// ------------------------------------------------------------------ Extras (tráilers, entrevistas, making of)
export async function saveTrailerAction(titleId: string, trailerId: string | null, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  let newId = '';
  const r = await run(async () => {
    const name = str(f, 'name').trim().slice(0, 200);
    if (!name) throw new ValidationError('El nombre es obligatorio.', { name: 'Obligatorio' });
    const kind = str(f, 'kind') || 'trailer';
    const episodeId = UUID.test(str(f, 'episode_id')) ? str(f, 'episode_id') : null;
    const isPrimary = f.get('is_primary') === 'on';
    const isPublished = f.get('is_published') === 'on';
    if (isPublished && trailerId) {
      const [ok] = await sql`select 1 from video_assets where owner_type = 'trailer' and owner_id = ${trailerId} and is_current and status in ('ready','published')`;
      if (!ok) throw new ValidationError('Publica el extra cuando su video esté aprobado.');
    }
    if (isPrimary) await sql`update trailers set is_primary = false where title_id = ${titleId}`;
    if (trailerId) {
      await sql`update trailers set name = ${name}, kind = ${kind}, episode_id = ${episodeId}, is_primary = ${isPrimary}, is_published = ${isPublished && !!trailerId},
        description = ${str(f, 'description') || null}, position = ${Number(str(f, 'position')) || 0} where id = ${trailerId}`;
      await sql`update video_assets set status = ${isPublished ? 'published' : 'ready'} where owner_type = 'trailer' and owner_id = ${trailerId} and is_current and status in ('ready','published')`;
    } else {
      [{ id: newId }] = await sql`insert into trailers (title_id, episode_id, name, kind, description, is_primary) values (${titleId}, ${episodeId}, ${name}, ${kind}, ${str(f, 'description') || null}, ${isPrimary}) returning id`;
    }
    await audit(v.id, trailerId ? 'trailer.update' : 'trailer.create', 'trailer', trailerId || newId, { kind, published: isPublished });
  });
  if (r?.error || trailerId) return r;
  redirect(`/admin/extras/${newId}`);
}

// ------------------------------------------------------------------ Personas, créditos y personajes
export async function savePersonAction(personId: string | null, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const name = str(f, 'name').trim().slice(0, 160);
    if (!name) throw new ValidationError('El nombre es obligatorio.');
    if (personId) await sql`update people set name = ${name}, bio = ${str(f, 'bio') || null} where id = ${personId}`;
    else {
      let slug = slugify(name) || 'persona';
      for (let i = 2; (await sql`select 1 from people where slug = ${slug}`).length; i++) slug = `${slugify(name)}-${i}`;
      await sql`insert into people (slug, name, bio) values (${slug}, ${name}, ${str(f, 'bio') || null})`;
    }
    await audit(v.id, personId ? 'person.update' : 'person.create', 'person', personId, { name });
  });
}

export async function addCreditAction(titleId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const personId = str(f, 'person_id');
    if (!UUID.test(personId)) throw new ValidationError('Elige una persona (créala antes en «Personas» si no existe).');
    const role = str(f, 'role');
    const characterId = UUID.test(str(f, 'character_id')) ? str(f, 'character_id') : null;
    await sql`insert into title_credits (title_id, person_id, role, character_id, credit_note, position)
      values (${titleId}, ${personId}, ${role}, ${characterId}, ${str(f, 'credit_note') || null}, ${Number(str(f, 'position')) || 0})`;
    await audit(v.id, 'credit.add', 'title', titleId, { role });
  });
}

export async function removeCreditAction(creditId: string) {
  const v = await requireEditor();
  const [c] = await sql`delete from title_credits where id = ${creditId} returning title_id`;
  if (c) await audit(v.id, 'credit.remove', 'title', c.title_id);
  revalidatePath('/admin', 'layout');
}

export async function saveCharacterAction(titleId: string, characterId: string | null, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const name = str(f, 'name').trim().slice(0, 160);
    if (!name) throw new ValidationError('El nombre es obligatorio.', { name: 'Obligatorio' });
    const rels = str(f, 'relationships').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30).map((l) => {
      const [n, rel] = l.split('|').map((s) => s.trim());
      return { name: n.slice(0, 80), relation: (rel || '').slice(0, 200) };
    });
    const data = {
      name, summary: str(f, 'summary') || null, story: str(f, 'story') || null,
      actor_id: UUID.test(str(f, 'actor_id')) ? str(f, 'actor_id') : null, digital_identity: str(f, 'digital_identity') || null,
      first_episode_id: UUID.test(str(f, 'first_episode_id')) ? str(f, 'first_episode_id') : null,
      is_published: f.get('is_published') === 'on', position: Number(str(f, 'position')) || 0, relationships: sql.json(rels),
    };
    let id = characterId;
    if (characterId) await sql`update characters set ${sql(data as never)} where id = ${characterId} and title_id = ${titleId}`;
    else {
      let slug = slugify(name) || 'personaje';
      for (let i = 2; (await sql`select 1 from characters where title_id = ${titleId} and slug = ${slug}`).length; i++) slug = `${slugify(name)}-${i}`;
      [{ id }] = await sql`insert into characters ${sql({ ...data, title_id: titleId, slug } as never)} returning id`;
    }
    await sql`delete from character_appearances where character_id = ${id}`;
    for (const ep of ids(f, 'appearances')) if (UUID.test(ep)) await sql`insert into character_appearances (character_id, episode_id) values (${id}, ${ep}) on conflict do nothing`;
    await audit(v.id, characterId ? 'character.update' : 'character.create', 'character', id, { name });
    return 'Personaje guardado.';
  });
}

// ------------------------------------------------------------------ Derechos, disponibilidad y estrenos
export async function addRightsAction(titleId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    await addRights(v.id, titleId, Object.fromEntries(['rights_type', 'holder', 'territories', 'starts_at', 'ends_at', 'document_url', 'verified', 'notes'].map((k) => [k, str(f, k)])));
    return 'Derechos registrados.';
  });
}

export async function deleteRightsAction(id: string) {
  const v = await requireEditor();
  const [r] = await sql`delete from content_rights where id = ${id} returning title_id`;
  if (r) await audit(v.id, 'rights.delete', 'title', r.title_id);
  revalidatePath('/admin', 'layout');
}

export async function availabilityAction(contentType: 'title' | 'episode', contentId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    await setAvailability(v.id, contentType, contentId, { allowed_countries: str(f, 'allowed_countries'), blocked_countries: str(f, 'blocked_countries'), starts_at: str(f, 'starts_at'), ends_at: str(f, 'ends_at') });
    return 'Disponibilidad guardada.';
  });
}

export async function saveReleaseAction(releaseId: string | null, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    await upsertRelease(v.id, releaseId, {
      title_id: str(f, 'title_id'), episode_id: str(f, 'episode_id'), headline: str(f, 'headline'), release_at: str(f, 'release_at'),
      date_label: str(f, 'date_label'), is_confirmed: str(f, 'is_confirmed'), status: str(f, 'status') || 'announced', is_public: f.get('is_public') === 'on',
    });
    return 'Estreno guardado.';
  }, ['/estrenos']);
}

// ------------------------------------------------------------------ Portada
export async function saveSectionAction(sectionId: string | null, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const kind = str(f, 'kind');
    const heading = str(f, 'heading').trim().slice(0, 120);
    if (!heading) throw new ValidationError('El título de la sección es obligatorio.');
    const config: Record<string, unknown> = {};
    for (const k of ['title_id', 'type', 'genre', 'category', 'collection']) if (str(f, k)) config[k] = str(f, k);
    if (str(f, 'limit')) config.limit = Math.min(48, Math.max(1, Number(str(f, 'limit')) || 18));
    const data = {
      kind, heading, subheading: str(f, 'subheading') || null, config: sql.json(config as never), is_visible: f.get('is_visible') === 'on',
      starts_at: str(f, 'starts_at') ? new Date(str(f, 'starts_at')) : null, ends_at: str(f, 'ends_at') ? new Date(str(f, 'ends_at')) : null,
    };
    if (sectionId) await sql`update homepage_sections set ${sql(data as never)} where id = ${sectionId}`;
    else {
      const [{ p }] = await sql`select coalesce(max(position), 0) + 1 as p from homepage_sections`;
      sectionId = (await sql`insert into homepage_sections ${sql({ ...data, position: p } as never)} returning id`)[0].id;
    }
    if (kind === 'manual') {
      await sql`delete from homepage_section_items where section_id = ${sectionId}`;
      for (const [i, t] of ids(f, 'items').entries()) if (UUID.test(t)) await sql`insert into homepage_section_items (section_id, title_id, position) values (${sectionId}, ${t}, ${i})`;
    }
    await audit(v.id, 'homepage.section', 'homepage_section', sectionId, { kind });
    return 'Sección guardada.';
  }, ['/']);
}

export async function moveSectionAction(sectionId: string, dir: -1 | 1) {
  const v = await requireEditor();
  const rows = await sql`select id from homepage_sections order by position, created_at`;
  const i = rows.findIndex((r) => r.id === sectionId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await sql.begin(async (tx) => { for (const [k, r] of rows.entries()) await tx`update homepage_sections set position = ${k} where id = ${r.id}`; });
  await audit(v.id, 'homepage.reorder', 'homepage_section', sectionId);
  revalidatePath('/', 'layout');
}

export async function deleteSectionAction(sectionId: string) {
  const v = await requireEditor();
  await sql`delete from homepage_sections where id = ${sectionId}`;
  await audit(v.id, 'homepage.delete', 'homepage_section', sectionId);
  revalidatePath('/', 'layout');
}

export async function saveFeaturedAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const titleId = str(f, 'title_id');
    if (!UUID.test(titleId)) throw new ValidationError('Elige un título.');
    await sql`insert into featured_content (title_id, headline, starts_at, ends_at, position, is_active)
      values (${titleId}, ${str(f, 'headline') || null}, ${str(f, 'starts_at') ? new Date(str(f, 'starts_at')) : null}, ${str(f, 'ends_at') ? new Date(str(f, 'ends_at')) : null}, ${Number(str(f, 'position')) || 0}, true)`;
    await audit(v.id, 'homepage.featured', 'title', titleId);
    return 'Destacado añadido.';
  }, ['/']);
}

export async function toggleFeaturedAction(id: string, active: boolean) {
  const v = await requireEditor();
  await sql`update featured_content set is_active = ${active} where id = ${id}`;
  await audit(v.id, 'homepage.featured_toggle', 'featured', id, { active });
  revalidatePath('/', 'layout');
}

// ------------------------------------------------------------------ Comparaciones antes/después
export async function saveComparisonAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const label = str(f, 'label').trim().slice(0, 200);
    if (!label) throw new ValidationError('Describe la comparación.');
    const before = f.get('before'); const after = f.get('after');
    if (!(before instanceof File) || !(after instanceof File) || !before.size || !after.size) throw new UploadError('Sube ambas imágenes (antes y después).');
    const b = await storeImage('images/comparisons', before);
    const a = await storeImage('images/comparisons', after);
    await sql`insert into media_comparisons (title_id, label, description, category, before_url, after_url, rights_note)
      values (${UUID.test(str(f, 'title_id')) ? str(f, 'title_id') : null}, ${label}, ${str(f, 'description') || null}, ${str(f, 'category') || 'vfx'}, ${b.url}, ${a.url}, ${str(f, 'rights_note') || null})`;
    await audit(v.id, 'comparison.create', 'comparison', null, { label });
    return 'Comparación guardada como no pública. Apruébala cuando tengas la autorización.';
  });
}

export async function approveComparisonAction(id: string, approved: boolean) {
  const v = await requireAdmin();
  const [c] = await sql`select rights_note from media_comparisons where id = ${id}`;
  if (approved && !c?.rights_note) throw new Error('Registra antes la autorización (nota de derechos).');
  await sql`update media_comparisons set approved_for_public = ${approved}, approved_by = ${approved ? v.id : null}, approved_at = ${approved ? new Date() : null} where id = ${id}`;
  await audit(v.id, approved ? 'comparison.approve' : 'comparison.unapprove', 'comparison', id);
  revalidatePath('/', 'layout');
}

// ------------------------------------------------------------------ Usuarios
export async function setUserRoleAction(profileId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireAdmin();
  return run(async () => {
    const role = str(f, 'role'); const status = str(f, 'status');
    if (!['viewer', 'editor', 'admin'].includes(role) || !['active', 'blocked'].includes(status)) throw new ValidationError('Valores inválidos.');
    if (profileId === v.id && (role !== 'admin' || status !== 'active')) throw new ValidationError('No puedes quitarte el rol de administración ni bloquear tu cuenta.');
    await sql`update profiles set role = ${role}, status = ${status} where id = ${profileId}`;
    if (status === 'blocked') await sql`update user_sessions set revoked_at = now() where profile_id = ${profileId} and revoked_at is null`;
    await audit(v.id, 'user.update', 'profile', profileId, { role, status });
    return 'Usuario actualizado.';
  });
}

// ------------------------------------------------------------------ Asistente «Subir episodio»
/** Guarda sólo los textos de presentación de un título, sin tocar el resto de la ficha. */
export async function saveSynopsisAction(titleId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const v = await requireEditor();
  return run(async () => {
    const short = str(f, 'synopsis_short').trim();
    if (!short) throw new ValidationError('La sinopsis corta es obligatoria para publicar.', { synopsis_short: 'Obligatoria' });
    if (short.length > 400) throw new ValidationError('La sinopsis corta admite hasta 400 caracteres.', { synopsis_short: 'Demasiado larga' });
    await sql`update titles set synopsis_short = ${short}, synopsis_long = ${str(f, 'synopsis_long').trim().slice(0, 6000) || null},
      tagline = ${str(f, 'tagline').trim().slice(0, 200) || null}, age_rating = ${str(f, 'age_rating').trim().slice(0, 20) || null} where id = ${titleId}`;
    await audit(v.id, 'title.synopsis', 'title', titleId);
    return 'Textos guardados.';
  }, ['/']);
}
