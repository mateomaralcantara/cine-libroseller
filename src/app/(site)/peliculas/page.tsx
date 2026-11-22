import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { visibleTitles } from '@/lib/catalog/public';
import { PosterCard } from '@/components/catalog';
import { PageShell, EmptyState } from '@/components/PageShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Películas', description: 'Películas, cortometrajes y documentales originales.', alternates: { canonical: '/peliculas' } };

const TABS = [
  { key: '', label: 'Todo' }, { key: 'movie', label: 'Películas' }, { key: 'short', label: 'Cortometrajes' },
  { key: 'documentary', label: 'Documentales' }, { key: 'special', label: 'Especiales' },
];

export default async function FilmsIndex({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo = '' } = await searchParams;
  const type = TABS.some((t) => t.key === tipo) ? tipo : '';
  const items = await visibleTitles(type ? sql`and t.type = ${type}` : sql`and t.type <> 'series'`, undefined, 120);
  return (
    <PageShell eyebrow="Catálogo" title="Películas">
      <nav aria-label="Tipo" className="-mt-4 mb-8 flex flex-wrap gap-2">
        {TABS.map((t) => <Link key={t.key} href={t.key ? `/peliculas?tipo=${t.key}` : '/peliculas'} aria-current={type === t.key ? 'page' : undefined} className={`chip ${type === t.key ? 'chip-gold' : ''}`}>{t.label}</Link>)}
      </nav>
      {items.length ? (
        <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 [&>a]:w-auto">{items.map((t) => <PosterCard key={t.id} t={t} />)}</ul>
      ) : <EmptyState title="Aún no hay obras publicadas en esta sección">Mientras tanto, mira los <Link className="text-gold-soft underline" href="/estrenos">próximos estrenos</Link>.</EmptyState>}
    </PageShell>
  );
}
