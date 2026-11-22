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

/** Subida directa y reanudable al proveedor (Mux) con UpChunk: arrastrar y soltar, progreso, velocidad y tiempo restante. */
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mpg|mpeg|mxf)$/i;
const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`);
const fmtEta = (s: number) => (!Number.isFinite(s) || s <= 0 ? '' : s < 60 ? `${Math.ceil(s)} s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.ceil((s % 3600) / 60)} min`);

export function DirectUploader({ ownerType, ownerId, muxReady, localReady = false, localReason }: { ownerType: 'episode' | 'title' | 'trailer'; ownerId: string; muxReady: boolean; localReady?: boolean; localReason?: string }) {
  const mode: 'mux' | 'local' | 'none' = muxReady ? 'mux' : localReady ? 'local' : 'none';
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [signed, setSigned] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [rate, setRate] = useState<{ bps: number; eta: number } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const upload = useRef<{ abort: () => void; pause: () => void; resume: () => void } | null>(null);
  const assetRef = useRef<string | null>(null);
  const sample = useRef<{ t: number; p: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const router = useRouter();

  // Avisa antes de cerrar o recargar la pestaña mientras se sube
  useEffect(() => {
    if (progress === null) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [progress]);

  if (mode === 'none') {
    return <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">Para subir archivos configura Mux (MUX_TOKEN_ID y MUX_TOKEN_SECRET) o, para pruebas en tu PC, usa STORAGE_DRIVER=local. {localReason} Mientras tanto puedes vincular un video ya alojado en un CDN.</p>;
  }

  const pick = (f: File | null | undefined) => {
    setMessage(null);
    if (!f) return;
    if (!VIDEO_EXT.test(f.name) && !f.type.startsWith('video/')) { setMessage({ kind: 'error', text: `«${f.name}» no parece un video. Usa MP4, MOV, MKV, WebM o MXF.` }); return; }
    if (mode === 'local' && !/\.(mp4|m4v|webm)$/i.test(f.name)) { setMessage({ kind: 'error', text: 'En el modo local (sin Mux) el navegador reproduce el archivo tal cual: exporta un MP4 (H.264 + AAC). MOV/ProRes o MKV no se verían.' }); return; }
    setFile(f);
  };
  const report = (id: string, state: 'sent' | 'failed', msg?: string) =>
    fetch(`/api/v1/admin/uploads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, message: msg }) });

  function trackProgress(pct: number, total: number) {
    setProgress(pct);
    const now = Date.now(); const prev = sample.current;
    if (prev && now - prev.t > 3000) {
      const bps = (((pct - prev.p) / 100) * total) / ((now - prev.t) / 1000);
      setRate({ bps, eta: bps > 0 ? (((100 - pct) / 100) * total) / bps : Infinity });
      sample.current = { t: now, p: pct };
    }
  }

  // Subida al propio servidor por partes de 8 MB; si se corta, pregunta cuánto llegó y continúa
  async function startLocal(f: File) {
    const res = await fetch('/api/v1/admin/local-uploads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, file: { name: f.name, size: f.size, type: f.type } }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage({ kind: 'error', text: data.error || 'No se pudo iniciar la subida.' }); return; }
    assetRef.current = data.assetId;
    cancelledRef.current = false; pausedRef.current = false;
    upload.current = {
      abort: () => { cancelledRef.current = true; },
      pause: () => { pausedRef.current = true; },
      resume: () => { pausedRef.current = false; },
    };
    setProgress(0); setRate(null); sample.current = { t: Date.now(), p: 0 };
    const url = `/api/v1/admin/local-uploads/${data.assetId}`;
    let offset = 0; let failures = 0;
    while (offset < f.size) {
      if (cancelledRef.current) return;
      if (pausedRef.current) { await new Promise((r) => setTimeout(r, 400)); continue; }
      const chunk = f.slice(offset, offset + data.chunkSize);
      try {
        const r = await fetch(`${url}?offset=${offset}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: chunk });
        const out = await r.json().catch(() => ({}));
        if (r.status === 409 && typeof out.received === 'number') { offset = out.received; continue; }
        if (!r.ok) throw new Error(out.error || `el servidor respondió ${r.status}`);
        offset = out.received; failures = 0;
        trackProgress((offset / f.size) * 100, f.size);
      } catch (e) {
        failures++;
        if (failures > 8) {
          await report(data.assetId, 'failed', (e as Error).message);
          setProgress(null); setRate(null);
          setMessage({ kind: 'error', text: `La subida falló: ${(e as Error).message}. Puedes intentarlo de nuevo.` });
          router.refresh();
          return;
        }
        setMessage({ kind: 'info', text: 'Conexión interrumpida: reintentando…' });
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** failures)));
        const st = await fetch(url, { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
        if (st && typeof st.received === 'number') offset = st.received;
      }
    }
    setMessage({ kind: 'info', text: 'Comprobando el archivo…' });
    const done = await fetch(url, { method: 'POST' });
    const out = await done.json().catch(() => ({}));
    setProgress(null); setFile(null); setRate(null);
    if (!done.ok) { setMessage({ kind: 'error', text: out.error || 'No se pudo completar la subida.' }); router.refresh(); return; }
    setMessage({ kind: 'ok', text: '✓ Archivo recibido y verificado. Ya está «En revisión»: previsualízalo y apruébalo.' });
    router.refresh();
  }

  async function start() {
    if (!file) return;
    setMessage(null);
    if (mode === 'local') return startLocal(file);
    const res = await fetch('/api/v1/admin/uploads', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, signed, file: { name: file.name, size: file.size, type: file.type } }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMessage({ kind: 'error', text: data.error || 'No se pudo iniciar la subida.' }); return; }
    assetRef.current = data.assetId;
    const { createUpload } = await import('@mux/upchunk');
    setProgress(0); setRate(null); sample.current = { t: Date.now(), p: 0 };
    const up = createUpload({ endpoint: data.uploadUrl, file, chunkSize: 30720, dynamicChunkSize: true });
    upload.current = up;
    up.on('progress', (e: CustomEvent<number>) => {
      setProgress(e.detail);
      const now = Date.now(); const prev = sample.current;
      if (prev && now - prev.t > 3000) {
        const bytes = ((e.detail - prev.p) / 100) * file.size;
        const bps = bytes / ((now - prev.t) / 1000);
        setRate({ bps, eta: bps > 0 ? (((100 - e.detail) / 100) * file.size) / bps : Infinity });
        sample.current = { t: now, p: e.detail };
      }
    });
    up.on('success', async () => {
      await report(data.assetId, 'sent');
      setProgress(null); setFile(null); setRate(null);
      setMessage({ kind: 'ok', text: '✓ Archivo enviado. Mux lo está procesando: esta página se actualizará sola cuando esté listo para revisar.' });
      router.refresh();
    });
    up.on('error', async (e: CustomEvent<{ message: string }>) => {
      await report(data.assetId, 'failed', e.detail?.message);
      setProgress(null); setRate(null);
      setMessage({ kind: 'error', text: `La subida falló: ${e.detail?.message ?? 'error de red'}. Puedes intentarlo de nuevo.` });
      router.refresh();
    });
    up.on('offline', () => setMessage({ kind: 'info', text: 'Sin conexión: la subida se reanudará sola al recuperar la red.' }));
    up.on('online', () => setMessage(null));
  }

  async function cancel() {
    if (!confirm('¿Cancelar la subida? Tendrás que empezar de nuevo.')) return;
    upload.current?.abort();
    if (assetRef.current) await report(assetRef.current, 'failed', 'cancelada por el usuario');
    setProgress(null); setRate(null); setPaused(false);
    setMessage({ kind: 'info', text: 'Subida cancelada.' });
    router.refresh();
  }

  if (progress !== null) {
    return (
      <div className="grid gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        <p className="font-medium">Subiendo «{file?.name}» <span className="text-dim">({file ? fmtBytes(file.size) : ''})</span></p>
        <div className="h-3 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso de subida">
          <div className="h-full bg-gold transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-lg font-semibold tabular-nums">{progress.toFixed(1)} %</span>
          {rate && !paused && <span className="text-mist">{fmtBytes(rate.bps)}/s · quedan {fmtEta(rate.eta) || 'unos instantes'}</span>}
          {paused && <span className="text-warn">En pausa</span>}
          <span className="spacer flex-1" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (paused) upload.current?.resume(); else upload.current?.pause(); setPaused(!paused); }}>{paused ? 'Reanudar' : 'Pausar'}</button>
          <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={cancel}>Cancelar</button>
        </div>
        <p className="text-xs text-dim">No cierres esta pestaña hasta que termine. Si se corta internet, la subida continúa sola al volver la conexión.</p>
        {message && <p role="status" className="text-sm text-mist">{message.text}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? 'border-gold bg-gold/10' : 'border-line hover:border-gold/60'}`}
      >
        <input type="file" accept="video/*,.mov,.mkv,.mxf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} aria-label="Archivo de video" />
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-gold" aria-hidden><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        {file
          ? <><span className="font-semibold">{file.name}</span><span className="text-sm text-dim">{fmtBytes(file.size)} · listo para subir</span></>
          : <><span className="font-semibold">Arrastra aquí el archivo del episodio</span><span className="text-sm text-dim">o haz clic para elegirlo · {mode === 'local' ? 'MP4 (H.264 + AAC) o WebM' : 'MP4, MOV, MKV, WebM o MXF'}</span></>}
      </label>
      {mode === 'mux'
        ? <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="accent-[var(--color-gold)]" /> Reproducción firmada (sólo para contenido restringido; requiere las claves de firma de Mux)</label>
        : <p className="rounded-lg border border-line bg-white/[0.03] p-3 text-xs text-mist"><strong className="text-cream">Modo local de prueba (sin Mux):</strong> el archivo se guarda en la carpeta «storage» de este equipo y se reproduce tal cual, sin calidades adaptativas. Usa un MP4 en H.264 + AAC. Para publicar en internet hará falta Mux o un CDN.</p>}
      <button type="button" className="btn btn-gold justify-self-start" disabled={!file} onClick={start}>Subir episodio</button>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-bad' : message.kind === 'ok' ? 'text-ok' : 'text-mist'}`}>{message.text}</p>}
    </div>
  );
}

export function Duration({ seconds }: { seconds: number | string | null }) {
  return <>{seconds ? formatClock(Number(seconds)) : '—'}</>;
}
