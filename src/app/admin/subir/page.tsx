// Asistente «Subir episodio»: todo lo necesario para publicar un episodio, en orden y en una sola pantalla.
import Link from 'next/link';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { titleReadiness, episodeReadiness } from '@/lib/catalog/admin';
import { localUploadsAvailable } from '@/lib/video/service';
import { episodePath } from '@/lib/format';
import { ActionForm, StatusPill } from '../ui';
import { Field, TextArea, StatusControls, VideoPanel, ImagePanel, SubtitlePanel } from '../blocks';
import { saveSynopsisAction, addRightsAction, titleStatusAction, episodeStatusAction } from '../actions';

export const metadata = { title: 'Subir episodio' };

function Step({ n, title, done, optional, children }: { n: number; title: string; done: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card overflow-hidden ${done ? 'border-ok/30' : ''}`} aria-labelledby={`paso-${n}`}>
      <header className="flex items-center gap-4 border-b border-line px-5 py-4 sm:px-6">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? 'bg-ok text-ink' : 'bg-gold text-ink'}`} aria-hidden>{done ? '✓' : n}</span>
        <div>
          <h2 id={`paso-${n}`} className="font-semibold">Paso {n} · {title}</h2>
          <p className="text-xs text-dim">{done ? 'Completado' : optional ? 'Opcional' : 'Pendiente'}</p>
        </div>
      </header>
      <div className="grid gap-5 p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default async function UploadWizard({ searchParams }: { searchParams: Promise<{ episodio?: string }> }) {
  const { episodio } = await searchParams;
  const episodes = await sql`select e.id, e.number, e.name, e.status, s.number as season, t.id as title_id, t.title, t.slug
    from episodes e join seasons s on s.id = e.season_id join titles t on t.id = e.title_id order by t.title, s.number, e.number`;
  const inaugural = episodes.find((e) => e.slug === 'los-convidados-al-agape' && e.season === 1 && e.number === 1);
  const ep = episodes.find((e) => e.id === episodio) ?? inaugural ?? episodes[0];
  if (!ep) {
    return <div className="grid gap-4"><h1 className="display text-3xl">Subir episodio</h1><p className="text-mist">Todavía no hay episodios. Crea una serie y sus episodios en <Link href="/admin/titulos" className="text-gold-soft underline">Títulos</Link>.</p></div>;
  }
  const [[t], [e], [rights], imgs, [current], subs, thumbs] = await Promise.all([
    sql`select * from titles where id = ${ep.title_id}`,
    sql`select * from episodes where id = ${ep.id}`,
    sql`select 1 from content_rights where title_id = ${ep.title_id} and verified and rights_type in ('distribution', 'streaming') and (ends_at is null or ends_at >= current_date)`,
    sql`select kind from media_images where owner_type = 'title' and owner_id = ${ep.title_id} and is_public`,
    sql`select status from video_assets where owner_type = 'episode' and owner_id = ${ep.id} and is_current and status in ('ready', 'published')`,
    sql`select 1 from subtitle_tracks where owner_type = 'episode' and owner_id = ${ep.id}`,
    sql`select 1 from media_images where owner_type = 'episode' and owner_id = ${ep.id}`,
  ]);
  const kinds = new Set(imgs.map((i) => i.kind));
  const [titleMissing, episodeMissing] = await Promise.all([titleReadiness(t.id), episodeReadiness(e.id)]);
  const textsDone = !!t.synopsis_short;
  const imagesDone = kinds.has('poster') && (kinds.has('backdrop') || kinds.has('banner'));
  const seriesDone = t.status === 'published';
  const videoDone = !!current;
  const publishedDone = e.status === 'published' || e.status === 'scheduled';
  const publicHref = episodePath(ep.slug, ep.season, ep.number);
  const localOk = localUploadsAvailable().ok;
  const doneCount = [textsDone, imagesDone, !!rights, seriesDone, videoDone, publishedDone].filter(Boolean).length;

  return (
    <div className="grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Asistente</p>
          <h1 className="display mt-1 text-3xl sm:text-4xl">Subir episodio</h1>
          <p className="mt-1 text-mist">{ep.title} · T{ep.season}:E{ep.number} «{ep.name}»</p>
        </div>
        <form className="flex items-end gap-2" action="/admin/subir">
          <div><label className="label" htmlFor="episodio">Cambiar de episodio</label>
            <select id="episodio" name="episodio" defaultValue={ep.id} className="field">
              {episodes.map((x) => <option key={x.id} value={x.id}>{x.title} · T{x.season}:E{x.number} {x.name}</option>)}
            </select></div>
          <button className="btn btn-ghost btn-sm">Ir</button>
        </form>
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={6} aria-label="Progreso del asistente">
          <div className="h-full bg-gold transition-all" style={{ width: `${(doneCount / 6) * 100}%` }} />
        </div>
        <span className="text-sm tabular-nums text-mist">{doneCount} de 6 pasos</span>
        {publishedDone && e.status === 'published' && <a href={publicHref} target="_blank" className="btn btn-gold btn-sm">Ver en el portal ↗</a>}
      </div>

      <Step n={1} title="Textos de la serie" done={textsDone}>
        <ActionForm action={saveSynopsisAction.bind(null, t.id)} className="grid gap-4" submit="Guardar textos">
          <TextArea label="Sinopsis corta * (portada y buscadores, máx. 400 caracteres)" name="synopsis_short" defaultValue={t.synopsis_short} rows={2} maxLength={400} />
          <TextArea label="Sinopsis completa" name="synopsis_long" defaultValue={t.synopsis_long} rows={4} maxLength={6000} />
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Eslogan (opcional)" name="tagline" defaultValue={t.tagline} maxLength={200} />
            <Field label="Clasificación por edades" name="age_rating" defaultValue={t.age_rating} placeholder="+13" />
          </div>
        </ActionForm>
      </Step>

      <Step n={2} title="Póster e imagen horizontal de la serie" done={imagesDone}>
        <ul className="flex flex-wrap gap-3 text-sm">
          <li className={kinds.has('poster') ? 'text-ok' : 'text-warn'}>{kinds.has('poster') ? '✓' : '○'} Póster vertical (2:3)</li>
          <li className={kinds.has('backdrop') || kinds.has('banner') ? 'text-ok' : 'text-warn'}>{kinds.has('backdrop') || kinds.has('banner') ? '✓' : '○'} Imagen horizontal (16:9)</li>
        </ul>
        <ImagePanel ownerType="title" ownerId={t.id} kinds={['poster', 'backdrop', 'banner', 'logo']} title="Imágenes de la serie" />
      </Step>

      <Step n={3} title="Derechos de streaming" done={!!rights}>
        {rights ? <p className="text-sm text-ok">✓ Hay un derecho de streaming verificado y vigente.</p> : (
          <ActionForm action={addRightsAction.bind(null, t.id)} className="grid gap-3 sm:grid-cols-2 sm:items-end" submit="Registrar derechos">
            <input type="hidden" name="rights_type" value="streaming" />
            <Field label="Titular de los derechos" name="holder" required defaultValue="Cine LibroSeller Studios" />
            <Field label="Territorios (vacío = todo el mundo)" name="territories" placeholder="DO, US, MX" />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="verified" required className="accent-[var(--color-gold)]" /> Confirmo que la productora tiene los derechos para difundir esta obra en streaming</label>
          </ActionForm>
        )}
      </Step>

      <Step n={4} title="Publicar la serie" done={seriesDone}>
        <p className="text-sm text-mist">La página de la serie puede publicarse antes que el episodio: mostrará «Primer episodio próximamente» hasta que lo publiques en el paso 6.</p>
        <StatusControls status={t.status} publishAt={t.publish_at} missing={titleMissing} action={titleStatusAction.bind(null, t.id) as never} />
      </Step>

      <Step n={5} title="Video del episodio" done={videoDone}>
        {env.mux.configured ? (
          <p className="text-sm text-mist">
            Sube el archivo maestro. Mux lo convierte en streaming adaptativo (tarda unos minutos); esta página se actualiza sola.
            Cuando aparezca <strong className="text-cream">«En revisión»</strong>, pulsa <strong className="text-cream">Previsualizar</strong> y después <strong className="text-cream">Aprobar video</strong>.
          </p>
        ) : localOk ? (
          <p className="text-sm text-mist">
            <strong className="text-cream">Modo local de prueba (sin Mux).</strong> Arrastra el MP4 del episodio (H.264 + AAC): se guarda en este equipo y queda
            <strong className="text-cream"> «En revisión»</strong> en cuanto termina la subida. Pulsa <strong className="text-cream">Previsualizar</strong> y después <strong className="text-cream">Aprobar video</strong>.
          </p>
        ) : (
          <p className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm text-warn">Para subir el archivo, pon STORAGE_DRIVER=local en .env.local (prueba en tu PC) o configura Mux. Reinicia «npm run dev» después.</p>
        )}
        <VideoPanel ownerType="episode" ownerId={e.id} previewHref={`${publicHref}/ver`} />
      </Step>

      <Step n={6} title="Publicar el episodio" done={publishedDone}>
        {e.status === 'published' ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="published" /><span className="text-sm text-ok">¡Publicado! Ya se puede ver en el portal.</span>
            <a href={publicHref} target="_blank" className="btn btn-gold btn-sm">Abrir el episodio ↗</a>
            <a href={`${publicHref}/ver`} target="_blank" className="btn btn-ghost btn-sm">Reproducir ↗</a>
          </div>
        ) : (
          <StatusControls status={e.status} publishAt={e.publish_at} missing={episodeMissing} action={episodeStatusAction.bind(null, e.id) as never} />
        )}
      </Step>

      <Step n={7} title="Subtítulos y miniatura" done={subs.length > 0 && thumbs.length > 0} optional>
        <SubtitlePanel ownerType="episode" ownerId={e.id} />
        <ImagePanel ownerType="episode" ownerId={e.id} kinds={['thumbnail', 'still']} title="Miniatura del episodio (16:9)" />
      </Step>

      <p className="text-sm text-dim">¿Necesitas más opciones (reparto, personajes, tráiler, fechas de estreno)? Están en <Link href={`/admin/titulos/${t.id}`} className="text-gold-soft underline">la ficha completa del título</Link>.</p>
    </div>
  );
}
