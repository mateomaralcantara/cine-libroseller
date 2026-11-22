import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { titleReadiness } from '@/lib/catalog/admin';
import { TYPE_LABEL, AI_LABEL, ACCESS_LABEL, CREDIT_ROLE_LABEL, TRAILER_KIND_LABEL, titlePath, formatDate, episodePath } from '@/lib/format';
import { ActionForm, ActButton, StatusPill } from '../../ui';
import { Panel, Field, TextArea, Select, StatusControls, VideoPanel, ImagePanel, SubtitlePanel } from '../../blocks';
import {
  updateTitleAction, titleStatusAction, createSeasonAction, createEpisodeAction, saveTrailerAction, addCreditAction, removeCreditAction,
  saveCharacterAction, addRightsAction, deleteRightsAction, availabilityAction, updateLinksAction, updateSeasonAction,
} from '../../actions';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; personaje?: string }> };

export default async function TitleEditor({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [t] = await sql`select * from titles where id = ${id}`;
  if (!t) notFound();
  const isSeries = t.type === 'series';
  const tabs: [string, string][] = [['ficha', 'Ficha'], ['medios', 'Imágenes'], ...(isSeries ? [['temporadas', 'Temporadas y episodios']] : [['video', 'Video y subtítulos']]) as [string, string][],
    ['extras', 'Tráilers y extras'], ['reparto', 'Reparto y personajes'], ['derechos', 'Derechos y disponibilidad']];
  const tab = tabs.some(([k]) => k === sp.tab) ? sp.tab! : 'ficha';
  const missing = await titleReadiness(id);
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/titulos" className="text-sm text-dim hover:text-cream">← Títulos</Link>
          <h1 className="display mt-1 text-3xl">{t.title}</h1>
          <p className="text-sm text-dim">{TYPE_LABEL[t.type]} · /{t.slug}</p>
        </div>
        <div className="flex items-center gap-3"><StatusPill status={t.status} />{t.status === 'published' && <a href={titlePath(t as never)} target="_blank" className="btn btn-ghost btn-sm">Ver ficha pública ↗</a>}</div>
      </div>
      <Panel title="Publicación"><StatusControls status={t.status} publishAt={t.publish_at} missing={missing} action={titleStatusAction.bind(null, id) as never} /></Panel>
      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Secciones del título">
        {tabs.map(([k, l]) => <Link key={k} href={`/admin/titulos/${id}?tab=${k}`} aria-current={tab === k ? 'page' : undefined} className={`shrink-0 border-b-2 px-4 py-2.5 text-sm ${tab === k ? 'border-gold text-cream' : 'border-transparent text-mist hover:text-cream'}`}>{l}</Link>)}
      </nav>
      {tab === 'ficha' && <FichaTab t={t} />}
      {tab === 'medios' && <ImagePanel ownerType="title" ownerId={id} kinds={['poster', 'backdrop', 'banner', 'logo', 'social', 'gallery', 'behind_scenes']} />}
      {tab === 'video' && (<><VideoPanel ownerType="title" ownerId={id} previewHref={`/peliculas/${t.slug}/ver`} /><SubtitlePanel ownerType="title" ownerId={id} /></>)}
      {tab === 'temporadas' && <SeasonsTab titleId={id} slug={t.slug} />}
      {tab === 'extras' && <ExtrasTab titleId={id} />}
      {tab === 'reparto' && <CastTab titleId={id} editing={sp.personaje} />}
      {tab === 'derechos' && <RightsTab titleId={id} />}
    </div>
  );
}

