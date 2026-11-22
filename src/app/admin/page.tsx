import Link from 'next/link';
import { dashboardStats } from '@/lib/analytics';
import { env } from '@/lib/env';
import { formatDate, formatClock } from '@/lib/format';
import { Panel } from './blocks';

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ dias?: string; acceso?: string }> }) {
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.dias)) ? Number(sp.dias) : 30;
  const s = await dashboardStats(days);
  const v = s.videos;
  const completion = s.plays.starts ? Math.round((s.plays.completes / s.plays.starts) * 100) : null;
  const maxDaily = Math.max(1, ...s.daily.map((d) => d.n as number));
  return (
    <div className="grid gap-6">
      {sp.acceso === 'solo-administradores' && <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">Esa sección es sólo para administración.</p>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="display text-3xl">Panel</h1><p className="text-sm text-dim">Datos reales de los últimos {days} días. Una visita a una ficha no cuenta como reproducción.</p></div>
        <Link href="/admin/subir" className="btn btn-gold btn-sm">⬆ Subir episodio</Link>
        <nav className="flex gap-2" aria-label="Periodo">{[7, 30, 90].map((d) => <Link key={d} href={`/admin?dias=${d}`} className={`chip ${d === days ? 'chip-gold' : ''}`}>{d} días</Link>)}</nav>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Títulos publicados" value={s.catalog.published} sub={`En catálogo: ${s.catalog.films} ${s.catalog.films === 1 ? 'película' : 'películas'} · ${s.catalog.series} ${s.catalog.series === 1 ? 'serie' : 'series'} · ${s.catalog.drafts} en preparación`} />
        <Stat label="Episodios publicados" value={`${s.episodes.published}/${s.episodes.total}`} />
        <Stat label="Reproducciones válidas" value={s.plays.valid} sub={`${s.plays.starts} inicios · ${s.plays.trailer_starts} tráilers`} />
        <Stat label="Minutos vistos" value={s.plays.watched_minutes.toLocaleString('es-DO')} sub={completion !== null ? `${completion} % completadas` : undefined} />
        <Stat label="Visitas a fichas" value={s.plays.page_views} sub={`${s.plays.active_viewers} espectadores identificados`} />
        <Stat label="Usuarios registrados" value={s.users.total} sub={`+${s.users.new} nuevos`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Reproducciones válidas por día">
          {s.daily.length ? (
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Reproducciones válidas por día">
              {s.daily.map((d) => <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t bg-gold/80" style={{ height: `${((d.n as number) / maxDaily) * 100}%` }} />)}
            </div>
          ) : <p className="text-sm text-dim">Aún no hay reproducciones en este periodo.</p>}
        </Panel>
        <Panel title="Estado del streaming">
          <ul className="grid gap-2 text-sm">
            <li className="flex justify-between"><span>Proveedor de video</span><span className={env.mux.configured ? 'text-ok' : 'text-warn'}>{env.mux.configured ? 'Mux conectado' : 'Mux sin configurar (sólo enlaces)'}</span></li>
            <li className="flex justify-between"><span>Webhooks de Mux</span><span className={env.mux.webhookSecret ? 'text-ok' : 'text-warn'}>{env.mux.webhookSecret ? 'Verificación activa' : 'Falta MUX_WEBHOOK_SECRET'}</span></li>
            <li className="flex justify-between"><span>Reproducción firmada</span><span className={env.mux.signingKeyId ? 'text-ok' : 'text-dim'}>{env.mux.signingKeyId ? 'Disponible' : 'No configurada'}</span></li>
            <li className="flex justify-between"><span>Almacenamiento de imágenes</span><span>{env.storage.driver === 'supabase' ? 'Supabase Storage' : 'Disco local'}</span></li>
            <li className="flex justify-between"><span>Videos procesándose</span><span>{(v.uploading ?? 0) + (v.processing ?? 0) + (v.pending ?? 0)}</span></li>
            <li className="flex justify-between"><span>Pendientes de revisión</span><Link href="/admin/videos" className="text-gold-soft">{v.in_review ?? 0}</Link></li>
            <li className="flex justify-between"><span>Con error</span><span className={v.error ? 'text-bad' : ''}>{v.error ?? 0}</span></li>
            <li className="flex justify-between"><span>Errores de reproducción ({days} días)</span><span className={s.plays.errors ? 'text-bad' : ''}>{s.plays.errors}</span></li>
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Contenido más reproducido">
          {s.top.length ? (
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="py-1">Obra</th><th>Válidas</th><th>Inicios</th><th>Completas</th><th>Tiempo</th></tr></thead>
              <tbody className="divide-y divide-line">{s.top.map((t) => (
                <tr key={`${t.content_type}${t.content_id}`}><td className="py-2">{t.name}{t.content_type !== 'title' && <span className="block text-xs text-dim">{t.content_type === 'trailer' ? 'Tráiler · ' : ''}{t.title}</span>}</td>
                  <td>{t.valid}</td><td>{t.starts}</td><td>{t.completes}</td><td>{formatClock(Number(t.watched))}</td></tr>))}</tbody></table>
          ) : <p className="text-sm text-dim">Sin datos todavía.</p>}
        </Panel>
        <Panel title="Dispositivos y fuentes de tráfico">
          <div className="grid gap-6 sm:grid-cols-2 text-sm">
            <ul className="grid gap-1">{s.devices.length ? s.devices.map((d) => <li key={d.device} className="flex justify-between"><span>{({ desktop: 'Computadora', mobile: 'Teléfono', tablet: 'Tableta', tv: 'Televisor' } as Record<string, string>)[d.device] ?? 'Otro'}</span><span>{d.n}</span></li>) : <li className="text-dim">Sin reproducciones</li>}</ul>
            <ul className="grid gap-1">{s.sources.length ? s.sources.map((d) => <li key={d.source} className="flex justify-between"><span className="truncate">{d.source}</span><span>{d.n}</span></li>) : <li className="text-dim">Sin visitas</li>}</ul>
          </div>
        </Panel>
        <Panel title="Próximos estrenos" actions={<Link href="/admin/estrenos" className="text-sm text-gold-soft">Gestionar</Link>}>
          {s.upcoming.length ? <ul className="grid gap-2 text-sm">{s.upcoming.map((u, i) => <li key={i} className="flex justify-between gap-3"><span>{u.title}{u.episode_name && ` · ${u.episode_name}`}</span><span className="text-dim">{u.is_confirmed && u.release_at ? formatDate(u.release_at) : u.date_label ?? 'Sin fecha'}</span></li>)}</ul> : <p className="text-sm text-dim">Ninguno programado.</p>}
          <p className="mt-3 text-xs text-dim">{s.notify.release_alerts} avisos de estreno solicitados · {s.notify.newsletter} suscripciones a novedades.</p>
        </Panel>
        <Panel title="Incidencias">
          {s.failedVideos.length === 0 && s.recentErrors.length === 0 ? <p className="text-sm text-ok">Sin incidencias.</p> : (
            <ul className="grid gap-2 text-sm">
              {s.failedVideos.map((f) => <li key={f.id} className="text-bad">Video ({f.owner_type}): {f.error_message}</li>)}
              {s.recentErrors.map((e, i) => <li key={i} className="text-warn">Reproducción · {e.name}: {e.error_code} <span className="text-dim">({formatDate(e.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})</span></li>)}
            </ul>
          )}
          <p className="mt-3 text-xs text-dim">Ingresos verificados: {s.revenue.payments ? `${(s.revenue.cents / 100).toFixed(2)} (${s.revenue.payments} pagos confirmados)` : 'sin pagos (monetización no activada)'}.</p>
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-dim">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-mist">{sub}</p>}
    </div>
  );
}
