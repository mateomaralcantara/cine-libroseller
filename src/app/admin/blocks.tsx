// Bloques de servidor reutilizables del panel.
import Image from 'next/image';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { STATUS_LABEL, formatDate } from '@/lib/format';
import { ActionForm, ActButton, StatusPill, AutoRefresh, DirectUploader, Duration } from './ui';
import {
  uploadImageAction, deleteImageAction, uploadSubtitleAction, deleteSubtitleAction, linkVideoAction, approveVideoAction, refreshVideoAction, makePublicVideoAction,
} from './actions';
import { TrailerButton } from '@/components/interactive';
import { localUploadsAvailable, type OwnerType } from '@/lib/video/service';

export function Panel({ title, children, actions, id }: { title: string; children: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="card p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{actions}</div>
      {children}
    </section>
  );
}

export function Field({ label, name, defaultValue, type = 'text', help, required, ...rest }: { label: string; name: string; defaultValue?: string | number | null; type?: string; help?: string; required?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label}{required && ' *'}</label>
      <input id={`f-${name}`} name={name} type={type} defaultValue={defaultValue ?? ''} required={required} className="field" {...rest} />
      {help && <p className="mt-1 text-xs text-dim">{help}</p>}
    </div>
  );
}

export function TextArea({ label, name, defaultValue, rows = 4, help, maxLength }: { label: string; name: string; defaultValue?: string | null; rows?: number; help?: string; maxLength?: number }) {
  return (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <textarea id={`f-${name}`} name={name} defaultValue={defaultValue ?? ''} rows={rows} maxLength={maxLength} className="field" />
      {help && <p className="mt-1 text-xs text-dim">{help}</p>}
    </div>
  );
}