async function FichaTab({ t }: { t: Record<string, any> }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [genres, categories, tg, tc] = await Promise.all([
    sql`select id, name from genres order by position`, sql`select id, name from categories order by position`,
    sql`select genre_id from title_genres where title_id = ${t.id}`, sql`select category_id from title_categories where title_id = ${t.id}`,
  ]);
  const gset = new Set(tg.map((g) => g.genre_id)); const cset = new Set(tc.map((c) => c.category_id));
  const book = (t.source_book ?? {}) as Record<string, string>;
  const date = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  return (
    <>
      <Panel title="Ficha de producción">
        <ActionForm action={updateTitleAction.bind(null, t.id)} className="grid gap-5" submit="Guardar ficha">
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Tipo" name="type" defaultValue={t.type} options={Object.entries(TYPE_LABEL)} />
            <Field label="Nombre oficial" name="title" defaultValue={t.title} required />
            <Field label="Slug (URL)" name="slug" defaultValue={t.slug} help="Cambiarlo rompe enlaces ya compartidos." />
            <Field label="Título internacional" name="international_title" defaultValue={t.international_title} />
            <Field label="Eslogan" name="tagline" defaultValue={t.tagline} maxLength={200} />
            <Field label="Clasificación por edades" name="age_rating" defaultValue={t.age_rating} placeholder="Ej.: +13" />
          </div>
          <TextArea label="Sinopsis corta (portada, buscadores, redes)" name="synopsis_short" defaultValue={t.synopsis_short} rows={2} maxLength={400} />
          <TextArea label="Sinopsis completa" name="synopsis_long" defaultValue={t.synopsis_long} rows={6} maxLength={6000} />
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Fecha de producción" name="production_date" type="date" defaultValue={date(t.production_date)} />
            <Field label="Fecha de estreno" name="release_date" type="date" defaultValue={date(t.release_date)} />
            <Field label={isSeriesLabel(t.type)} name="runtime_minutes" type="number" min={1} defaultValue={t.runtime_minutes} />
            <Field label="País" name="country" defaultValue={t.country} />
            <Field label="Idioma original" name="original_language" defaultValue={t.original_language} />
            <Field label="Idiomas de audio" name="languages" defaultValue={(t.languages as string[]).join(', ')} help="Códigos separados por comas: es, en" />
            <Field label="Productora" name="production_company" defaultValue={t.production_company} />
            <Select label="Acceso" name="access" defaultValue={t.access} options={Object.entries(ACCESS_LABEL)} />
          </div>
          <fieldset className="grid gap-3"><legend className="label">Géneros</legend>
            <div className="flex flex-wrap gap-3">{genres.map((g) => <label key={g.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="genre_ids" value={g.id} defaultChecked={gset.has(g.id)} className="accent-[var(--color-gold)]" />{g.name}</label>)}</div>
          </fieldset>
          <fieldset className="grid gap-3"><legend className="label">Categorías editoriales</legend>
            <div className="flex flex-wrap gap-3">{categories.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="category_ids" value={c.id} defaultChecked={cset.has(c.id)} className="accent-[var(--color-gold)]" />{c.name}</label>)}</div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Select label="Uso de inteligencia artificial" name="ai_disclosure" defaultValue={t.ai_disclosure} options={Object.entries(AI_LABEL)} help="Se muestra al público en la ficha." />
            <Field label="Detalle del uso de IA" name="ai_disclosure_note" defaultValue={t.ai_disclosure_note} placeholder="Ej.: rejuvenecimiento autorizado del intérprete en escenas de flashback." />
          </div>
          <fieldset className="grid gap-4 rounded-xl border border-line p-4"><legend className="px-2 text-sm text-gold-soft">Libro original (LibroSeller)</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Título del libro" name="book_title" defaultValue={book.title} />
              <Field label="Autor/a" name="book_author" defaultValue={book.author} />
              <Field label="Editorial" name="book_publisher" defaultValue={book.publisher} />
              <Field label="URL de la portada" name="book_cover_url" type="url" defaultValue={book.cover_url} />
              <Field label="Enlace de compra" name="book_purchase_url" type="url" defaultValue={book.purchase_url} />
              <Field label="ID en LibroSeller" name="book_libroseller_id" defaultValue={book.libroseller_id} />
            </div>
            <TextArea label="Sinopsis del libro" name="book_synopsis" defaultValue={book.synopsis} rows={3} />
            <Field label="Relación con la adaptación" name="book_relation" defaultValue={book.relation} placeholder="Ej.: adaptación libre de los capítulos 1 a 4" />
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Metatítulo (SEO)" name="seo_title" defaultValue={t.seo_title} maxLength={70} />
            <Field label="Metadescripción (SEO)" name="seo_description" defaultValue={t.seo_description} maxLength={170} />
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Enlaces relacionados">
        <ActionForm action={updateLinksAction.bind(null, t.id)}>
          <TextArea label="Un enlace por línea: Texto | https://…" name="links" rows={3} defaultValue={(t.related_links as { label: string; url: string }[]).map((l) => `${l.label} | ${l.url}`).join('\n')} />
        </ActionForm>
      </Panel>
    </>
  );
}
const isSeriesLabel = (type: string) => (type === 'series' ? 'Duración media por episodio (min)' : 'Duración (min)');

