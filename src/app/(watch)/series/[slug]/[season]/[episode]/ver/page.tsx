import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getEpisode } from '@/lib/catalog/public';
import { getViewer, requestMeta } from '@/lib/auth/session';
import { resolvePlayback } from '@/lib/playback';
import { parseNumberedSegment } from '@/lib/seo';
import { WatchScreen } from '@/components/WatchScreen';
import { episodePath } from '@/lib/format';
import { sql } from '@/lib/db';
import { canEdit } from '@/lib/auth/core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false } };
type Props = { params: Promise<{ slug: string; season: string; episode: string }>; searchParams: Promise<{ preview?: string; id?: string }> };

export default async function WatchEpisode({ params, searchParams }: Props) {
  const [{ slug, season, episode }, sp] = await Promise.all([params, searchParams]);
  const s = parseNumberedSegment(season, 'temporada');
  const e = parseNumberedSegment(episode, 'episodio');
  if (!s || !e) notFound();
  const viewer = await getViewer();
  const preview = sp.preview === '1' && canEdit(viewer);
  let episodeId: string | undefined;
  if (preview) {
    // Previsualización privada (administración): el episodio aún puede estar en borrador
    const [row] = await sql`select e.id from episodes e join seasons se on se.id = e.season_id join titles t on t.id = e.title_id
      where t.slug = ${slug} and se.number = ${s} and e.number = ${e}`;
    episodeId = row?.id;
  } else {
    episodeId = (await getEpisode(slug, s, e))?.episode.id;
  }
  if (!episodeId) notFound();
  const { country } = await requestMeta();
  const result = await resolvePlayback({ contentType: 'episode', contentId: episodeId, viewer, country, preview });
  return <WatchScreen result={result} signedIn={!!viewer} loginNext={`${episodePath(slug, s, e)}/ver`} />;
}
