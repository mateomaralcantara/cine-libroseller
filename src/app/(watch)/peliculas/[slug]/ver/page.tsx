import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer, requestMeta } from '@/lib/auth/session';
import { resolvePlayback } from '@/lib/playback';
import { WatchScreen } from '@/components/WatchScreen';
import { sql } from '@/lib/db';
import { getTitleBySlug } from '@/lib/catalog/public';
import { titleMetadata } from '@/lib/seo';
import { canEdit } from '@/lib/auth/core';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

/** El reproductor no se indexa, pero al compartir su enlace también se ve la portada de la película. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTitleBySlug(slug, 'film');
  return t ? titleMetadata(t, { path: `/peliculas/${slug}/ver`, title: `Ver «${t.title}»`, index: false }) : { robots: { index: false } };
}

export default async function WatchFilm({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const [t] = await sql`select id from titles where slug = ${slug} and type <> 'series'`;
  if (!t) notFound();
  const viewer = await getViewer();
  const { country } = await requestMeta();
  const result = await resolvePlayback({ contentType: 'title', contentId: t.id, viewer, country, preview: sp.preview === '1' && canEdit(viewer) });
  return <WatchScreen result={result} signedIn={!!viewer} loginNext={`/peliculas/${slug}/ver`} />;
}
