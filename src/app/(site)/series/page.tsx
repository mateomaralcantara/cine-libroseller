import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { visibleTitles } from '@/lib/catalog/public';
import { PosterCard } from '@/components/catalog';
import { PageShell, EmptyState } from '@/components/PageShell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Series', description: 'Series originales de Cine LibroSeller Studios.', alternates: { canonical: '/series' } };

export default async function SeriesIndex() {
  const items = await visibleTitles(sql`and t.type = 'series'`, undefined, 120);
  return (
    <PageShell eyebrow="Catálogo" title="Series">
      {items.length ? (
        <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 [&>a]:w-auto">{items.map((t) => <PosterCard key={t.id} t={t} />)}</ul>
      ) : <EmptyState title="Las series llegarán muy pronto">Consulta los <Link className="text-gold-soft underline" href="/estrenos">próximos estrenos</Link>.</EmptyState>}
    </PageShell>
  );
}
