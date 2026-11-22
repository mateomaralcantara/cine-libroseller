import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { episodeReadiness } from '@/lib/catalog/admin';
import { ACCESS_LABEL, episodePath } from '@/lib/format';
import { ActionForm } from '../../ui';
import { Panel, Field, TextArea, Select, StatusControls, VideoPanel, ImagePanel, SubtitlePanel } from '../../blocks';
import { updateEpisodeAction, episodeStatusAction, availabilityAction } from '../../actions';

export default async function EpisodeEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [e] = await sql`select e.*, s.number as season_number, t.title as series_title, t.slug, t.id as series_id, t.status as series_status
    from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id where e.id = ${id}`;
  if (!e) notFound();
  const missing = await episodeReadiness(id);
  const [avail] = await sql`select * from content_availability where content_type = 'episode' and content_id = ${id}`;
  const href = episodePath(e.slug, e.season_number, e.number);
  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/admin/titulos/${e.series_id}?tab=temporadas`} className="text-sm text-dim hover:text-cream">← {e.series_title}</Link>
        <h1 className="display mt-1 text-3xl">T{e.season_number}:E{e.number} · {e.name}</h1>
        {e.series_status !== 'published' && <p className="mt-2 text-sm text-warn">La serie aún no está publicada: el episodio no será visible hasta que la serie lo esté.</p>}
      </div>
      <Panel title="Publicación" actions={e.status === 'published' ? <a href={href} target="_blank" className="btn btn-ghost btn-sm">Ver en el portal ↗</a> : null}>
        <StatusControls status={e.status} publishAt={e.publish_at} missing={missing} action={episodeStatusAction.bind(null, id) as never} />
      </Panel>
      <Panel title="Ficha del episodio">
        <ActionForm action={updateEpisodeAction.bind(null, id)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Número" name="number" type="number" min={1} defaultValue={e.number} required />
            <div className="sm:col-span-2"><Field label="Nombre" name="name" defaultValue={e.name} required /></div>
            <Field label="Duración (min)" name="runtime_minutes" type="number" min={1} defaultValue={e.runtime_minutes} />
            <Field label="Fecha de estreno" name="release_date" type="date" defaultValue={e.release_date ? new Date(e.release_date).toISOString().slice(0, 10) : ''} />
            <Select label="Acceso" name="access" defaultValue={e.access} options={Object.entries(ACCESS_LABEL)} help="«Gratis» hereda el acceso de la serie." />
          </div>
          <TextArea label="Sinopsis" name="synopsis" defaultValue={e.synopsis} rows={4} maxLength={3000} />
        </ActionForm>
      </Panel>
      <VideoPanel ownerType="episode" ownerId={id} previewHref={`${href}/ver`} />
      <SubtitlePanel ownerType="episode" ownerId={id} />
      <ImagePanel ownerType="episode" ownerId={id} kinds={['thumbnail', 'still']} title="Miniatura y fotogramas" />
      <Panel title="Disponibilidad del episodio">
        <ActionForm action={availabilityAction.bind(null, 'episode', id)} className="grid gap-3 sm:grid-cols-2">
          <Field label="Sólo en estos países (vacío = todos)" name="allowed_countries" defaultValue={avail?.allowed_countries?.join(', ')} />
          <Field label="Bloqueado en" name="blocked_countries" defaultValue={avail?.blocked_countries?.join(', ')} />
          <Field label="Disponible desde" name="starts_at" type="datetime-local" defaultValue={avail?.starts_at ? new Date(avail.starts_at).toISOString().slice(0, 16) : ''} />
          <Field label="Disponible hasta" name="ends_at" type="datetime-local" defaultValue={avail?.ends_at ? new Date(avail.ends_at).toISOString().slice(0, 16) : ''} />
        </ActionForm>
      </Panel>
    </div>
  );
}