async function SeasonsTab({ titleId, slug }: { titleId: string; slug: string }) {
  const seasons = await sql`select * from seasons where title_id = ${titleId} order by number`;
  const eps = await sql`select e.*, (select status from video_assets va where va.owner_type = 'episode' and va.owner_id = e.id order by is_current desc, version desc limit 1) as video_status
    from episodes e where e.title_id = ${titleId} order by e.number`;
  return (
    <div className="grid gap-6">
      {seasons.map((s) => (
        <Panel key={s.id} title={`Temporada ${s.number}${s.name ? ` · ${s.name}` : ''}`} actions={<StatusPill status={s.status} />}>
          <ul className="mb-5 divide-y divide-line">
            {eps.filter((e) => e.season_id === s.id).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link href={`/admin/episodios/${e.id}`} className="font-medium hover:text-gold-soft">E{e.number} · {e.name}</Link>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <StatusPill status={e.status} />
                  {e.video_status ? <StatusPill status={e.video_status} video /> : <span className="text-warn">Sin video</span>}
                  {e.status === 'published' && <a href={episodePath(slug, s.number, e.number)} target="_blank" className="text-gold-soft">Ver ↗</a>}
                </span>
              </li>
            ))}
          </ul>
          <details className="mb-4"><summary className="cursor-pointer text-sm text-gold-soft">Editar datos de la temporada</summary>
            <ActionForm action={updateSeasonAction.bind(null, s.id)} className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Número" name="number" type="number" defaultValue={s.number} min={1} />
              <Field label="Nombre" name="name" defaultValue={s.name} />
              <Field label="Estreno" name="release_date" type="date" defaultValue={s.release_date ? new Date(s.release_date).toISOString().slice(0, 10) : ''} />
              <div className="sm:col-span-3"><TextArea label="Sinopsis de la temporada" name="synopsis" defaultValue={s.synopsis} rows={2} /></div>
            </ActionForm>
          </details>
          <ActionForm action={createEpisodeAction.bind(null, s.id)} className="grid gap-3 sm:grid-cols-[0.5fr_2fr_0.8fr_auto] sm:items-end" submit="Añadir episodio">
            <Field label="Nº" name="number" type="number" min={1} required defaultValue={(eps.filter((e) => e.season_id === s.id).at(-1)?.number ?? 0) + 1} />
            <Field label="Nombre del episodio" name="name" required />
            <Field label="Duración (min)" name="runtime_minutes" type="number" min={1} />
          </ActionForm>
        </Panel>
      ))}
      <Panel title="Nueva temporada">
        <ActionForm action={createSeasonAction.bind(null, titleId)} className="grid gap-3 sm:grid-cols-[0.5fr_2fr_auto] sm:items-end" submit="Crear temporada">
          <Field label="Nº" name="number" type="number" min={1} required defaultValue={(seasons.at(-1)?.number ?? 0) + 1} />
          <Field label="Nombre (opcional)" name="name" />
        </ActionForm>
      </Panel>
    </div>
  );
}

async function ExtrasTab({ titleId }: { titleId: string }) {
  const [extras, episodes] = await Promise.all([
    sql`select tr.*, (select status from video_assets va where va.owner_type = 'trailer' and va.owner_id = tr.id order by is_current desc, version desc limit 1) as video_status
      from trailers tr where tr.title_id = ${titleId} order by tr.is_primary desc, tr.position, tr.created_at`,
    sql`select e.id, e.number, s.number as season from episodes e join seasons s on s.id = e.season_id where e.title_id = ${titleId} order by s.number, e.number`,
  ]);
  return (
    <div className="grid gap-6">
      <Panel title="Tráilers, teasers y material complementario">
        {extras.length ? (
          <ul className="divide-y divide-line">{extras.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <Link href={`/admin/extras/${x.id}`} className="font-medium hover:text-gold-soft">{x.name}{x.is_primary && <span className="ml-2 text-xs text-gold">principal</span>}</Link>
              <span className="flex items-center gap-2 text-xs">{TRAILER_KIND_LABEL[x.kind]} · {x.is_published ? <span className="text-ok">Publicado</span> : <span className="text-dim">No publicado</span>}
                {x.video_status ? <StatusPill status={x.video_status} video /> : <span className="text-warn">Sin video</span>}</span>
            </li>))}</ul>
        ) : <p className="text-sm text-dim">Aún no hay tráilers ni extras.</p>}
      </Panel>
      <Panel title="Nuevo extra">
        <ActionForm action={saveTrailerAction.bind(null, titleId, null)} className="grid gap-3 sm:grid-cols-3 sm:items-end" submit="Crear y subir video">
          <Field label="Nombre" name="name" required placeholder="Tráiler oficial" />
          <Select label="Tipo" name="kind" options={Object.entries(TRAILER_KIND_LABEL)} />
          <Select label="Episodio (opcional)" name="episode_id" options={[['', 'De toda la obra'], ...episodes.map((e) => [e.id, `T${e.season}:E${e.number}`] as [string, string])]} />
          <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" name="is_primary" className="accent-[var(--color-gold)]" /> Tráiler principal</label>
        </ActionForm>
      </Panel>
    </div>
  );
}

