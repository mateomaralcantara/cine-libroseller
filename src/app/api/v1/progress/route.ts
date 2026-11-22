import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, viewerOf, sameOrigin, readJson, limited } from '@/lib/http';
import { saveProgress, markWatched } from '@/lib/playback';

const schema = z.object({
  contentType: z.enum(['episode', 'title']),
  contentId: z.string().uuid(),
  position: z.number().min(0).max(86_400).optional(),
  duration: z.number().min(0).max(86_400).nullable().optional(),
  watched: z.boolean().optional(),
});

/** Guarda la posición de reproducción (también vía navigator.sendBeacon al salir). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const tooMany = limited(req, 'progress', 60, 60_000);
  if (tooMany) return tooMany;
  const viewer = await viewerOf(req);
  if (!viewer) return json({ error: 'Inicia sesión para guardar tu progreso' }, 401);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Datos inválidos' }, 400);
  const d = parsed.data;
  if (d.watched !== undefined) {
    await markWatched(viewer, d.contentType, d.contentId, d.watched);
    return json({ ok: true });
  }
  const row = await saveProgress(viewer, { contentType: d.contentType, contentId: d.contentId, position: d.position ?? 0, duration: d.duration ?? null });
  if (!row) return json({ error: 'Contenido no encontrado o posición inválida' }, 404);
  return json({ ok: true, position: row.position_seconds, completed: row.completed });
}
