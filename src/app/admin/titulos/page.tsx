import Link from 'next/link';
import { sql } from '@/lib/db';
import { titleReadiness } from '@/lib/catalog/admin';
import { TYPE_LABEL, formatDate } from '@/lib/format';
import { ActionForm, StatusPill } from '../ui';
import { Panel, Field, Select } from '../blocks';
import { createTitleAction } from '../actions';

export default async function TitlesAdmin() {
  const titles = await sql`select t.*, (select count(*)::int from episodes e where e.title_id = t.id) as episodes,
    (select count(*)::int from episodes e where e.title_id = t.id and e.status = 'published') as published_episodes
    from titles t order by t.updated_at desc`;
  const readiness = Object.fromEntries(await Promise.all(titles.map(async (t) => [t.id, await titleReadiness(t.id)] as const)));
  return (
    <div className="grid gap-6">
      <h1 className="display text-3xl">Títulos</h1>
      <Panel title="Nuevo título">
        <ActionForm action={createTitleAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" submit="Crear y editar">
          <Select label="Tipo" name="type" options={Object.entries(TYPE_LABEL)} />
          <Field label="Título oficial" name="title" required maxLength={200} />
        </ActionForm>
      </Panel>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-dim"><tr><th className="p-3">Título</th><th>Tipo</th><th>Estado</th><th>Episodios</th><th>Pendiente</th><th>Actualizado</th></tr></thead>
          <tbody className="divide-y divide-line">
            {titles.map((t) => (
              <tr key={t.id} className="hover:bg-white/[0.02]">
                <td className="p-3"><Link href={`/admin/titulos/${t.id}`} className="font-medium hover:text-gold-soft">{t.title}</Link><p className="text-xs text-dim">/{t.slug}</p></td>
                <td>{TYPE_LABEL[t.type]}</td>
                <td><StatusPill status={t.status} /></td>
                <td>{t.type === 'series' ? `${t.published_episodes}/${t.episodes}` : '—'}</td>
                <td className="max-w-xs text-xs text-warn">{readiness[t.id].length ? readiness[t.id].join(', ') : <span className="text-ok">Completo</span>}</td>
                <td className="text-xs text-dim">{formatDate(t.updated_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