async function CastTab({ titleId, editing }: { titleId: string; editing?: string }) {
  const [credits, people, characters, episodes] = await Promise.all([
    sql`select tc.*, p.name, c.name as character_name from title_credits tc join people p on p.id = tc.person_id left join characters c on c.id = tc.character_id where tc.title_id = ${titleId} order by tc.role, tc.position`,
    sql`select id, name from people order by name`,
    sql`select * from characters where title_id = ${titleId} order by position, name`,
    sql`select e.id, e.number, e.name, s.number as season from episodes e join seasons s on s.id = e.season_id where e.title_id = ${titleId} order by s.number, e.number`,
  ]);
  const current = characters.find((c) => c.id === editing) ?? null;
  const appearances = current ? new Set((await sql`select episode_id from character_appearances where character_id = ${current.id}`).map((a) => a.episode_id)) : new Set();
  const peopleOpts: [string, string][] = [['', '—'], ...people.map((p) => [p.id, p.name] as [string, string])];
  return (
    <div className="grid gap-6">
      <Panel title="Reparto y equipo creativo" actions={<Link href="/admin/personas" className="text-sm text-gold-soft">Gestionar personas</Link>}>
        {credits.length > 0 && (
          <ul className="mb-5 divide-y divide-line text-sm">{credits.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2"><span><strong>{c.name}</strong> · {CREDIT_ROLE_LABEL[c.role]}{c.character_name && ` (${c.character_name})`}{c.credit_note && ` — ${c.credit_note}`}</span>
              <ActButton className="text-bad hover:underline" onAct={removeCreditAction.bind(null, c.id)}>Quitar</ActButton></li>))}</ul>
        )}
        {people.length === 0 ? <p className="text-sm text-warn">Primero crea a las personas en «Personas».</p> : (
          <ActionForm action={addCreditAction.bind(null, titleId)} className="grid gap-3 sm:grid-cols-5 sm:items-end" submit="Añadir" resetOnOk>
            <Select label="Persona" name="person_id" options={peopleOpts} />
            <Select label="Función" name="role" options={Object.entries(CREDIT_ROLE_LABEL)} />
            <Select label="Personaje (si es reparto)" name="character_id" options={[['', '—'], ...characters.map((c) => [c.id, c.name] as [string, string])]} />
            <Field label="Nota" name="credit_note" placeholder="Ej.: voz" />
            <Field label="Orden" name="position" type="number" defaultValue={credits.length} />
          </ActionForm>
        )}
      </Panel>
      <Panel title="Personajes">
        <ul className="mb-5 flex flex-wrap gap-2">{characters.map((c) => <li key={c.id}><Link href={`/admin/titulos/${titleId}?tab=reparto&personaje=${c.id}`} className={`chip ${c.id === editing ? 'chip-gold' : ''}`}>{c.name}{!c.is_published && ' (oculto)'}</Link></li>)}
          <li><Link href={`/admin/titulos/${titleId}?tab=reparto`} className="chip">+ Nuevo</Link></li></ul>
        <ActionForm key={current?.id ?? 'nuevo'} action={saveCharacterAction.bind(null, titleId, current?.id ?? null)} className="grid gap-4" submit={current ? 'Guardar personaje' : 'Crear personaje'}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" name="name" defaultValue={current?.name} required />
            <Select label="Actor / actriz" name="actor_id" defaultValue={current?.actor_id} options={peopleOpts} />
            <Field label="Identidad digital autorizada" name="digital_identity" defaultValue={current?.digital_identity} help="Si el personaje usa una identidad digital, indícalo." />
          </div>
          <TextArea label="Descripción (sin spoilers)" name="summary" defaultValue={current?.summary} rows={2} />
          <TextArea label="Historia (puede contener spoilers; se oculta tras un aviso)" name="story" defaultValue={current?.story} rows={4} />
          <TextArea label="Relaciones narrativas: «Nombre | relación» por línea" name="relationships" rows={3} defaultValue={((current?.relationships ?? []) as { name: string; relation: string }[]).map((r) => `${r.name} | ${r.relation}`).join('\n')} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Aparece por primera vez en" name="first_episode_id" defaultValue={current?.first_episode_id} options={[['', '—'], ...episodes.map((e) => [e.id, `T${e.season}:E${e.number} ${e.name}`] as [string, string])]} help="Sirve para avisar de spoilers." />
            <Field label="Orden" name="position" type="number" defaultValue={current?.position ?? characters.length} />
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_published" defaultChecked={current?.is_published} className="accent-[var(--color-gold)]" /> Visible en el portal</label>
          </div>
          {episodes.length > 0 && <fieldset><legend className="label">Episodios en los que aparece</legend><div className="flex flex-wrap gap-3">{episodes.map((e) => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="appearances" value={e.id} defaultChecked={appearances.has(e.id)} className="accent-[var(--color-gold)]" />T{e.season}:E{e.number}</label>)}</div></fieldset>}
        </ActionForm>
      </Panel>
      {current && <ImagePanel ownerType="character" ownerId={current.id} kinds={['poster', 'gallery']} title={`Imágenes de ${current.name} (la imagen «Póster» es la principal)`} />}
    </div>
  );
}

