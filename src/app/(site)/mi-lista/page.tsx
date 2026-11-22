import type { Metadata } from 'next';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/session';
import { continueWatching, watchlistTitles } from '@/lib/catalog/public';
import { sql } from '@/lib/db';
import { PosterCard, WideCard } from '@/components/catalog';
import { PageShell, EmptyState } from '@/components/PageShell';
import { episodePath, titlePath, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mi lista', robots: { index: false } };

export default async function MyList() {
  const viewer = await requireViewer('/mi-lista');
  const [cw, list, history] = await Promise.all([
    continueWatching(viewer.viewerProfileId, 20),
    watchlistTitles(viewer.viewerProfileId),
    sql`select h.started_at, h.completed_at, h.content_type, t.slug, t.type, t.title, e.name as episode_name, e.number as episode_number, s.number as season_number
      from watch_history h join titles t on t.id = h.title_id left join episodes e on h.content_type = 'episode' and e.id = h.content_id left join seasons s on s.id = e.season_id
      where h.viewer_profile_id = ${viewer.viewerProfileId} order by h.started_at desc limit 30`,
  ]);
  return (
    <PageShell eyebrow={viewer.displayName} title="Mi lista">
      {cw.length > 0 && (
        <section aria-labelledby="h-cw" className="mb-14">
          <h2 id="h-cw" className="display mb-4 text-2xl">Continúa viendo</h2>
          <div role="list" className="flex flex-wrap gap-4">
            {cw.map((c) => (
              <WideCard key={c.content_id} img={c.image} title={c.title}
                href={c.content_type === 'episode' ? `${episodePath(c.slug, c.season_number!, c.episode_number!)}/ver` : `${titlePath(c)}/ver`}
                subtitle={c.episode_name ? `T${c.season_number}:E${c.episode_number} · ${c.episode_name}` : null}
                progress={c.duration_seconds ? c.position_seconds / c.duration_seconds : undefined} />
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="h-list">
        <h2 id="h-list" className="display mb-4 text-2xl">Guardadas</h2>
        {list.length ? <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 [&>a]:w-auto">{list.map((t) => <PosterCard key={t.id} t={t} />)}</ul>
          : <EmptyState title="Tu lista está vacía">Pulsa «Mi lista» en cualquier ficha para guardarla aquí. <Link href="/" className="text-gold-soft underline">Explorar</Link></EmptyState>}
      </section>
      {history.length > 0 && (
        <section aria-labelledby="h-hist" className="mt-14">
          <h2 id="h-hist" className="display mb-4 text-2xl">Historial</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <Link href={h.content_type === 'episode' ? episodePath(h.slug, h.season_number, h.episode_number) : titlePath(h as never)} className="hover:text-gold-soft">
                  {h.title}{h.episode_name && <span className="text-dim"> · T{h.season_number}:E{h.episode_number} {h.episode_name}</span>}
                </Link>
                <span className="text-dim">{formatDate(h.started_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{h.completed_at && ' · ✓ visto'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
