import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { TRAILER_KIND_LABEL } from '@/lib/format';
import { ActionForm } from '../../ui';
import { Panel, Field, TextArea, Select, VideoPanel, SubtitlePanel } from '../../blocks';
import { saveTrailerAction } from '../../actions';

export default async function ExtraEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [x] = await sql`select tr.*, t.title as title_name from trailers tr join titles t on t.id = tr.title_id where tr.id = ${id}`;
  if (!x) notFound();
  const episodes = await sql`select e.id, e.number, s.number as season from episodes e join seasons s on s.id = e.season_id where e.title_id = ${x.title_id} order by s.number, e.number`;
  return (
    <div className="grid gap-6">
      <div><Link href={`/admin/titulos/${x.title_id}?tab=extras`} className="text-sm text-dim hover:text-cream">← {x.title_name}</Link><h1 className="display mt-1 text-3xl">{x.name}</h1></div>
      <VideoPanel ownerType="trailer" ownerId={id} />
      <Panel title="Datos del extra">
        <ActionForm action={saveTrailerAction.bind(null, x.title_id, id)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" name="name" defaultValue={x.name} required />
            <Select label="Tipo" name="kind" defaultValue={x.kind} options={Object.entries(TRAILER_KIND_LABEL)} />
            <Select label="Episodio" name="episode_id" defaultValue={x.episode_id} options={[['', 'De toda la obra'], ...episodes.map((e) => [e.id, `T${e.season}:E${e.number}`] as [string, string])]} />
          </div>
          <TextArea label="Descripción" name="description" defaultValue={x.description} rows={2} />
          <div className="flex flex-wrap gap-6">
            <Field label="Orden" name="position" type="number" defaultValue={x.position} />
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_primary" defaultChecked={x.is_primary} className="accent-[var(--color-gold)]" /> Tráiler principal (portada y ficha)</label>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_published" defaultChecked={x.is_published} className="accent-[var(--color-gold)]" /> Publicado (requiere video aprobado)</label>
          </div>
        </ActionForm>
      </Panel>
      <SubtitlePanel ownerType="trailer" ownerId={id} />
    </div>
  );
}
