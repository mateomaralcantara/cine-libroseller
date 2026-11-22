import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getViewer, requestMeta } from '@/lib/auth/session';
import { resolvePlayback } from '@/lib/playback';
import { WatchScreen } from '@/components/WatchScreen';
import { sql } from '@/lib/db';
import { canEdit } from '@/lib/auth/core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

export default async function WatchFilm({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const [t] = await sql`select id from titles where slug = ${slug} and type <> 'series'`;
  if (!t) notFound();
  const viewer = await getViewer();
  const { country } = await requestMeta();
  const result = await resolvePlayback({ contentType: 'title', contentId: t.id, viewer, country, preview: sp.preview === '1' && canEdit(viewer) });
  return <WatchScreen result={result} signedIn={!!viewer} loginNext={`/peliculas/${slug}/ver`} />;
}