async function RightsTab({ titleId }: { titleId: string }) {
  const [rights, [avail]] = await Promise.all([
    sql`select * from content_rights where title_id = ${titleId} order by created_at`,
    sql`select * from content_availability where content_type = 'title' and content_id = ${titleId}`,
  ]);
  const dt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 16) : '');
  return (
    <div className="grid gap-6">
      <Panel title="Derechos y licencias">
        <p className="mb-4 text-sm text-dim">Para publicar hace falta al menos un derecho de distribución o streaming <strong>verificado</strong> y vigente.</p>
        {rights.length > 0 && (
          <ul className="mb-5 divide-y divide-line text-sm">{rights.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span><strong>{r.rights_type}</strong> · {r.holder} · {r.territories.length ? r.territories.join(', ') : 'Mundial'} · {r.starts_at ? formatDate(r.starts_at) : '—'} → {r.ends_at ? formatDate(r.ends_at) : 'sin fin'}
                {r.verified ? <span className="ml-2 text-ok">✓ verificado</span> : <span className="ml-2 text-warn">sin verificar</span>}
                {r.document_url && <a href={r.document_url} target="_blank" className="ml-2 text-gold-soft">documento</a>}</span>
              <ActButton className="text-bad hover:underline" onAct={deleteRightsAction.bind(null, r.id)} confirmText="¿Eliminar este registro de derechos?">Eliminar</ActButton>
            </li>))}</ul>
        )}
        <ActionForm action={addRightsAction.bind(null, titleId)} className="grid gap-3 sm:grid-cols-3" submit="Registrar" resetOnOk>
          <Select label="Tipo" name="rights_type" options={[['streaming', 'Streaming'], ['distribution', 'Distribución'], ['music', 'Música'], ['likeness', 'Imagen de intérpretes'], ['adaptation', 'Adaptación del libro'], ['other', 'Otro']]} />
          <Field label="Titular" name="holder" required defaultValue="Cine LibroSeller Studios" />
          <Field label="Territorios (ISO, vacío = mundial)" name="territories" placeholder="DO, MX, US" />
          <Field label="Desde" name="starts_at" type="date" />
          <Field label="Hasta" name="ends_at" type="date" />
          <Field label="Documento (URL privada)" name="document_url" type="url" />
          <div className="sm:col-span-2"><Field label="Notas" name="notes" /></div>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="verified" className="accent-[var(--color-gold)]" /> Verificado por el equipo legal</label>
        </ActionForm>
      </Panel>
      <Panel title="Disponibilidad territorial y ventana">
        <ActionForm action={availabilityAction.bind(null, 'title', titleId)} className="grid gap-3 sm:grid-cols-2">
          <Field label="Sólo en estos países (vacío = todos)" name="allowed_countries" defaultValue={avail?.allowed_countries?.join(', ')} placeholder="DO, MX" />
          <Field label="Bloqueado en" name="blocked_countries" defaultValue={avail?.blocked_countries?.join(', ')} />
          <Field label="Disponible desde" name="starts_at" type="datetime-local" defaultValue={dt(avail?.starts_at)} />
          <Field label="Disponible hasta" name="ends_at" type="datetime-local" defaultValue={dt(avail?.ends_at)} />
        </ActionForm>
        <p className="mt-3 text-xs text-dim">El país se obtiene de la cabecera de geolocalización de Vercel/Cloudflare. Si no hay dato y existe una lista de países permitidos, la reproducción se bloquea.</p>
      </Panel>
    </div>
  );
}
