import type { Metadata } from 'next';
import Link from 'next/link';
import { approvedComparisons, behindTheScenes } from '@/lib/catalog/public';
import { getViewer } from '@/lib/auth/session';
import { BeforeAfter, TrailerButton } from '@/components/interactive';
import { Backdrop } from '@/components/catalog';
import { PageShell, EmptyState } from '@/components/PageShell';
import { TRAILER_KIND_LABEL, titlePath } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Detrás de cámaras', description: 'Cómo se hacen las producciones híbridas de Cine LibroSeller Studios.', alternates: { canonical: '/detras-de-camaras' } };

const CAT: Record<string, string> = { actor: 'Intérprete', set: 'Escenario', character_design: 'Diseño de personaje', storyboard: 'Storyboard', vfx: 'VFX' };

export default async function BehindTheScenes() {
  const [comparisons, extras, viewer] = await Promise.all([approvedComparisons(), behindTheScenes(30), getViewer()]);
  return (
    <PageShell eyebrow="Portafolio de Cine LibroSeller Studios" title="Detrás de cámaras"
      intro="Intérpretes reales, escenarios reales y su transformación final. Sólo mostramos comparaciones autorizadas por las personas y titulares de derechos.">
      {!comparisons.length && !extras.length && <EmptyState title="Pronto compartiremos el proceso" />}
      {comparisons.length > 0 && (
        <section aria-labelledby="h-comp">
          <h2 id="h-comp" className="display mb-6 text-3xl">Antes y después</h2>
          <div className="grid gap-8 lg:grid-cols-2">
            {comparisons.map((c) => (
              <article key={c.id}>
                <BeforeAfter before={c.before_url} after={c.after_url} label={c.label} />
                <p className="mt-3 text-xs uppercase tracking-wider text-gold">{CAT[c.category]}</p>
                <h3 className="mt-1 font-semibold">{c.label}</h3>
                {c.description && <p className="mt-1 text-sm text-mist">{c.description}</p>}
                {c.title_name && <Link href={titlePath({ type: c.title_type, slug: c.title_slug })} className="mt-1 inline-block text-sm text-gold-soft hover:underline">{c.title_name}</Link>}
              </article>
            ))}
          </div>
        </section>
      )}
      {extras.length > 0 && (
        <section aria-labelledby="h-extras" className="mt-16">
          <h2 id="h-extras" className="display mb-6 text-3xl">Entrevistas y making of</h2>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {extras.map((x) => (
              <li key={x.id} className="card overflow-hidden">
                <div className="relative aspect-video"><Backdrop img={x.image} /></div>
                <div className="p-5">
                  <p className="eyebrow">{TRAILER_KIND_LABEL[x.kind]}</p>
                  <h3 className="mt-1 font-semibold">{x.name}</h3>
                  <p className="text-sm text-dim">{x.title}</p>
                  <div className="mt-4"><TrailerButton trailerId={x.id} label="Ver" className="btn btn-ghost btn-sm" signedIn={!!viewer} /></div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
