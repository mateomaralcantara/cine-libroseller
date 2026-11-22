import type { NextRequest } from 'next/server';
import { json, viewerOf, country, limited } from '@/lib/http';
import { resolvePlayback, type ContentType } from '@/lib/playback';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const tooMany = limited(req, 'playback', 120, 60_000);
  if (tooMany) return tooMany;
  const { type, id } = await params;
  if (!['episode', 'title', 'trailer'].includes(type)) return json({ message: 'Tipo no válido' }, 400);
  const viewer = await viewerOf(req);
  const result = await resolvePlayback({ contentType: type as ContentType, contentId: id, viewer, country: country(req), preview: req.nextUrl.searchParams.get('preview') === '1' });
  if (!result.ok) return json(result, result.status);
  const { titleId: _t, ...source } = result; // eslint-disable-line @typescript-eslint/no-unused-vars
  return json(source);
}
