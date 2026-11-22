import { sql } from '@/lib/db';
import { STATUS_LABEL, formatDate } from '@/lib/format';
import { ActionForm, ActButton } from '../ui';
import { Panel, Field, Select } from '../blocks';
import { saveSectionAction, moveSectionAction, deleteSectionAction, saveFeaturedAction, toggleFeaturedAction } from '../actions';

const KINDS: [string, string][] = [
  ['spotlight', 'Obra destacada (bloque editorial)'], ['continue_watching', 'Continúa viendo'], ['by_type', 'Por tipo'], ['by_genre', 'Por género'],
  ['by_category', 'Por categoría'], ['collection', 'Colección'], ['manual', 'Selección manual'], ['new_episodes', 'Nuevos episodios'],
  ['upcoming', 'Próximos estrenos'], ['recent', 'Estrenos recientes'], ['most_viewed', 'Más vistos'], ['recommended', 'Recomendados para ti'], ['behind_scenes', 'Detrás de cámaras'],
];

export default async function HomepageAdmin() {
  const [sections, titles, genres, categories, collections, featured] = await Promise.all([
    sql`select s.*, (select array_agg(title_id order by position) from homepage_section_items i where i.section_id = s.id) as items from homepage_sections s order by position, created_at`,
    sql`select id, title, status from titles order by title`, sql`select slug, name from genres order by position`,
    sql`select slug, name from categories order by position`, sql`select slug, name from collections order by name`,
    sql`select f.*, t.title from featured_content f join titles t on t.id = f.title_id order by f.is_active desc, f.position, f.created_at desc`,
  ]);
  const titleOpts: [string, string][] = titles.map((t) => [t.id, `${t.title} (${STATUS_LABEL[t.status]})`]);
  const dt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16) : '');
  return (
    <div className="grid gap-6">
      <div><h1 className="display text-3xl">Portada</h1><p className="text-sm text-dim">Ordena, oculta y programa secciones. Las secciones sin contenido publicado no se muestran al público.</p></div>
      <Panel title="Gran estreno (billboard principal)">
        <p className="mb-3 text-sm text-dim">Si no hay ninguno activo, se usa la última obra publicada. Sólo se muestran obras publicadas.</p>
        {featured.length > 0 && <ul className="mb-4 divide-y divide-line text-sm">{featured.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2"><span>{f.title}{f.headline && ` — «${f.headline}»`} <span className="text-dim">{f.starts_at ? `desde ${formatDate(f.starts_at)}` : ''} {f.ends_at ? `hasta ${formatDate(f.ends_at)}` : ''}</span></span>
            <ActButton onAct={toggleFeaturedAction.bind(null, f.id, !f.is_active)}>{f.is_active ? 'Desactivar' : 'Activar'}</ActButton></li>))}</ul>}
        <ActionForm action={saveFeaturedAction} className="grid gap-3 sm:grid-cols-4 sm:items-end" submit="Destacar" resetOnOk>
          <Select label="Obra" name="title_id" options={titleOpts} />
          <Field label="Antetítulo" name="headline" placeholder="Gran estreno" />
          <Field label="Desde" name="starts_at" type="datetime-local" />
          <Field label="Hasta" name="ends_at" type="datetime-local" />
        </ActionForm>
      </Panel>
      {sections.map((s, i) => {
        const c = s.config as Record<string, string>;
        return (
          <Panel key={s.id} title={`${i + 1}. ${s.heading}`} actions={<span className="flex gap-2">
            <ActButton onAct={moveSectionAction.bind(null, s.id, -1)}>↑</ActButton><ActButton onAct={moveSectionAction.bind(null, s.id, 1)}>↓</ActButton>
            <ActButton className="btn btn-ghost btn-sm text-bad" onAct={deleteSectionAction.bind(null, s.id)} confirmText="¿Eliminar esta sección?">Eliminar</ActButton></span>}>
            <SectionForm id={s.id} s={s} c={c} titleOpts={titleOpts} genres={genres} categories={categories} collections={collections} dt={dt} />
          </Panel>
        );
      })}
      <Panel title="Nueva sección"><SectionForm id={null} s={null} c={{}} titleOpts={titleOpts} genres={genres} categories={categories} collections={collections} dt={dt} /></Panel>
    </div>
  );
}

function SectionForm({ id, s, c, titleOpts, genres, categories, collections, dt }: {
  id: string | null; s: Record<string, any> | null; c: Record<string, string>; titleOpts: [string, string][]; // eslint-disable-line @typescript-eslint/no-explicit-any
  genres: Record<string, string>[]; categories: Record<string, string>[]; collections: Record<string, string>[]; dt: (d: Date | null) => string;
}) {
  const items = new Set<string>(s?.items ?? []);
  return (
    <ActionForm action={saveSectionAction.bind(null, id)} className="grid gap-3" resetOnOk={!id}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Select label="Tipo de sección" name="kind" defaultValue={s?.kind ?? 'manual'} options={KINDS} />
        <Field label="Título" name="heading" defaultValue={s?.heading} required />
        <Field label="Subtítulo" name="subheading" defaultValue={s?.subheading} />
        <Field label="Máx. elementos" name="limit" type="number" min={1} max={48} defaultValue={c.limit} />
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        <Select label="Obra (destacada)" name="title_id" defaultValue={c.title_id} options={[['', '—'], ...titleOpts]} />
        <Select label="Tipo de obra" name="type" defaultValue={c.type} options={[['', '—'], ['movie', 'Películas'], ['series', 'Series'], ['short', 'Cortos'], ['documentary', 'Documentales'], ['special', 'Especiales']]} />
        <Select label="Género" name="genre" defaultValue={c.genre} options={[['', '—'], ...genres.map((g) => [g.slug, g.name] as [string, string])]} />
        <Select label="Categoría" name="category" defaultValue={c.category} options={[['', '—'], ...categories.map((g) => [g.slug, g.name] as [string, string])]} />
        <Select label="Colección" name="collection" defaultValue={c.collection} options={[['', '—'], ...collections.map((g) => [g.slug, g.name] as [string, string])]} />
      </div>
      {(s?.kind ?? 'manual') === 'manual' && (
        <fieldset><legend className="label">Obras (selección manual)</legend>
          <div className="flex flex-wrap gap-3">{titleOpts.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" name="items" value={v} defaultChecked={items.has(v)} className="accent-[var(--color-gold)]" />{l}</label>)}</div>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <Field label="Mostrar desde" name="starts_at" type="datetime-local" defaultValue={dt(s?.starts_at ?? null)} />
        <Field label="Mostrar hasta" name="ends_at" type="datetime-local" defaultValue={dt(s?.ends_at ?? null)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_visible" defaultChecked={s ? s.is_visible : true} className="accent-[var(--color-gold)]" /> Visible</label>
      </div>
    </ActionForm>
  );
}
