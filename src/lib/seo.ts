import type { Metadata } from 'next';
import type { TitleDetail } from './catalog/public';
import { titlePath } from './format';
import { env } from './env';

export function titleMetadata(t: TitleDetail, extra: { path?: string; title?: string; description?: string | null; image?: string | null } = {}): Metadata {
  const path = extra.path ?? titlePath(t);
  const description = (extra.description ?? t.seo_description ?? t.synopsis_short ?? t.synopsis_long ?? '').slice(0, 170) || undefined;
  const image = extra.image ?? t.images.social?.url ?? t.images.backdrop?.url ?? t.images.banner?.url ?? t.images.poster?.url;
  const title = extra.title ?? t.seo_title ?? t.title;
  return {
    title,
    description,
    alternates: { canonical: `${env.siteUrl}${path}` },
    openGraph: {
      title, description, url: `${env.siteUrl}${path}`, type: t.type === 'series' ? 'video.tv_show' : 'video.movie',
      images: image ? [{ url: image, width: 1200, height: 630, alt: t.title }] : undefined,
    },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : undefined },
  };
}

export function parseNumberedSegment(segment: string, prefix: 'temporada' | 'episodio'): number | null {
  const m = segment.match(new RegExp(`^${prefix}-(\\d{1,4})$`));
  return m ? Number(m[1]) : null;
}
