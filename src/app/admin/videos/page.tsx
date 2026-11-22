import Link from 'next/link';
import { sql } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { StatusPill, AutoRefresh, ActButton, Duration } from '../ui';
import { refreshVideoAction } from '../actions';

export default async function VideosAdmin() {
  const rows = await sql`select va.*, j.file_size, j.attempts,
      coalesce(e.name, tr.name, t.title) as owner_name,
      case va.owner_type when 'episode' then '/admin/episodios/' || va.owner_id when 'trailer' then '/admin/extras/' || va.owner_id else '/admin/titulos/' || va.owner_id || '?tab=video' end as href
    from video_assets va left join media_upload_jobs j on j.video_asset_id = va.id
    left join episodes e on va.owner_type = 'episode' and e.id = va.owner_id
    left join trailers tr on va.owner_type = 'trailer' and tr.id = va.owner_id
    left join titles t on va.owner_type = 'title' and t.id = va.owner_id
    order by va.updated_at desc limit 200`;
  const webhooks = await sql`select event_type, status, error_message, received_at from webhook_events order by received_at desc limit 15`;
  return (
    <div className="grid gap-6">
      <AutoRefresh active={rows.some((r) => ['pending', 'uploading', 'processing'].includes(r.status))} />
      <div><h1 className="display text-3xl">Videos</h1><p className="text-sm text-dim">Pendiente → Cargando → Procesando → En revisión → Listo → Publicado (o Error). El estado «procesado» sólo lo confirma el proveedor.</p></div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-dim"><tr><th className="p-3">Obra</th><th>Versión</th><th>Proveedor</th><th>Estado</th><th>Duración</th><th>Calidad</th><th>Actualizado</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-dim">Todavía no se ha cargado ningún video.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="p-3"><Link href={r.href} className="hover:text-gold-soft">{r.owner_name}</Link><p className="text-xs text-dim">{r.owner_type}</p></td>
                <td>v{r.version}{r.is_current && <span className="ml-1 text-xs text-gold">vigente</span>}</td>
                <td>{r.provider === 'mux' ? 'Mux' : r.provider === 'local' ? 'Local' : 'Enlace'}</td>
                <td><StatusPill status={r.status} video />{r.error_message && <p className="mt-1 max-w-xs text-xs text-bad">{r.error_message}</p>}</td>
                <td><Duration seconds={r.duration_seconds} /></td>
                <td>{r.max_resolution ?? '—'}</td>
                <td className="text-xs text-dim">{formatDate(r.updated_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{['uploading', 'processing', 'error', 'in_review'].includes(r.status) && <ActButton onAct={refreshVideoAction.bind(null, r.id)}>Consultar</ActButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card p-5"><h2 className="mb-3 font-semibold">Últimos webhooks del proveedor</h2>
        {webhooks.length ? <ul className="grid gap-1 text-sm">{webhooks.map((w, i) => <li key={i} className="flex justify-between gap-3"><span><code>{w.event_type}</code> {w.error_message && <span className="text-bad">{w.error_message}</span>}</span><span className="text-dim">{w.status} · {formatDate(w.received_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></li>)}</ul> : <p className="text-sm text-dim">Ninguno recibido.</p>}
      </section>
    </div>
  );
}
