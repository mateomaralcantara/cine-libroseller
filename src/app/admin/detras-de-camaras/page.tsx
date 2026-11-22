import { sql } from '@/lib/db';
import { getViewer } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/core';
import { ActionForm, ActButton } from '../ui';
import { Panel, Field, Select } from '../blocks';
import { saveComparisonAction, approveComparisonAction } from '../actions';
import { BeforeAfter } from '@/components/interactive';

export default async function ComparisonsAdmin() {
  const [items, titles, viewer] = await Promise.all([
    sql`select c.*, t.title from media_comparisons c left join titles t on t.id = c.title_id order by c.created_at desc`,
    sql`select id, title from titles order by title`, getViewer(),
  ]);
  return (
    <div className="grid gap-6">
      <div><h1 className="display text-3xl">Antes / después</h1><p className="text-sm text-dim">Sólo se publican comparaciones aprobadas por administración y con la autorización registrada.</p></div>
      <div className="grid gap-6 lg:grid-cols-2">
        {items.map((c) => (
          <Panel key={c.id} title={c.label} actions={c.approved_for_public ? <span className="text-sm text-ok">Pública</span> : <span className="text-sm text-warn">No pública</span>}>
            <BeforeAfter before={c.before_url} after={c.after_url} label={c.label} />
            <p className="mt-3 text-sm text-mist">{c.title ?? 'Sin obra asociada'} · Autorización: {c.rights_note ?? <span className="text-warn">sin registrar</span>}</p>
            {isAdmin(viewer) && <div className="mt-3"><ActButton className="btn btn-ghost btn-sm" onAct={approveComparisonAction.bind(null, c.id, !c.approved_for_public)}>{c.approved_for_public ? 'Retirar del portal' : 'Aprobar para el portal'}</ActButton></div>}
          </Panel>
        ))}
      </div>
      <Panel title="Nueva comparación">
        <ActionForm action={saveComparisonAction} className="grid gap-3 sm:grid-cols-2" resetOnOk>
          <Field label="Descripción breve" name="label" required placeholder="Plaza colonial: locación real y plano final" />
          <Select label="Obra" name="title_id" options={[['', '—'], ...titles.map((t) => [t.id, t.title] as [string, string])]} />
          <Select label="Categoría" name="category" options={[['vfx', 'VFX'], ['set', 'Escenario'], ['actor', 'Intérprete'], ['character_design', 'Diseño de personaje'], ['storyboard', 'Storyboard']]} />
          <Field label="Autorización (quién y cuándo autorizó la difusión)" name="rights_note" placeholder="Autorización firmada por el intérprete el 12/11/2026" />
          <div><label className="label" htmlFor="before">Imagen «antes»</label><input id="before" name="before" type="file" accept="image/*" required className="field text-sm" /></div>
          <div><label className="label" htmlFor="after">Imagen «después»</label><input id="after" name="after" type="file" accept="image/*" required className="field text-sm" /></div>
          <div className="sm:col-span-2"><Field label="Explicación (opcional)" name="description" /></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
