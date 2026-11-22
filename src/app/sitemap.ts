import type { MetadataRoute } from 'next';
import { sql } from '@/lib/db';
import { VISIBLE } from '@/lib/catalog/public';
import { env } from '@/lib/env';
import { titlePath, episodePath } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.siteUrl;
  const titles = await sql`select slug, type, updated_at from titles t where ${VISIBLE('t')}`;
  const episodes = await sql`select t.slug, s.number as season, e.number, e.updated_at from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id
    where ${VISIBLE('e')} and ${VISIBLE('t')}`;
  const characters = await sql`select t.slug as title_slug, c.slug from characters c join titles t on t.id = c.title_id where c.is_published and ${VISIBLE('t')}`;
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...['/series', '/peliculas', '/estrenos', '/detras-de-camaras'].map((p) => ({ url: `${base}${p}`, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...titles.map((t) => ({ url: `${base}${titlePath(t as never)}`, lastModified: t.updated_at, priority: 0.9 })),
    ...episodes.map((e) => ({ url: `${base}${episodePath(e.slug, e.season, e.number)}`, lastModified: e.updated_at, priority: 0.8 })),
    ...characters.map((c) => ({ url: `${base}/personajes/${c.title_slug}/${c.slug}`, priority: 0.5 })),
  ];
}
