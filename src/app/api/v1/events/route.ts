import type { NextRequest } from 'next/server';
import { json, viewerOf, sameOrigin, readJson, limited, country, consentGiven } from '@/lib/http';
import { eventSchema, recordEvent } from '@/lib/analytics';
import { startHistory } from '@/lib/playback';
import { sql } from '@/lib/db';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const tooMany = limited(req, 'events', 240, 60_000);
  if (tooMany) return tooMany;
  const parsed = eventSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Evento inválido' }, 400);
  const viewer = await viewerOf(req);
  const e = parsed.data;
  const ok = await recordEvent(e, { viewerProfileId: viewer?.viewerProfileId ?? null, userAgent: req.headers.get('user-agent'), country: country(req), consent: consentGiven(req) });
  if (!ok) return json({ error: 'Contenido no encontrado' }, 404);
  // El historial de la cuenta es una función del servicio (no analítica): se registra para usuarios autenticados
  if (viewer && e.event === 'play_start' && e.contentType !== 'trailer') {
    const table = e.contentType === 'episode' ? sql`episodes` : sql`titles`;
    const [o] = await sql`select ${e.contentType === 'episode' ? sql`title_id` : sql`id as title_id`} from ${table} where id = ${e.contentId}`;
    if (o) await startHistory(viewer, e.contentType, e.contentId, o.title_id);
  }
  return json({ ok: true }, 202);
}
