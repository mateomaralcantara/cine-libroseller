'use client';
// Componentes de interfaz del panel (cliente).
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionState } from './actions';
import { VIDEO_STATUS_LABEL, STATUS_LABEL, formatClock } from '@/lib/format';

type Action = (prev: ActionState, f: FormData) => Promise<ActionState>;

/** Formulario con estado de envío, errores por campo y confirmación. */
export function ActionForm({ action, children, className = 'grid gap-4', submit = 'Guardar', resetOnOk = false, confirm: confirmText }: { action: Action; children: React.ReactNode; className?: string; submit?: string | null; resetOnOk?: boolean; confirm?: string }) {
  const [state, run, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={run} className={className} onSubmit={(e) => { if (confirmText && !confirm(confirmText)) e.preventDefault(); }}>
      {children}
      {state?.error && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
          {state.fields && Object.keys(state.fields).length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">{Object.entries(state.fields).map(([k, v]) => <li key={k}><strong>{k}</strong>: {v}</li>)}</ul>
          )}
        </div>
      )}
      {state?.ok && <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      {submit && <div><button className="btn btn-gold btn-sm" disabled={pending}>{pending ? 'Guardando…' : submit}</button></div>}
    </form>
  );
}

export function ActButton({ onAct, children, className = 'btn btn-ghost btn-sm', confirmText }: { onAct: () => Promise<void>; children: React.ReactNode; className?: string; confirmText?: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <button type="button" className={className} disabled={pending} onClick={() => {
        if (confirmText && !confirm(confirmText)) return;
        setErr(null);
        start(async () => { try { await onAct(); router.refresh(); } catch (e) { setErr((e as Error).message || 'Error'); } });
      }}>{pending ? '…' : children}</button>
      {err && <span role="alert" className="mt-1 text-xs text-bad">{err}</span>}
    </span>
  );
}

const TONE: Record<string, string> = {
  published: 'bg-ok/15 text-ok', ready: 'bg-ok/15 text-ok', in_review: 'bg-warn/15 text-warn', scheduled: 'bg-gold/15 text-gold-soft',
  processing: 'bg-warn/15 text-warn', uploading: 'bg-warn/15 text-warn', pending: 'bg-white/10 text-mist', draft: 'bg-white/10 text-mist',
  withdrawn: 'bg-bad/15 text-bad', archived: 'bg-white/5 text-dim', error: 'bg-bad/15 text-bad',
};
export function StatusPill({ status, video = false }: { status: string; video?: boolean }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[status] ?? 'bg-white/10 text-mist'}`}>{(video ? VIDEO_STATUS_LABEL : STATUS_LABEL)[status] ?? status}</span>;
}

/** Recarga periódica mientras haya videos procesándose (el webhook actualiza la base de datos). */
export function AutoRefresh({ active, every = 5000, assetIds = [] }: { active: boolean; every?: number; assetIds?: string[] }) {
  const router = useRouter();
  const key = assetIds.join(',');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      // Pregunta el estado de cada video en curso (el servidor consulta a Mux si no llegó el webhook)
      await Promise.all(key.split(',').filter(Boolean).map((id) => fetch(`/api/v1/admin/uploads/${id}`, { cache: 'no-store' }).catch(() => null)));
      router.refresh();
    }, every);
    return () => clearInterval(t);
  }, [active, every, router, key]);
  return null;
}

/** Subida directa y reanudable al proveedor (Mux) con UpChunk. */
export function DirectUploader({ ownerType, ownerId, muxReady }: { ownerType: 'episode' | 'title' | 'trailer'; ownerId: string; muxReady: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [signed, setSigned] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const upload = useRef<{ abort: () => void; pause: () => void; resume: () => void } | null>(null);
  const [paused, setPaused] = useState(false);
  const router = useRouter();

  if (!muxReady) {
    return <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">La subida directa necesita Mux configurado (MUX_TOKEN_ID, MUX_TOKEN_SECRET y MUX_WEBHOOK_SECRET). Mientras tanto puedes vincular un video ya alojado en un CDN.</p>;
  }

  async function start() {
    if (!file) return;
    setMessage(null);
    const res = await fetch('/api/v1/admin/uploads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, signed, file: { name: file.name, size: file.size, type: file.type } }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage({ kind: 'error', text: data.error || 'No se pudo iniciar la subida.' }); return; }
    const { createUpload } = await import('@mux/upchunk');
    setProgress(0);
    const up = createUpload({ endpoint: data.uploadUrl, file, chunkSize: 30720, dynamicChunkSize: true });
    upload.current = up;
    const report = (state: 'sent' | 'failed', msg?: string) => fetch(`/api/v1/admin/uploads/${data.assetId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, message: msg }) });
    up.on('progress', (e: CustomEvent<number>) => setProgress(e.detail));
    up.on('success', async () => {
      await report('sent');
      setProgress(null); setFile(null);
      setMessage({ kind: 'ok', text: 'Archivo enviado. El proveedor lo está procesando; el estado se actualizará solo.' });
      router.refresh();
    });
    up.on('error', async (e: CustomEvent<{ message: string }>) => {
      await report('failed', e.detail?.message);
      setProgress(null);
      setMessage({ kind: 'error', text: `La subida falló: ${e.detail?.message ?? 'error de red'}. Puedes intentarlo de nuevo.` });
      router.refresh();
    });
    up.on('offline', () => setMessage({ kind: 'info', text: 'Sin conexión: la subida se reanudará al recuperar la red.' }));
    up.on('online', () => setMessage(null));
  }

  return (
    <div className="grid gap-3">
      <input type="file" accept="video/*,.mov,.mkv,.mxf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="field file:mr-3 file:rounded-full file:border-0 file:bg-gold file:px-3 file:py-1 file:text-ink" disabled={progress !== null} aria-label="Archivo de video" />
      {file && <p className="text-xs text-dim">{file.name} · {(file.size / 1024 ** 3).toFixed(2)} GB</p>}
      <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="accent-[var(--color-gold)]" disabled={progress !== null} /> Reproducción firmada (contenido restringido: requiere claves de firma de Mux)</label>
      {progress !== null ? (
        <div className="grid gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de subida"><div className="h-full bg-gold transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="flex items-center gap-3 text-sm"><span className="tabular-nums">{progress.toFixed(1)} %</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (paused) upload.current?.resume(); else upload.current?.pause(); setPaused(!paused); }}>{paused ? 'Reanudar' : 'Pausar'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { upload.current?.abort(); setProgress(null); setMessage({ kind: 'info', text: 'Subida cancelada.' }); }}>Cancelar</button>
          </div>
        </div>
      ) : <button type="button" className="btn btn-gold btn-sm justify-self-start" disabled={!file} onClick={start}>Subir al proveedor de streaming</button>}
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-bad' : message.kind === 'ok' ? 'text-ok' : 'text-mist'}`}>{message.text}</p>}
    </div>
  );
}

export function Duration({ seconds }: { seconds: number | string | null }) {
  return <>{seconds ? formatClock(Number(seconds)) : '—'}</>;
}
