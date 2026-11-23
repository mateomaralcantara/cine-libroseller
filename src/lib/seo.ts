import type { Metadata } from 'next';
import type { TitleDetail } from './catalog/public';
import { titlePath } from './format';
import { env } from './env';

/** Recorta un texto sin partir palabras y con puntos suspensivos. */
export function clip(text: string | null | undefined, max: number): string | undefined {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:—-]+$/, '') + '…';
}

type Pic = { url: string } | null | undefined;

/** Imagen de marca (src/app/opengraph-image.tsx) para páginas sin portada propia. */
export const DEFAULT_SHARE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: 'CINE LIBROSELLER — El futuro del cine comienza aquí', type: 'image/png' };

/**
 * Convierte una portada en la imagen para compartir: siempre JPEG 1200×630 ligero (ruta /og),
 * que WhatsApp, Facebook, Instagram, X, Telegram y LinkedIn muestran en grande.
 */
export function shareImage(pic: Pic, alt: string) {
  if (!pic?.url) return DEFAULT_SHARE_IMAGE;
  return { url: `/og?src=${encodeURIComponent(pic.url)}`, width: 1200, height: 630, alt, type: 'image/jpeg' };
}

/** Portada preferida de una obra: imagen social > fondo > banner > póster. */
export function titleCover(t: Pick<TitleDetail, 'images'>): Pic {
  return t.images.social ?? t.images.backdrop ?? t.images.banner ?? t.images.poster ?? t.images.thumbnail ?? t.images.still;
}

/** Metadatos de una página cualquiera con su vista previa para redes. */
export function pageMetadata(o: { title: string; description?: string | null; path: string; image?: Pic; imageAlt?: string; type?: 'website' | 'video.tv_show' | 'video.movie' | 'video.episode' | 'profile'; index?: boolean }): Metadata {
  const description = clip(o.description, 170);
  const url = `${env.siteUrl}${o.path}`;
  const img = shareImage(o.image, o.imageAlt ?? o.title);
  // En redes se añade la marca al título (en la pestaña ya lo hace la plantilla del layout)
  const social = /CINE LIBROSELLER/i.test(o.title) ? o.title : `${o.title} · CINE LIBROSELLER`;
  return {
    title: o.title,
    description,
    alternates: { canonical: url },
    ...(o.index === false ? { robots: { index: false } } : {}),
    openGraph: { title: social, description, url, type: o.type ?? 'website', siteName: 'CINE LIBROSELLER', locale: 'es_DO', images: [img] },
    twitter: { card: 'summary_large_image', title: social, description, images: [{ url: img.url, alt: img.alt }] },
  };
}

export function titleMetadata(t: TitleDetail, extra: { path?: string; title?: string; description?: string | null; image?: Pic; type?: 'video.episode'; index?: boolean } = {}): Metadata {
  return pageMetadata({
    title: extra.title ?? t.seo_title ?? t.title,
    description: extra.description ?? t.seo_description ?? t.synopsis_short ?? t.synopsis_long,
    path: extra.path ?? titlePath(t),
    image: extra.image ?? titleCover(t),
    imageAlt: t.title,
    type: extra.type ?? (t.type === 'series' ? 'video.tv_show' : 'video.movie'),
    index: extra.index,
  });
}

export function parseNumberedSegment(segment: string, prefix: 'temporada' | 'episodio'): number | null {
  const m = segment.match(new RegExp(`^${prefix}-(\\d{1,4})$`));
  return m ? Number(m[1]) : null;
}
