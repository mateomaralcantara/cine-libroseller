import Link from 'next/link';
import Image from 'next/image';
import type { Viewer } from '@/lib/auth/core';
import type { TitleDetail } from '@/lib/catalog/public';
import { relatedTitles, approvedComparisons } from '@/lib/catalog/public';
import { isInWatchlist, progressForTitle } from '@/lib/playback';
import { env } from '@/lib/env';
import { Backdrop, MetaLine, EpisodeList, PosterCard, SectionHeading, AiDisclosure, BookPanel } from './catalog';
import { TrailerButton, WatchlistButton, ShareButton, Rail, PageView, NotifyForm, BeforeAfter, TeaserBackground } from './interactive';
import { Icon } from './player/icons';
import { CREDIT_ROLE_LABEL, TRAILER_KIND_LABEL, episodePath, formatDate, formatClock, titlePath, ACCESS_LABEL } from '@/lib/format';

export async function TitlePage({ t, viewer, seasonParam }: { t: TitleDetail; viewer: Viewer | null; seasonParam?: string }) {
  const [inList, progress, related, comparisons] = await Promise.all([
    isInWatchlist(viewer, t.id), progressForTitle(viewer, t.id), relatedTitles(t.id), approvedComparisons(t.id),
  ]);
  const path = titlePath(t);
  const url = `${env.siteUrl}${path}`;
  const trailer = t.extras.find((x) => x.is_primary && ['trailer', 'teaser'].includes(x.kind)) ?? t.extras.find((x) => ['trailer', 'teaser'].includes(x.kind));
  const extras = t.extras.filter((x) => x.id !== trailer?.id);
  const allEps = t.seasons.flatMap((s) => s.episodes);
  // «Continuar»: el último episodio empezado y sin terminar; si no, el primero disponible
  const started = allEps.find((e) => progress[e.id] && !progress[e.id].completed && progress[e.id].position > 10);
  const nextUnwatched = allEps.find((e) => e.playable && !progress[e.id]?.completed);
  const target = started ?? nextUnwatched ?? allEps.find((e) => e.playable);
  const season = t.seasons.find((s) => `temporada-${s.number}` === seasonParam) ?? t.seasons.find((s) => s.episodes.some((e) => e.id === target?.id)) ?? t.seasons[0];
  const directors = t.credits.filter((c) => c.role === 'director');
  const writers = t.credits.filter((c) => c.role === 'writer');
  const cast = t.credits.filter((c) => c.role === 'cast');
  const crew = t.credits.filter((c) => !['director', 'writer', 'cast'].includes(c.role));
  const movieProgress = progress[t.id];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': t.type === 'series' ? 'TVSeries' : 'Movie',
    name: t.title, alternateName: t.international_title ?? undefined, description: t.synopsis_short ?? undefined, url,
    image: t.images.poster ? new URL(t.images.poster.url, env.siteUrl).toString() : undefined,
    datePublished: t.release_date ?? undefined, inLanguage: t.languages, genre: t.genres.map((g) => g.name),
    contentRating: t.age_rating ?? undefined, countryOfOrigin: t.country ?? undefined,
    productionCompany: { '@type': 'Organization', name: t.production_company },
    director: directors.map((d) => ({ '@type': 'Person', name: d.name })),
    actor: cast.slice(0, 10).map((d) => ({ '@type': 'Person', name: d.name })),
    ...(t.type === 'series' ? { numberOfEpisodes: allEps.length, numberOfSeasons: t.seasons.length } : { duration: t.runtime_minutes ? `PT${t.runtime_minutes}M` : undefined }),
    ...(trailer ? { trailer: { '@type': 'VideoObject', name: trailer.name, description: trailer.description ?? trailer.name, thumbnailUrl: t.images.backdrop ? new URL(t.images.backdrop.url, env.siteUrl).toString() : undefined, uploadDate: t.published_at } } : {}),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <PageView contentType="title" contentId={t.id} />
      <section aria-labelledby="titulo" className="grain relative isolate flex min-h-[80svh] items-end overflow-hidden">
        <Backdrop img={t.images.backdrop ?? t.images.banner} priority />
        {trailer && <div className="absolute inset-0"><TeaserBackground trailerId={trailer.id} poster={t.images.backdrop?.url ?? null} /></div>}
        <div className="scrim-left absolute inset-0" /><div className="scrim-bottom absolute inset-0" />
        <div className="relative mx-auto grid w-full max-w-[1680px] items-end gap-10 px-4 pb-12 pt-32 sm:px-8 lg:grid-cols-[1fr_auto] lg:px-12">
          <div className="max-w-3xl animate-rise">
            <p className="eyebrow">{t.type === 'series' ? 'Serie original' : 'Original Cine LibroSeller'}{t.access !== 'free' && ` · ${ACCESS_LABEL[t.access]}`}</p>
            <h1 id="titulo" className="display mt-3 text-5xl leading-[0.95] sm:text-7xl">{t.title}</h1>
            {t.international_title && t.international_title !== t.title && <p className="mt-2 text-mist">{t.international_title}</p>}
            {t.tagline && <p className="display mt-4 text-xl italic text-cream/85 sm:text-2xl">{t.tagline}</p>}
            <div className="mt-5"><MetaLine t={{ ...t, genres: t.genres }} /></div>
            {t.synopsis_short && <p className="mt-4 max-w-2xl text-lg text-cream/85">{t.synopsis_short}</p>}
            <div className="mt-7 flex flex-wrap gap-3">
              {t.type === 'series' && target && (
                <a href={`${episodePath(t.slug, target.season_number, target.number)}/ver`} className="btn btn-primary">
                  <Icon name="play" size={18} /> {started ? `Continuar T${target.season_number}:E${target.number}` : `Ver T${target.season_number}:E${target.number}`}
                </a>
              )}
              {t.type !== 'series' && t.playable && (
                <a href={`${path}/ver`} className="btn btn-primary"><Icon name="play" size={18} /> {movieProgress && !movieProgress.completed && movieProgress.position > 10 ? `Continuar (${formatClock(movieProgress.position)})` : 'Ver ahora'}</a>
              )}
              {trailer && <TrailerButton trailerId={trailer.id} signedIn={!!viewer} label={TRAILER_KIND_LABEL[trailer.kind] === 'Teaser' ? 'Ver teaser' : 'Ver tráiler'} />}
              <WatchlistButton titleId={t.id} initial={inList} signedIn={!!viewer} nextPath={path} />
              <ShareButton url={url} title={t.title} text={t.synopsis_short ?? undefined} contentType="title" contentId={t.id} />
            </div>
            {t.type === 'series' && !target && <p className="mt-4 text-sm text-gold-soft">El primer episodio se estrenará pronto.</p>}
          </div>
          {t.images.poster && (
            <div className="relative hidden aspect-[2/3] w-64 overflow-hidden rounded-2xl shadow-[0_40px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/15 lg:block xl:w-72">
              <Image src={t.images.poster.url} alt={t.images.poster.alt || `Póster de ${t.title}`} fill sizes="288px" className="object-cover" priority />
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto grid max-w-[1680px] gap-16 px-4 pt-6 sm:px-8 lg:px-12">
        {t.type === 'series' && (
          <section id="episodios" aria-labelledby="h-episodios">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <h2 id="h-episodios" className="display text-3xl">Episodios</h2>
              {t.seasons.length > 1 && (
                <nav aria-label="Temporadas" className="flex flex-wrap gap-2">
                  {t.seasons.map((s) => (
                    <Link key={s.id} href={`${path}?temporada=${s.number}#episodios`} scroll={false} aria-current={s.id === season?.id ? 'page' : undefined}
                      className={`chip ${s.id === season?.id ? 'chip-gold' : ''}`}>{s.name || `Temporada ${s.number}`}</Link>
                  ))}
                </nav>
              )}
            </div>
            {season ? (
              <>
                {season.synopsis && <p className="mb-5 max-w-3xl text-mist">{season.synopsis}</p>}
                <EpisodeList seriesSlug={t.slug} episodes={season.episodes} progress={progress} />
              </>
            ) : <p className="text-mist">Los episodios se publicarán pronto.</p>}
          </section>
        )}

        <section aria-labelledby="h-sinopsis" className="grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <h2 id="h-sinopsis" className="display text-3xl">Sinopsis</h2>
            <div className="mt-4 space-y-4 whitespace-pre-line text-lg leading-relaxed text-cream/85">{t.synopsis_long || t.synopsis_short}</div>
            <div className="mt-6"><AiDisclosure value={t.ai_disclosure} note={t.ai_disclosure_note} /></div>
          </div>
          <dl className="grid content-start gap-4 text-sm">
            {directors.length > 0 && <Fact label="Dirección" value={directors.map((d) => d.name).join(', ')} />}
            {writers.length > 0 && <Fact label="Guion" value={writers.map((d) => d.name).join(', ')} />}
            <Fact label="Productora" value={t.production_company} />
            {t.release_date && <Fact label="Estreno" value={formatDate(t.release_date)} />}
            {t.country && <Fact label="País" value={t.country} />}
            <Fact label="Idiomas" value={t.languages.map((l) => new Intl.DisplayNames(['es'], { type: 'language' }).of(l) ?? l).join(', ')} />
            {t.genres.length > 0 && <Fact label="Géneros" value={t.genres.map((g) => g.name).join(', ')} />}
            {t.categories.length > 0 && <Fact label="Colecciones" value={t.categories.map((g) => g.name).join(', ')} />}
          </dl>
        </section>

        {(cast.length > 0 || crew.length > 0) && (
          <section aria-labelledby="h-reparto">
            <h2 id="h-reparto" className="display mb-5 text-3xl">Reparto y equipo</h2>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[...cast, ...crew].map((c, i) => (
                <li key={`${c.slug}-${c.role}-${i}`} className="flex items-center gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-graphite-3">
                    {c.photo_url && <Image src={c.photo_url} alt="" fill sizes="56px" className="object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-dim">{c.role === 'cast' ? c.character_name ?? c.credit_note ?? 'Reparto' : CREDIT_ROLE_LABEL[c.role]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.characters.length > 0 && (
          <section id="personajes" aria-labelledby="h-personajes">
            <h2 id="h-personajes" className="display mb-5 text-3xl">Personajes</h2>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {t.characters.map((c) => (
                <li key={c.slug}>
                  <Link href={`/personajes/${t.slug}/${c.slug}`} className="group block">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-graphite ring-1 ring-white/10 group-hover:ring-gold/60">
                      {c.image_url && <Image src={c.image_url} alt={c.name} fill sizes="(min-width:1024px) 20vw, 45vw" className="object-cover transition duration-700 group-hover:scale-[1.03]" />}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 p-4 pt-12">
                        <p className="display text-xl">{c.name}</p>
                        {(c.actor_name || c.digital_identity) && <p className="text-xs text-mist">{c.actor_name ?? c.digital_identity}</p>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {extras.length > 0 && (
          <section id="extras" aria-labelledby="h-extras">
            <h2 id="h-extras" className="display mb-5 text-3xl">Tráilers y detrás de cámaras</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {extras.map((x) => (
                <li key={x.id} className="card flex flex-col justify-between gap-4 p-5">
                  <div>
                    <p className="eyebrow">{TRAILER_KIND_LABEL[x.kind]}</p>
                    <p className="mt-2 font-semibold">{x.name}</p>
                    {x.description && <p className="mt-1 text-sm text-mist">{x.description}</p>}
                  </div>
                  <TrailerButton trailerId={x.id} label={`Ver${x.duration_seconds ? ` (${formatClock(Number(x.duration_seconds))})` : ''}`} className="btn btn-ghost btn-sm self-start" signedIn={!!viewer} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {comparisons.length > 0 && (
          <section aria-labelledby="h-proceso">
            <h2 id="h-proceso" className="display mb-5 text-3xl">Así se hizo</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              {comparisons.map((c) => (
                <div key={c.id}><BeforeAfter before={c.before_url} after={c.after_url} label={c.label} /><p className="mt-2 text-sm text-mist">{c.label}{c.description ? ` — ${c.description}` : ''}</p></div>
              ))}
            </div>
          </section>
        )}

        {t.images.gallery.length > 0 && (
          <section aria-labelledby="h-galeria">
            <h2 id="h-galeria" className="display mb-5 text-3xl">Galería</h2>
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {t.images.gallery.map((g) => (
                <li key={g.url} className="relative aspect-video overflow-hidden rounded-xl bg-graphite">
                  <Image src={g.url} alt={g.alt} fill sizes="(min-width:1024px) 25vw, 50vw" className="object-cover" />
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.source_book && <BookPanel book={t.source_book} titleId={t.id} />}

        {t.releases.length > 0 && (
          <section aria-labelledby="h-proximos" className="rounded-3xl border border-gold/30 bg-gold/[0.04] p-6 sm:p-8">
            <h2 id="h-proximos" className="display text-3xl">Próximos estrenos</h2>
            <ul className="mt-5 grid gap-6 md:grid-cols-2">
              {t.releases.map((r) => (
                <li key={r.id}>
                  <p className="eyebrow">{r.is_confirmed && r.release_at ? formatDate(r.release_at) : r.date_label || 'Fecha por confirmar'}{!r.is_confirmed && ' · sin confirmar'}</p>
                  <p className="mt-1 font-semibold">{r.episode_name ? `T${r.season_number}:E${r.episode_number} · ${r.episode_name}` : r.headline}</p>
                  <div className="mt-3"><NotifyForm releaseId={r.id} /></div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.related_links?.length > 0 && (
          <section aria-label="Enlaces relacionados" className="flex flex-wrap gap-2">
            {t.related_links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener" className="chip hover:text-cream">{l.label} ↗</a>)}
          </section>
        )}
      </div>

      {related.length > 0 && (
        <section aria-labelledby="h-rel" className="mt-16">
          <div id="h-rel"><SectionHeading title="También te puede interesar" /></div>
          <Rail label="Producciones similares">{related.map((r) => <PosterCard key={r.id} t={r} />)}</Rail>
        </section>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-dim">{label}</dt><dd className="mt-0.5 text-cream/90">{value}</dd></div>;
}