export function Select({ label, name, defaultValue, options, help }: { label: string; name: string; defaultValue?: string | null; options: [string, string][]; help?: string }) {
  return (
    <div>
      <label className="label" htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={defaultValue ?? ''} className="field">{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {help && <p className="mt-1 text-xs text-dim">{help}</p>}
    </div>
  );
}

const NEXT_STATES: Record<string, string[]> = {
  draft: ['in_review', 'scheduled', 'published', 'archived'], in_review: ['draft', 'scheduled', 'published', 'archived'],
  scheduled: ['draft', 'published', 'withdrawn'], published: ['withdrawn', 'archived'], withdrawn: ['draft', 'scheduled', 'published', 'archived'], archived: ['draft'],
};
const VERB: Record<string, string> = { draft: 'Volver a borrador', in_review: 'Enviar a revisión', scheduled: 'Programar estreno', published: 'Publicar ahora', withdrawn: 'Retirar de publicación', archived: 'Archivar' };

/** Estado editorial: requisitos pendientes y transiciones permitidas. */
export function StatusControls({ status, publishAt, missing, action }: { status: string; publishAt: Date | null; missing: string[]; action: (p: never, f: FormData) => Promise<never> }) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={status} />
        {status === 'scheduled' && publishAt && <span className="text-sm text-mist">Se publica el {formatDate(publishAt, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {missing.length > 0 ? (
        <div className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm">
          <p className="font-medium text-warn">Pendiente para publicar (oculto en el portal mientras tanto):</p>
          <ul className="mt-1 list-disc pl-5 text-mist">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : status !== 'published' && <p className="text-sm text-ok">✓ Todo listo para publicar.</p>}
      <ActionForm action={action as never} className="flex flex-wrap items-end gap-3" submit={null}>
        <div>
          <label className="label" htmlFor="to">Cambiar a</label>
          <select id="to" name="to" className="field" defaultValue={NEXT_STATES[status]?.[0]}>{NEXT_STATES[status]?.map((s) => <option key={s} value={s}>{VERB[s]}</option>)}</select>
        </div>
        <div>
          <label className="label" htmlFor="publish_at">Fecha y hora de estreno (si se programa)</label>
          <input id="publish_at" name="publish_at" type="datetime-local" className="field" />
        </div>
        <button className="btn btn-gold btn-sm">Aplicar</button>
      </ActionForm>
      <p className="text-xs text-dim">Estados: {Object.values(STATUS_LABEL).join(' → ')}.</p>
    </div>
  );
}

/** Gestión del video de una obra: subida/vínculo, procesamiento, previsualización privada, aprobación e historial. */
export async function VideoPanel({ ownerType, ownerId, previewHref }: { ownerType: OwnerType; ownerId: string; previewHref?: string | null }) {
  const assets = await sql`select va.*, j.status as job_status, j.file_size, j.error_message as job_error from video_assets va
    left join media_upload_jobs j on j.video_asset_id = va.id where va.owner_type = ${ownerType} and va.owner_id = ${ownerId} order by va.version desc`;
  const processing = assets.some((a) => ['pending', 'uploading', 'processing'].includes(a.status));
  const current = assets.find((a) => a.is_current);
  const review = assets.find((a) => a.status === 'in_review');
  const link = linkVideoAction.bind(null, ownerType, ownerId);
  const local = localUploadsAvailable();
  return (
    <Panel title="Video" actions={current ? <span className="text-sm text-mist">Versión vigente: v{current.version} · <Duration seconds={current.duration_seconds} /> · {current.max_resolution ?? '—'}</span> : <span className="text-sm text-warn">Sin video aprobado</span>}>
      <AutoRefresh active={processing} every={8000} assetIds={assets.filter((a) => ['uploading', 'processing'].includes(a.status)).map((a) => a.id)} />
      {review && (
        <div className="mb-5 rounded-xl border border-warn/40 bg-warn/5 p-4">
          <p className="font-medium text-warn">Versión v{review.version} procesada: revísala antes de aprobarla.</p>
          {review.playback_policy === 'signed' && !env.mux.signingKeyId && (
            <div className="mt-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
              Este video se subió con <strong>reproducción firmada</strong>, pero faltan las claves de firma de Mux (MUX_SIGNING_KEY_ID y MUX_SIGNING_PRIVATE_KEY): no se podría ver.
              Si el contenido es gratuito, hazlo público (no hace falta volver a subirlo):
              <div className="mt-2"><ActButton className="btn btn-gold btn-sm" onAct={makePublicVideoAction.bind(null, review.id)}>Hacer pública la reproducción</ActButton></div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {ownerType === 'trailer'
              ? <TrailerButton trailerId={ownerId} label="Previsualizar" className="btn btn-ghost btn-sm" preview />
              : previewHref && <a href={`${previewHref}?preview=1`} target="_blank" className="btn btn-ghost btn-sm">Previsualizar (privado) ↗</a>}
            <ActButton className="btn btn-gold btn-sm" onAct={approveVideoAction.bind(null, review.id)} confirmText="¿Aprobar esta versión? Si la obra ya está publicada, sustituirá al video actual.">Aprobar video</ActButton>
          </div>
        </div>
      )}
      {current ? (
        <details className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm text-gold-soft">Sustituir el video (sube una versión nueva; la actual sigue en el aire hasta que apruebes la nueva)</summary>
          <div className="mt-4">
      <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gold-soft">Subir archivo maestro</h3>
              <DirectUploader ownerType={ownerType} ownerId={ownerId} muxReady={env.mux.configured} localReady={local.ok} localReason={local.ok ? undefined : local.reason} signingReady={!!(env.mux.signingKeyId && env.mux.signingPrivateKey)} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gold-soft">…o vincular video ya optimizado (HLS/MP4 en CDN)</h3>
              <ActionForm action={link} submit="Verificar y vincular" resetOnOk>
                <Field label="URL del .m3u8 o .mp4" name="url" type="url" required placeholder="https://cdn.ejemplo.com/obra/master.m3u8" help="Se comprueba que responde y que es un formato reproducible. Debe permitir CORS desde este dominio." />
              </ActionForm>
            </div>
          </div>
          </div>
        </details>
      ) : (
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gold-soft">Subir archivo maestro</h3>
          <DirectUploader ownerType={ownerType} ownerId={ownerId} muxReady={env.mux.configured} localReady={local.ok} localReason={local.ok ? undefined : local.reason} signingReady={!!(env.mux.signingKeyId && env.mux.signingPrivateKey)} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gold-soft">…o vincular video ya optimizado (HLS/MP4 en CDN)</h3>
          <ActionForm action={link} submit="Verificar y vincular" resetOnOk>
            <Field label="URL del .m3u8 o .mp4" name="url" type="url" required placeholder="https://cdn.ejemplo.com/obra/master.m3u8" help="Se comprueba que responde y que es un formato reproducible. Debe permitir CORS desde este dominio." />
          </ActionForm>
        </div>
      </div>
      )}
      {assets.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-dim"><tr><th className="py-2">Versión</th><th>Proveedor</th><th>Estado</th><th>Duración</th><th>Archivo</th><th>Fecha</th><th /></tr></thead>
            <tbody className="divide-y divide-line">
              {assets.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="py-2.5">v{a.version}{a.is_current && <span className="ml-2 text-xs text-gold">vigente</span>}</td>
                  <td>{a.provider === 'mux' ? `Mux${a.playback_policy === 'signed' ? ' · firmado' : ''}` : a.provider === 'local' ? 'Local (este equipo)' : 'Enlace CDN'}</td>
                  <td><StatusPill status={a.status} video />{a.error_message && <p className="mt-1 max-w-xs text-xs text-bad">{a.error_message}</p>}</td>
                  <td><Duration seconds={a.duration_seconds} /></td>
                  <td className="max-w-[14rem] truncate text-xs text-dim">{a.original_filename ?? a.source_url}</td>
                  <td className="text-xs text-dim">{formatDate(a.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="space-y-1">
                    {['uploading', 'processing', 'error'].includes(a.status) && <ActButton onAct={refreshVideoAction.bind(null, a.id)}>Consultar proveedor</ActButton>}
                    {a.provider === 'mux' && a.playback_policy === 'signed' && a.provider_asset_id && <ActButton onAct={makePublicVideoAction.bind(null, a.id)} confirmText="¿Hacer pública la reproducción de este video? Cualquiera con el enlace del episodio publicado podrá verlo.">Hacer pública</ActButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-dim">Las versiones anteriores se conservan; sustituir el video no cambia la ficha ni las métricas de la obra.</p>
        </div>
      )}
    </Panel>
  );
}

const KIND_LABEL: Record<string, string> = {
  poster: 'Póster vertical (2:3)', backdrop: 'Imagen horizontal / fondo (16:9)', banner: 'Banner panorámico', logo: 'Logotipo del título (PNG transparente)',
  thumbnail: 'Miniatura (16:9)', still: 'Fotograma', gallery: 'Galería', behind_scenes: 'Detrás de cámaras', social: 'Imagen para redes (1200×630)',
};

export async function ImagePanel({ ownerType, ownerId, kinds, title = 'Imágenes' }: { ownerType: string; ownerId: string; kinds: string[]; title?: string }) {
  const imgs = await sql`select * from media_images where owner_type = ${ownerType} and owner_id = ${ownerId} order by kind, position, created_at`;
  return (
    <Panel title={title}>
      {imgs.length > 0 && (
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {imgs.map((i) => (
            <li key={i.id} className="overflow-hidden rounded-xl border border-line">
              <div className="relative aspect-video bg-graphite-3"><Image src={i.url} alt={i.alt_text} fill sizes="200px" className="object-cover" /></div>
              <div className="p-2 text-xs"><p className="font-medium">{KIND_LABEL[i.kind] ?? i.kind}</p><p className="truncate text-dim">{i.width && i.height ? `${i.width}×${i.height}` : ''} {i.alt_text}</p>
                <ActButton className="mt-1 text-bad hover:underline" onAct={deleteImageAction.bind(null, i.id)} confirmText="¿Eliminar esta imagen?">Eliminar</ActButton></div>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={uploadImageAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end" submit="Subir" resetOnOk>
        <input type="hidden" name="owner_type" value={ownerType} /><input type="hidden" name="owner_id" value={ownerId} />
        <Select label="Tipo" name="kind" options={kinds.map((k) => [k, KIND_LABEL[k] ?? k])} />
        <div><label className="label" htmlFor={`file-${ownerId}`}>Archivo (JPG, PNG, WebP, AVIF · máx. 15 MB)</label><input id={`file-${ownerId}`} name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required className="field text-sm" /></div>
        <Field label="Texto alternativo" name="alt_text" required placeholder="Describe la imagen" />
      </ActionForm>
    </Panel>
  );
}

export async function SubtitlePanel({ ownerType, ownerId }: { ownerType: OwnerType; ownerId: string }) {
  const subs = await sql`select * from subtitle_tracks where owner_type = ${ownerType} and owner_id = ${ownerId} order by is_default desc, label`;
  return (
    <Panel title="Subtítulos">
      {subs.length > 0 ? (
        <ul className="mb-4 divide-y divide-line text-sm">
          {subs.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span>{s.label} <span className="text-dim">({s.language}{s.kind === 'captions' ? ', subtítulos descriptivos' : ''}){s.is_default && ' · por defecto'}</span></span>
              <span className="flex gap-3"><a href={s.url} target="_blank" className="text-gold-soft hover:underline">Ver .vtt</a><ActButton className="text-bad hover:underline" onAct={deleteSubtitleAction.bind(null, s.id)} confirmText="¿Eliminar estos subtítulos?">Eliminar</ActButton></span>
            </li>
          ))}
        </ul>
      ) : <p className="mb-4 text-sm text-dim">Sin subtítulos. Se aceptan WebVTT y SRT (se convierte automáticamente).</p>}
      <ActionForm action={uploadSubtitleAction} className="grid gap-3 sm:grid-cols-[0.6fr_1fr_0.9fr_1.3fr] sm:items-end" submit="Añadir" resetOnOk>
        <input type="hidden" name="owner_type" value={ownerType} /><input type="hidden" name="owner_id" value={ownerId} />
        <Field label="Idioma" name="language" required placeholder="es" maxLength={8} />
        <Field label="Etiqueta" name="label" placeholder="Español" />
        <Select label="Tipo" name="kind" options={[['subtitles', 'Subtítulos'], ['captions', 'Para personas sordas (CC)']]} />
        <div><label className="label" htmlFor={`sub-${ownerId}`}>Archivo .vtt / .srt</label><input id={`sub-${ownerId}`} name="file" type="file" accept=".vtt,.srt,text/vtt" required className="field text-sm" /></div>
        <label className="flex items-center gap-2 text-sm text-mist sm:col-span-4"><input type="checkbox" name="is_default" className="accent-[var(--color-gold)]" /> Activar por defecto</label>
      </ActionForm>
    </Panel>
  );
}
