import type { Metadata } from 'next';
import Link from 'next/link';
import { upcomingReleases } from '@/lib/catalog/public';
import { Backdrop } from '@/components/catalog';
import { Countdown, NotifyForm } from '@/components/interactive';
import { PageShell, EmptyState } from '@/components/PageShell';
import { formatDate, titlePath } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Próximos estrenos', description: 'Calendario de estrenos de Cine LibroSeller.', alternates: { canonical: '/estrenos' } };

export default async function Releases() {
  const items = await upcomingReleases(50);
  return (
    <PageShell eyebrow="Calendario" title="Próximos estrenos" intro="Sólo mostramos una cuenta regresiva cuando la fecha está confirmada. Las demás son anuncios orientativos.">
      {items.length === 0 ? <EmptyState title="No hay estrenos anunciados por ahora" /> : (
        <ul className="grid gap-6">
          {items.map((r) => (
            <li key={r.id} className="grid overflow-hidden rounded-3xl border border-line bg-graphite md:grid-cols-[1.1fr_1fr]">
              <div className="relative min-h-56"><Backdrop img={r.images.backdrop ?? r.images.banner} /></div>
              <div className="p-6 sm:p-8">
                <p className="eyebrow">{r.is_confirmed && r.release_at ? formatDate(r.release_at, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : r.date_label || 'Fecha por confirmar'}</p>
                {!r.is_confirmed && <p className="mt-1 text-xs text-dim">Fecha orientativa, aún no confirmada.</p>}
                {r.status === 'postponed' && <p className="mt-1 text-xs text-warn">Estreno aplazado</p>}
                <h2 className="display mt-3 text-3xl">{r.title}</h2>
                {r.episode_name && <p className="text-mist">Temporada {r.season_number} · Episodio {r.episode_number}: {r.episode_name}</p>}
                {(r.headline || r.synopsis_short) && <p className="mt-3 text-cream/85">{r.headline || r.synopsis_short}</p>}
                {r.is_confirmed && r.release_at && <div className="mt-5"><Countdown to={new Date(r.release_at).toISOString()} /></div>}
                <div className="mt-6"><NotifyForm releaseId={r.id} /></div>
                <Link href={titlePath(r)} className="mt-4 inline-block text-sm text-gold-soft hover:underline">Ver ficha →</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
