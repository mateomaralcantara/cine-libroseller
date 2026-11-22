// Recepción de producciones terminadas desde CineViral.
// CineViral produce; Cine LibroSeller exhibe: la obra entra SIEMPRE como borrador y la publica una persona.
import { z } from 'zod';
import { sql } from '../db';
import { audit } from '../audit';
import { slugify } from '../format';
import { verifyMuxSignature } from '../video/mux';
import { linkVideo } from '../video/service';

export const cineviralSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.literal('production.completed'),
  data: z.object({
    production_id: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    type: z.enum(['movie', 'series', 'short', 'documentary', 'special']).default('movie'),
    synopsis: z.string().max(6000).optional(),
    tagline: z.string().max(200).optional(),
    poster_url: z.string().url().optional(),
    trailer_url: z.string().url().optional(),
    video_url: z.string().url().optional(),  // HLS/MP4 ya optimizado para streaming
    subtitles: z.array(z.object({ language: z.string().max(8), label: z.string().max(60), url: z.string().url() })).max(20).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    completion_status: z.enum(['final', 'rough_cut', 'preview']).default('final'),
    distribution: z.object({ territories: z.array(z.string().length(2)).optional(), rights_holder: z.string().max(200).optional() }).optional(),
  }),
});

/** Firma: cabecera `cineviral-signature: t=<unix>,v1=<hmac-sha256("<t>.<cuerpo>")>` (mismo esquema que Mux). */
export async function ingestCineViral(rawBody: string, signature: string | null, secret: string | undefined, fetcher: typeof fetch = fetch) {
  if (!secret) return { status: 503, result: 'integración no configurada' };
  if (!verifyMuxSignature(rawBody, signature, secret)) return { status: 401, result: 'firma inválida' };
  let parsed;
  try { parsed = cineviralSchema.safeParse(JSON.parse(rawBody)); } catch { return { status: 400, result: 'JSON inválido' }; }
  if (!parsed.success) return { status: 422, result: 'payload inválido' };
  const e = parsed.data;
  const [stored] = await sql`insert into webhook_events (provider, event_id, event_type, payload) values ('cineviral', ${e.id}, ${e.type}, ${sql.json(e as never)})
    on conflict (provider, event_id) do nothing returning id`;
  if (!stored) return { status: 200, result: 'duplicado' };

  const d = e.data;
  let [title] = await sql`select id, status from titles where external_ref = ${d.production_id}`;
  if (title && title.status === 'published') {
    // Nunca se modifica en silencio una obra publicada: queda registrado para revisión manual.
    await sql`update webhook_events set status = 'ignored', processed_at = now(), error_message = 'La obra ya está publicada; revisar manualmente' where id = ${stored.id}`;
    return { status: 200, result: 'obra publicada: revisión manual' };
  }
  if (!title) {
    let slug = slugify(d.title) || 'obra';
    for (let i = 2; (await sql`select 1 from titles where slug = ${slug}`).length; i++) slug = `${slugify(d.title)}-${i}`;
    [title] = await sql`insert into titles (slug, type, title, tagline, synopsis_long, external_ref, status)
      values (${slug}, ${d.type}, ${d.title}, ${d.tagline ?? null}, ${d.synopsis ?? null}, ${d.production_id}, 'draft') returning id, status`;
  } else {
    await sql`update titles set title = ${d.title}, tagline = coalesce(${d.tagline ?? null}, tagline), synopsis_long = coalesce(${d.synopsis ?? null}, synopsis_long) where id = ${title.id}`;
  }
  if (d.distribution?.rights_holder) {
    await sql`insert into content_rights (title_id, rights_type, holder, territories, verified, notes)
      values (${title.id}, 'distribution', ${d.distribution.rights_holder}, ${d.distribution.territories ?? []}, false, 'Declarado por CineViral; pendiente de verificación legal')`;
  }
  const notes: string[] = [];
  if (d.video_url && d.type !== 'series' && d.completion_status === 'final') {
    try { await linkVideo(null, { ownerType: 'title', ownerId: title.id, url: d.video_url }, fetcher); }
    catch (err) { notes.push(`video: ${(err as Error).message}`); }
  }
  for (const s of d.subtitles ?? []) {
    await sql`insert into subtitle_tracks (owner_type, owner_id, language, label, url) values ('title', ${title.id}, ${s.language}, ${s.label}, ${s.url})`;
  }
  if (d.poster_url) notes.push('póster recibido por URL: súbelo al almacenamiento desde el panel');
  await audit(null, 'cineviral.ingest', 'title', title.id, { production: d.production_id, notes });
  await sql`update webhook_events set status = 'processed', processed_at = now(), error_message = ${notes.join('; ') || null} where id = ${stored.id}`;
  return { status: 200, result: 'recibido como borrador', titleId: title.id as string };
}
