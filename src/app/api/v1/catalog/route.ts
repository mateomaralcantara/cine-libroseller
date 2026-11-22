import type { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { json, limited } from '@/lib/http';
import { visibleTitles, searchCatalog } from '@/lib/catalog/public';
import { env } from '@/lib/env';
import { titlePath } from '@/lib/format';

/** API pública de catálogo (sólo obras publicadas). */
export async function GET(req: NextRequest) {
  const tooMany = limited(req, 'catalog', 60, 60_000);
  if (tooMany) return tooMany;
  const p = req.nextUrl.searchParams;
  const q = p.get('q');
  const type = p.get('type');
  const items = q
    ? await searchCatalog(q, { type: type ?? undefined })
    : await visibleTitles(type && ['movie', 'series', 'short', 'documentary', 'special'].includes(type) ? sql`and t.type = ${type}` : undefined, undefined, 100);
  return json({
    data: items.map((t) => ({
      id: t.id, slug: t.slug, type: t.type, title: t.title, tagline: t.tagline, synopsis: t.synopsis_short, release_date: t.release_date,
      runtime_minutes: t.runtime_minutes, genres: t.genres, url: `${env.siteUrl}${titlePath(t)}`, poster: t.images.poster?.url ?? null,
    })),
  }, 200, { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=600' });
}
