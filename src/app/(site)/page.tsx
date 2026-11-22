import Link from 'next/link';
import { getViewer } from '@/lib/auth/session';
import { getHero, getHomeSections, upcomingReleases } from '@/lib/catalog/public';
import { Billboard, HomeRows, UpcomingCard } from '@/components/catalog';
import { Rail } from '@/components/interactive';
import { episodePath } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const viewer = await getViewer();
  const [hero, sections] = await Promise.all([getHero(), getHomeSections(viewer?.viewerProfileId ?? null)]);

  if (!hero) return <PreLaunch />;

  const firstEp = hero.seasons[0]?.episodes.find((e) => e.playable);
  const firstEpisodeHref = firstEp ? episodePath(hero.slug, firstEp.season_number, firstEp.number) : null;
  // Si el destacado y la sección «spotlight» son la misma obra, no repetimos el bloque editorial
  const rows = sections.filter((s) => !(s.kind === 'spotlight' && s.title.id === hero.id && sections.length > 1));
  return (
    <>
      <Billboard t={hero} headline={hero.headline} signedIn={!!viewer} firstEpisodeHref={firstEpisodeHref} />
      <div className="relative z-10 -mt-10 sm:-mt-16">
        <HomeRows sections={rows} signedIn={!!viewer} />
      </div>
    </>
  );
}

/** Portada cuando aún no hay ninguna obra publicada: no simula catálogo. */
async function PreLaunch() {
  const upcoming = await upcomingReleases();
  return (
    <>
      <section className="grain relative isolate flex min-h-[78svh] items-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_0%,rgba(200,162,90,0.18),transparent_60%)]">
        <div className="mx-auto w-full max-w-5xl px-6 pt-24 text-center">
          <p className="eyebrow animate-rise">Cine LibroSeller Studios presenta</p>
          <h1 className="display mt-6 animate-rise text-6xl leading-[0.95] sm:text-8xl">CINE <span className="text-gold">LIBROSELLER</span></h1>
          <p className="display mt-6 animate-rise text-2xl italic text-cream/85 sm:text-3xl">El futuro del cine comienza aquí.</p>
          <p className="mx-auto mt-6 max-w-xl text-mist">Estamos preparando la primera función. Las obras aparecerán aquí en cuanto se publiquen oficialmente.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/estrenos" className="btn btn-gold">Próximos estrenos</Link>
            <Link href="/cuenta/registro" className="btn btn-ghost">Crear cuenta</Link>
          </div>
        </div>
      </section>
      {upcoming.length > 0 && (
        <section className="mt-8" aria-label="Próximamente">
          <h2 className="display mb-4 px-4 text-3xl sm:px-8 lg:px-12">Próximamente</h2>
          <Rail label="Próximamente">{upcoming.map((r) => <UpcomingCard key={r.id} r={r} />)}</Rail>
        </section>
      )}
    </>
  );
}
