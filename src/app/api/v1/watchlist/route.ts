import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, viewerOf, sameOrigin, readJson, limited } from '@/lib/http';
import { setInWatchlist } from '@/lib/playback';
import { watchlistTitles } from '@/lib/catalog/public';

export async function GET(req: NextRequest) {
  const viewer = await viewerOf(req);
  if (!viewer) return json({ error: 'Inicia sesión' }, 401);
  return json({ items: await watchlistTitles(viewer.viewerProfileId) });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const tooMany = limited(req, 'watchlist', 60, 60_000);
  if (tooMany) return tooMany;
  const viewer = await viewerOf(req);
  if (!viewer) return json({ error: 'Inicia sesión para usar tu lista' }, 401);
  const parsed = z.object({ titleId: z.string().uuid(), inList: z.boolean() }).safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Datos inválidos' }, 400);
  const ok = await setInWatchlist(viewer, parsed.data.titleId, parsed.data.inList);
  return ok ? json({ ok: true, inList: parsed.data.inList }) : json({ error: 'Título no disponible' }, 404);
}
