import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getEpisode } from '@/lib/catalog/public';
import { getViewer } from '@/lib/auth/session';
import { progressForTitle } from '@/lib/playback';
import { titleMetadata, parseNumberedSegment } from '@/lib/seo';
import { env } from '@/lib/env';
import { Backdrop, EpisodeList, AiDisclosure } from '@/components/catalog';
import { ShareButton, TrailerButton, PageView } from '@/components/interactive';
import { Icon } from '@/components/player/icons';
import { episodePath, formatDate, formatRuntime, formatClock, ACCESS_LABEL } from '@/lib/format';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string; season: string; episode: string }> };

async function load(p: Props['params']) {
  const { slug, season, episode } = await p;
  const s = parseNumberedSegment(season, 'temporada');
  const e = parseNumberedSegment(episode, 'episodio');
  if (!s || !e) return null;
  return getEpisode(slug, s, e);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await load(params);
  if (!d) return { title: 'Episodio no encontrado' };
  const thumb = d.episode.thumbnail?.url;
  return titleMetadata(d.series, {
    path: episodePath(d.series.slug, d.season.number, d.episode.number),
    title: `${d.episode.name} — ${d.series.title} (T${d.season.number}:E${d.episode.number})`,
    description: d.episode.synopsis, image: thumb,
  });
}

export default async function EpisodePage({ params }: Props) {
  const d = await load(params);
  if (!d) notFound();
  const { series, season, episode, previous, next, characters } = d;
  const viewer = await getViewer();
  const progress = await progressForTitle(viewer, series.id);
  const p = progress[episode.id];
  const href = episodePath(series.slug, season.number, episode.number);
  const trailers = await sql`select tr.id, tr.name, tr.kind from trailers tr join video_assets va on va.owner_type = 'trailer' and va.owner_id = tr.id and va.is_current and va.status in ('ready','published')
    where tr.episode_id = ${episode.id} and tr.is_published order by tr.position`;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'TVEpisode', name: episode.name, episodeNumber: episode.number, description: episode.synopsis ?? undefined,
    url: `${env.siteUrl}${href}`, partOfSeason: { '@type': 'TVSeason', seasonNumber: season.number },
    partOfSeries: { '@type': 'TVSeries', name: series.title, url: `${env.siteUrl}/series/${series.slug}` },
    timeRequired: episode.runtime_minutes ? `PT${episode.runtime_minutes}M` : undefined, datePublished: episode.release_date ?? undefined,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <PageView contentType="episode" contentId={episode.id} />
      <section className="grain relative isolate flex min-h-[72svh] items-end overflow-hidden">
        <Backdrop img={episode.thumbnail ?? series.images.backdrop ?? series.images.banner} priority />
        <div className="scrim-left absolute inset-0" /><div className="scrim-bottom absolute inset-0" />
        <div className="relative mx-auto w-full max-w-[1680px] px-4 pb-12 pt-32 sm:px-8 lg:px-12">
          <nav aria-label="Ruta" className="text-sm text-mist"><Link href={`/series/${series.slug}`} className="hover:text-cream">{series.title}</Link> <span className="text-dim">/</span> Temporada {season.number}</nav>
          <p className="eyebrow mt-4">Episodio {episode.number}{episode.access !== 'free' && ` · ${ACCESS_LABEL[episode.access]}`}</p>
          <h1 className="display mt-2 max-w-4xl text-5xl leading-[0.95] sm:text-7xl">{episode.name}</h1>
          <p className="mt-4 flex flex-wrap gap-x-3 text-sm text-mist">
            {episode.runtime_minutes && <span>{formatRuntime(episode.runtime_minutes)}</span>}
            {episode.release_date && <span>{formatDate(episode.release_date)}</span>}
            {series.age_rating && <span className="rounded border border-white/30 px-1.5 text-xs text-cream">{series.age_rating}</span>}
          </p>
          {episode.synopsis && <p className="mt-4 max-w-2xl text-lg text-cream/85">{episode.synopsis}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
            {episode.playable
              ? <a href={`${href}/ver`} className="btn btn-primary"><Icon name="play" size={18} /> {p && !p.completed && p.position > 10 ? `Continuar (${formatClock(p.position)})` : 'Ver episodio'}</a>
              : <span className="btn btn-ghost cursor-default">Disponible próximamente</span>}
            {trailers.map((tr) => <TrailerButton key={tr.id} trailerId={tr.id} label={tr.name} signedIn={!!viewer} />)}
            <ShareButton url={`${env.siteUrl}${href}`} title={`${series.title} — ${episode.name}`} contentType="episode" contentId={episode.id} />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1680px] gap-14 px-4 pt-6 sm:px-8 lg:px-12">
        <nav aria-label="Episodios contiguos" className="flex flex-wrap justify-between gap-3">
          {previous ? <Link className="btn btn-ghost btn-sm" href={episodePath(series.slug, previous.season_number, previous.number)}>← T{previous.season_number}:E{previous.number} · {previous.name}</Link> : <span />}
          {next && <Link className="btn btn-ghost btn-sm" href={episodePath(series.slug, next.season_number, next.number)}>T{next.season_number}:E{next.number} · {next.name} →</Link>}
        </nav>
        <AiDisclosure value={series.ai_disclosure} note={series.ai_disclosure_note} />
        {characters.length > 0 && (
          <section aria-labelledby="h-pers">
            <h2 id="h-pers" className="display mb-4 text-2xl">En este episodio</h2>
            <ul className="flex flex-wrap gap-4">
              {characters.map((c) => (
                <li key={c.slug}><Link href={`/personajes/${series.slug}/${c.slug}`} className="flex items-center gap-3 rounded-full border border-line py-1.5 pl-1.5 pr-4 hover:border-gold/60">
                  <span className="relative h-10 w-10 overflow-hidden rounded-full bg-graphite-3">{c.image_url && <Image src={c.image_url} alt="" fill sizes="40px" className="object-cover" />}</span>
                  <span className="text-sm">{c.name}</span>
                </Link></li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="h-temp">
          <h2 id="h-temp" className="display mb-5 text-3xl">{season.name || `Temporada ${season.number}`}</h2>
          <EpisodeList seriesSlug={series.slug} episodes={season.episodes} progress={progress} />
        </section>
      </div>
    </>
  );
}
