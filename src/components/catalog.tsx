import Image from 'next/image';
import Link from 'next/link';
import type { TitleCard as Card, TitleDetail, EpisodeItem, HomeSection, Img } from '@/lib/catalog/public';
import { formatRuntime, formatClock, formatDate, titlePath, episodePath, TYPE_LABEL, yearOf, AI_LABEL, TRAILER_KIND_LABEL } from '@/lib/format';
import { Rail, TrailerButton, NotifyForm, BookLink, TeaserBackground } from './interactive';
import { Icon } from './player/icons';
import { HoverTrailer } from './HoverTrailer';

export function Backdrop({ img, priority = false, className = '' }: { img?: Img | null; priority?: boolean; className?: string }) {
  if (!img) return <div className={`absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(200,162,90,0.16),transparent_60%),linear-gradient(160deg,#17171d,#060608)] ${className}`} aria-hidden />;
  return <Image src={img.url} alt={img.alt} fill priority={priority} sizes="100vw" className={`object-cover ${className}`} />;
}

export function MetaLine({ t }: { t: { type: string; release_date: string | null; runtime_minutes: number | null; age_rating: string | null; genres?: string[] | { name: string }[] } & { episodes_available?: number } }) {
  const genres = (t.genres ?? []).map((g) => (typeof g === 'string' ? g : g.name));
  const parts = [TYPE_LABEL[t.type], yearOf(t.release_date), t.type !== 'series' ? formatRuntime(t.runtime_minutes) : null, ...genres.slice(0, 3)].filter(Boolean);
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-mist">
      {t.age_rating && <span className="rounded border border-white/30 px-1.5 py-px text-xs text-cream">{t.age_rating}</span>}
      {parts.map((p, i) => <span key={i} className="after:ml-2.5 after:text-dim after:content-['·'] last:after:hidden">{p}</span>)}
    </p>
  );
}

export function PosterCard({ t }: { t: Card }) {
  const img = t.images.poster;
  return (
    <Link role="listitem" href={titlePath(t)} className="group relative block w-[42vw] shrink-0 sm:w-[200px] lg:w-[220px]" aria-label={`${t.title}, ${TYPE_LABEL[t.type]}`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-graphite ring-1 ring-white/10 transition duration-500 ease-[var(--ease-cinema)] group-hover:-translate-y-1 group-hover:ring-gold/60 group-focus-visible:ring-gold">
        {img ? <Image src={img.url} alt={img.alt || t.title} fill sizes="(min-width: 1024px) 220px, (min-width: 640px) 200px, 42vw" className="object-cover transition duration-700 group-hover:scale-[1.04]" />
          : <Backdrop img={t.images.backdrop ?? t.images.banner} />}
        {t.type === 'series' && t.episodes_available > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[0.7rem] backdrop-blur">{t.episodes_available} {t.episodes_available === 1 ? 'episodio' : 'episodios'}</span>
        )}
        {t.access !== 'free' && <span className="absolute right-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[0.7rem] font-semibold text-ink">{t.access === 'premium' ? 'Premium' : 'Con cuenta'}</span>}
        {t.trailer_id && <HoverTrailer trailerId={t.trailer_id} title={t.title} />}
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-cream/90 group-hover:text-cream">{t.title}</p>
      <p className="truncate text-xs text-dim">{[TYPE_LABEL[t.type], t.genres[0]].filter(Boolean).join(' · ')}</p>
    </Link>
  );
}

