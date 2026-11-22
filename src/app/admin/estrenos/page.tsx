import { sql } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { ActionForm } from '../ui';
import { Panel, Field, Select } from '../blocks';
import { saveReleaseAction } from '../actions';

const STATUS: [string, string][] = [['announced', 'Anunciado'], ['confirmed', 'Confirmado'], ['postponed', 'Aplazado'], ['released', 'Estrenado'], ['cancelled', 'Cancelado']];

export default async function ReleasesAdmin() {
  const [releases, titles, episodes] = await Promise.all([
    sql`select r.*, t.title, e.name as episode_name, (select count(*)::int from release_notifications n where n.release_schedule_id = r.id and n.unsubscribed_at is null) as alerts
      from release_schedules r join titles t on t.id = r.title_id left join episodes e on e.id = r.episode_id order by r.release_at nulls last, r.created_at`,
    sql`select id, title from titles order by title`,
    sql`select e.id, e.name, e.number, s.number as season, t.title from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id order by t.title, s.number, e.number`,
  ]);
  const titleOpts: [string, string][] = titles.map((t) => [t.id, t.title]);
  const epOpts: [string, string][] = [['', 'Toda la obra'], ...episodes.map((e) => [e.id, `${e.title} · T${e.season}:E${e.number} ${e.name}`] as [string, string])];
  const form = (r: Record<string, any> | null) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <ActionForm action={saveReleaseAction.bind(null, r?.id ?? null)} className="grid gap-3" resetOnOk={!r}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Obra" name="title_id" defaultValue={r?.title_id} options={titleOpts} />
        <Select label="Episodio" name="episode_id" defaultValue={r?.episode_id} options={epOpts} />
        <Field label="Titular" name="headline" defaultValue={r?.headline} placeholder="Estreno del episodio 1" />
        <Field label="Fecha y hora" name="release_at" type="datetime-local" defaultValue={r?.release_at ? new Date(r.release_at).toISOString().slice(0, 16) : ''} />
        <Field label="Fecha aproximada (texto)" name="date_label" defaultValue={r?.date_label} placeholder="Primavera 2027" help="Úsala cuando la fecha no esté confirmada." />
        <Select label="Estado" name="status" defaultValue={r?.status ?? 'announced'} options={STATUS} />
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_confirmed" defaultChecked={r?.is_confirmed} className="accent-[var(--color-gold)]" /> Fecha confirmada (activa la cuenta regresiva)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="is_public" defaultChecked={r ? r.is_public : true} className="accent-[var(--color-gold)]" /> Visible en el portal</label>
      </div>
    </ActionForm>
  );
  return (
    <div className="grid gap-6">
      <div><h1 className="display text-3xl">Próximos estrenos</h1><p className="text-sm text-dim">Una fecha sólo se presenta como definitiva si está confirmada. Las solicitudes de aviso quedan registradas con su consentimiento.</p></div>
      {releases.map((r) => (
        <Panel key={r.id} title={`${r.title}${r.episode_name ? ` · ${r.episode_name}` : ''}`} actions={<span className="text-sm text-dim">{r.is_confirmed && r.release_at ? formatDate(r.release_at) : r.date_label ?? 'Sin fecha'} · {r.alerts} avisos</span>}>
          {form(r)}
        </Panel>
      ))}
      <Panel title="Nuevo estreno">{form(null)}</Panel>
    </div>
  );
}