export function WideCard({ href, img, title, subtitle, progress, badge }: { href: string; img: Img | null | undefined; title: string; subtitle?: string | null; progress?: number; badge?: string }) {
  return (
    <Link role="listitem" href={href} className="group block w-[72vw] shrink-0 sm:w-[340px] lg:w-[380px]">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-graphite ring-1 ring-white/10 transition duration-500 group-hover:ring-gold/60">
        <Backdrop img={img} className="transition duration-700 group-hover:scale-[1.03]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
        <span className="absolute inset-0 m-auto grid h-12 w-12 place-items-center rounded-full bg-black/50 opacity-0 backdrop-blur transition group-hover:opacity-100"><Icon name="play" /></span>
        {badge && <span className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[0.7rem] font-semibold text-ink">{badge}</span>}
        {progress !== undefined && (
          <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
            <div className="h-full bg-gold" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2.5 truncate text-sm font-medium">{title}</p>
      {subtitle && <p className="truncate text-xs text-dim">{subtitle}</p>}
    </Link>
  );
}

export function SectionHeading({ title, sub, href }: { title: string; sub?: string | null; href?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 px-4 sm:px-8 lg:px-12">
      <div>
        <h2 className="display text-2xl sm:text-3xl">{title}</h2>
        {sub && <p className="mt-1 text-sm text-dim">{sub}</p>}
      </div>
      {href && <Link href={href} className="shrink-0 text-sm text-gold-soft hover:underline">Ver todo</Link>}
    </div>
  );
}

/** Billboard principal: póster horizontal, sinopsis breve y acciones. */
export function Billboard({ t, headline, signedIn, firstEpisodeHref }: { t: TitleDetail; headline?: string | null; signedIn: boolean; firstEpisodeHref: string | null }) {
  const trailer = t.extras.find((x) => x.is_primary && ['trailer', 'teaser'].includes(x.kind)) ?? t.extras.find((x) => ['trailer', 'teaser'].includes(x.kind));
  const eps = t.seasons.reduce((n, s) => n + s.episodes.length, 0);
  const watchHref = t.type === 'series' ? (firstEpisodeHref ? `${firstEpisodeHref}/ver` : null) : t.playable ? `${titlePath(t)}/ver` : null;
  return (
    <section aria-label={`Destacado: ${t.title}`} className="grain relative isolate flex min-h-[88svh] items-end overflow-hidden">
      <Backdrop img={t.images.backdrop ?? t.images.banner} priority className="animate-fade" />
      {trailer && <TeaserSlot trailerId={trailer.id} poster={t.images.backdrop?.url ?? null} />}
      <div className="scrim-left absolute inset-0" />
      <div className="scrim-bottom absolute inset-0" />
      <div className="relative mx-auto w-full max-w-[1680px] px-4 pb-16 pt-32 sm:px-8 sm:pb-24 lg:px-12">
        <div className="max-w-2xl animate-rise">
          <p className="eyebrow">{headline || (t.type === 'series' ? 'Serie original' : 'Original Cine LibroSeller')}</p>
          {t.images.logo
            ? <h1 className="mt-4"><Image src={t.images.logo.url} alt={t.title} width={t.images.logo.width ?? 600} height={t.images.logo.height ?? 200} className="h-auto max-h-44 w-auto max-w-full" priority /></h1>
            : <h1 className="display mt-3 text-5xl leading-[0.95] sm:text-7xl lg:text-8xl">{t.title}</h1>}
          {t.tagline && <p className="display mt-4 text-xl italic text-cream/85 sm:text-2xl">{t.tagline}</p>}
          <div className="mt-5"><MetaLine t={t} /></div>
          {t.synopsis_short && <p className="mt-4 max-w-xl text-base leading-relaxed text-cream/85 sm:text-lg">{t.synopsis_short}</p>}
          {t.type === 'series' && <p className="mt-3 text-sm text-gold-soft">{eps ? `${eps} ${eps === 1 ? 'episodio disponible' : 'episodios disponibles'}` : 'Primer episodio próximamente'}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
            {watchHref && <a href={watchHref} className="btn btn-primary"><Icon name="play" size={18} /> Ver ahora</a>}
            {trailer && <TrailerButton trailerId={trailer.id} signedIn={signedIn} />}
            <Link href={titlePath(t)} className="btn btn-ghost"><Icon name="info" size={18} /> Más información</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function TeaserSlot({ trailerId, poster }: { trailerId: string; poster: string | null }) {
  return <div className="absolute inset-0"><TeaserBackground trailerId={trailerId} poster={poster} /></div>;
}

export function EpisodeList({ seriesSlug, episodes, progress = {} }: { seriesSlug: string; episodes: EpisodeItem[]; progress?: Record<string, { position: number; duration: number | null; completed: boolean }> }) {
  if (!episodes.length) return <p className="text-mist">Los episodios de esta temporada se publicarán pronto.</p>;
  return (
    <ol className="grid gap-3">
      {episodes.map((e) => {
        const href = episodePath(seriesSlug, e.season_number, e.number);
        const p = progress[e.id];
        const ratio = p?.completed ? 1 : p?.duration ? Math.min(1, p.position / p.duration) : undefined;
        return (
          <li key={e.id}>
            <article className="group grid grid-cols-[132px_1fr] gap-4 rounded-2xl p-2 transition hover:bg-white/[0.04] sm:grid-cols-[240px_1fr] sm:p-3">
              <Link href={e.playable ? `${href}/ver` : href} className="relative aspect-video overflow-hidden rounded-xl bg-graphite ring-1 ring-white/10" aria-label={`Ver episodio ${e.number}: ${e.name}`}>
                <Backdrop img={e.thumbnail} className="transition duration-700 group-hover:scale-[1.03]" />
                {e.playable && <span className="absolute inset-0 m-auto grid h-11 w-11 place-items-center rounded-full bg-black/55 backdrop-blur"><Icon name="play" size={18} /></span>}
                {ratio !== undefined && <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/25"><div className="h-full bg-gold" style={{ width: `${ratio * 100}%` }} /></div>}
              </Link>
              <div className="min-w-0 py-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold"><Link href={href} className="hover:text-gold-soft"><span className="text-dim">{e.number}.</span> {e.name}</Link></h3>
                  <span className="shrink-0 text-sm text-dim">{formatRuntime(e.runtime_minutes)}</span>
                </div>
                {p?.completed && <p className="mt-0.5 text-xs text-ok">✓ Visto</p>}
                {!p?.completed && p && p.position > 10 && <p className="mt-0.5 text-xs text-gold-soft">Continuar en {formatClock(p.position)}</p>}
                {e.synopsis && <p className="mt-1.5 line-clamp-3 text-sm text-mist">{e.synopsis}</p>}
                {!e.playable && <p className="mt-1.5 text-xs text-warn">Disponible próximamente</p>}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

export function UpcomingCard({ r }: { r: { id: string; title: string; slug: string; type: string; headline: string | null; release_at: Date | null; date_label: string | null; is_confirmed: boolean; status: string; episode_name: string | null; season_number: number | null; episode_number: number | null; synopsis_short: string | null; images: { backdrop?: Img; banner?: Img; poster?: Img } } }) {
  return (
    <article role="listitem" className="w-[80vw] shrink-0 overflow-hidden rounded-2xl border border-line bg-graphite sm:w-[420px]">
      <div className="relative aspect-video"><Backdrop img={r.images.backdrop ?? r.images.banner} /><div className="absolute inset-0 bg-gradient-to-t from-graphite" /></div>
      <div className="p-5">
        <p className="eyebrow">{r.is_confirmed && r.release_at ? formatDate(r.release_at, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : r.date_label || 'Fecha por confirmar'}</p>
        {!r.is_confirmed && <p className="mt-1 text-xs text-dim">Fecha no confirmada</p>}
        {r.status === 'postponed' && <p className="mt-1 text-xs text-warn">Aplazado</p>}
        <h3 className="display mt-2 text-xl">{r.title}</h3>
        {r.episode_name && <p className="text-sm text-mist">T{r.season_number}:E{r.episode_number} · {r.episode_name}</p>}
        {r.headline && <p className="mt-2 text-sm text-mist">{r.headline}</p>}
        <div className="mt-4"><NotifyForm releaseId={r.id} compact /></div>
      </div>
    </article>
  );
}

export function HomeRows({ sections, signedIn }: { sections: HomeSection[]; signedIn: boolean }) {
  return (
    <div className="grid gap-12 sm:gap-16">
      {sections.map((s) => {
        if (s.kind === 'spotlight') return <Spotlight key={s.id} heading={s.heading} t={s.title} signedIn={signedIn} />;
        return (
          <section key={s.id} aria-labelledby={`h-${s.id}`}>
            <div id={`h-${s.id}`}><SectionHeading title={s.heading} sub={s.subheading} href={s.kind === 'upcoming' ? '/estrenos' : s.kind === 'extras' ? '/detras-de-camaras' : undefined} /></div>
            <Rail label={s.heading}>
              {s.kind === 'titles' && s.items.map((t) => <PosterCard key={t.id} t={t} />)}
              {s.kind === 'continue' && s.items.map((c) => (
                <WideCard key={c.content_id} img={c.image}
                  href={c.content_type === 'episode' ? `${episodePath(c.slug, c.season_number!, c.episode_number!)}/ver` : `${titlePath(c)}/ver`}
                  title={c.title} subtitle={c.episode_name ? `T${c.season_number}:E${c.episode_number} · ${c.episode_name}` : `Quedan ${formatClock(Math.max(0, (c.duration_seconds ?? 0) - c.position_seconds))}`}
                  progress={c.duration_seconds ? c.position_seconds / c.duration_seconds : undefined} />
              ))}
              {s.kind === 'episodes' && s.items.map((e) => (
                <WideCard key={e.id} img={e.image} href={episodePath(e.slug, e.season_number, e.number)} title={`${e.title}`} subtitle={`T${e.season_number}:E${e.number} · ${e.name}`} badge="Nuevo" />
              ))}
              {s.kind === 'upcoming' && s.items.map((r) => <UpcomingCard key={r.id} r={r} />)}
              {s.kind === 'extras' && s.items.map((x) => (
                <WideCard key={x.id} img={x.image} href={`${titlePath(x)}#extras`} title={x.name} subtitle={`${TRAILER_KIND_LABEL[x.kind] ?? ''} · ${x.title}`} />
              ))}
            </Rail>
          </section>
        );
      })}
    </div>
  );
}

/** Portada editorial de una obra: pensada para el lanzamiento con muy pocos títulos. */
export function Spotlight({ heading, t, signedIn }: { heading: string; t: TitleDetail; signedIn: boolean }) {
  const eps = t.seasons.flatMap((s) => s.episodes);
  const trailer = t.extras.find((x) => ['trailer', 'teaser'].includes(x.kind));
  const extras = t.extras.filter((x) => !['trailer', 'teaser'].includes(x.kind));
  return (
    <section aria-label={heading} className="mx-4 overflow-hidden rounded-3xl border border-line bg-graphite sm:mx-8 lg:mx-12">
      <div className="grid lg:grid-cols-[1.25fr_1fr]">
        <div className="relative min-h-72 lg:min-h-[520px]">
          <Backdrop img={t.images.banner ?? t.images.backdrop} />
          <div className="absolute inset-0 bg-gradient-to-t from-graphite via-graphite/10 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-graphite" />
        </div>
        <div className="relative p-6 sm:p-10">
          <p className="eyebrow">{heading}</p>
          <h2 className="display mt-3 text-4xl sm:text-5xl">{t.title}</h2>
          <div className="mt-3"><MetaLine t={t} /></div>
          {(t.synopsis_long || t.synopsis_short) && <p className="mt-4 line-clamp-6 text-mist">{t.synopsis_short || t.synopsis_long}</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            {trailer && <TrailerButton trailerId={trailer.id} signedIn={signedIn} className="btn btn-gold" />}
            <Link href={titlePath(t)} className="btn btn-ghost">Explorar la serie</Link>
          </div>
          {eps.length > 0 && (
            <div className="mt-8">
              <h3 className="eyebrow mb-3">Episodios</h3>
              <ul className="grid gap-2">
                {eps.slice(0, 4).map((e) => (
                  <li key={e.id}><Link href={episodePath(t.slug, e.season_number, e.number)} className="flex items-center justify-between rounded-xl border border-line px-4 py-3 hover:border-gold/60">
                    <span><span className="text-dim">T{e.season_number}:E{e.number}</span> · {e.name}</span><span className="text-sm text-dim">{formatRuntime(e.runtime_minutes)}</span>
                  </Link></li>
                ))}
              </ul>
            </div>
          )}
          {t.releases.length > 0 && (
            <div className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-4">
              <p className="eyebrow">Próximamente</p>
              <p className="mt-1 text-sm">{t.releases[0].episode_name ? `T${t.releases[0].season_number}:E${t.releases[0].episode_number} · ${t.releases[0].episode_name}` : t.releases[0].headline}</p>
              <p className="text-xs text-dim">{t.releases[0].is_confirmed && t.releases[0].release_at ? formatDate(t.releases[0].release_at) : t.releases[0].date_label || 'Fecha por confirmar'}</p>
            </div>
          )}
          {(extras.length > 0 || t.source_book) && (
            <div className="mt-6 flex flex-wrap gap-2 text-sm">
              {extras.length > 0 && <Link href={`${titlePath(t)}#extras`} className="chip chip-gold">Detrás de cámaras</Link>}
              {t.characters.length > 0 && <Link href={`${titlePath(t)}#personajes`} className="chip">Personajes</Link>}
              {t.source_book && <Link href={`${titlePath(t)}#libro`} className="chip">El libro original</Link>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function AiDisclosure({ value, note }: { value: string; note?: string | null }) {
  if (value === 'none') return null;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-sm text-mist">
      <span aria-hidden className="text-gold">◆</span>
      <span><strong className="font-medium text-cream">{AI_LABEL[value]}.</strong> {note}</span>
    </p>
  );
}

export function BookPanel({ book, titleId }: { book: NonNullable<TitleDetail['source_book']>; titleId: string }) {
  return (
    <section id="libro" aria-labelledby="h-libro" className="grid gap-6 rounded-3xl border border-line bg-graphite p-6 sm:grid-cols-[160px_1fr] sm:p-8">
      {book.cover_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={book.cover_url} alt={`Portada de ${book.title}`} className="w-32 rounded-lg shadow-2xl sm:w-40" loading="lazy" />
        : <div className="grid aspect-[2/3] w-32 place-items-center rounded-lg bg-graphite-3 text-gold sm:w-40"><Icon name="book" size={36} /></div>}
      <div>
        <p className="eyebrow">Basada en el libro</p>
        <h2 id="h-libro" className="display mt-2 text-3xl">{book.title}</h2>
        <p className="mt-1 text-mist">{[book.author, book.publisher].filter(Boolean).join(' · ')}</p>
        {book.relation && <p className="mt-3 text-sm text-mist">{book.relation}</p>}
        {book.synopsis && <p className="mt-3 text-cream/85">{book.synopsis}</p>}
        {book.purchase_url && <div className="mt-5"><BookLink href={book.purchase_url} titleId={titleId}><Icon name="book" size={16} /> Leer el libro en LibroSeller</BookLink></div>}
      </div>
    </section>
  );
}
