'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Player, type PlayerSource } from './player/Player';
import { Icon } from './player/icons';
import { track } from '@/lib/client/track';

// ------------------------------------------------------------------ Tráiler / extras en modal
export function TrailerButton({ trailerId, label = 'Ver tráiler', className = 'btn btn-ghost', signedIn = false, preview = false }: { trailerId: string; label?: string; className?: string; signedIn?: boolean; preview?: boolean }) {
  const [source, setSource] = useState<PlayerSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/v1/playback/trailer/${trailerId}${preview ? '?preview=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) setError(data.message || 'El tráiler no está disponible.');
      else setSource(data);
    } catch { setError('Sin conexión.'); }
    setLoading(false);
  };
  const close = useCallback(() => { setSource(null); opener.current?.focus(); }, []);
  useEffect(() => {
    if (!source) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [source]);
  return (
    <>
      <button ref={opener} className={className} onClick={open} disabled={loading}>
        <Icon name="film" size={18} /> {loading ? 'Cargando…' : label}
      </button>
      {error && <span role="alert" className="text-sm text-bad">{error}</span>}
      {source && (
        <div role="dialog" aria-modal="true" aria-label={source.subheading ?? label} className="fixed inset-0 z-[60] grid animate-fade place-items-center bg-black/90 p-3 sm:p-8" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="w-full max-w-6xl">
            <Player source={source} signedIn={signedIn} variant="modal" onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Mi lista
export function WatchlistButton({ titleId, initial, signedIn, nextPath }: { titleId: string; initial: boolean; signedIn: boolean; nextPath: string }) {
  const [inList, setInList] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (!signedIn) {
    return <a href={`/cuenta/entrar?next=${encodeURIComponent(nextPath)}`} className="btn btn-ghost"><Icon name="plus" size={18} /> Mi lista</a>;
  }
  const toggle = async () => {
    setBusy(true);
    const want = !inList;
    setInList(want);
    const res = await fetch('/api/v1/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titleId, inList: want }) }).catch(() => null);
    if (!res?.ok) setInList(!want);
    setBusy(false);
    router.refresh();
  };
  return (
    <button className="btn btn-ghost" onClick={toggle} disabled={busy} aria-pressed={inList}>
      <Icon name={inList ? 'check' : 'plus'} size={18} /> {inList ? 'En mi lista' : 'Mi lista'}
    </button>
  );
}

// ------------------------------------------------------------------ Compartir enlace oficial
export function ShareButton({ url, title, text, contentType, contentId }: { url: string; title: string; text?: string; contentType: 'title' | 'episode'; contentId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    track({ event: 'share', contentType, contentId });
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch { /* cancelado: mostramos opciones */ }
    }
    setOpen((v) => !v);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sin permiso */ }
  };
  const enc = encodeURIComponent;
  return (
    <div className="relative">
      <button className="btn btn-ghost" onClick={share} aria-expanded={open}><Icon name="share" size={18} /> Compartir</button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 animate-rise rounded-xl border border-line bg-graphite p-2 shadow-2xl">
          <button onClick={copy} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10">{copied ? '✓ Enlace copiado' : 'Copiar enlace'}</button>
          <a className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${enc(`${title} — ${url}`)}`}>WhatsApp</a>
          <a className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10" target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`}>Facebook</a>
          <a className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10" target="_blank" rel="noopener noreferrer" href={`https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}`}>X</a>
          <a className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10" href={`mailto:?subject=${enc(title)}&body=${enc(url)}`}>Correo</a>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Aviso de estreno (consentimiento explícito)
export function NotifyForm({ releaseId, compact = false }: { releaseId: string; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState('sending');
    const res = await fetch('/api/v1/notify', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId, email: f.get('email'), consent: f.get('consent') === 'on' }) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) { setState('done'); setMessage('Listo. Te escribiremos sólo para avisarte de este estreno.'); }
    else { setState('error'); setMessage(data?.error || 'No se pudo registrar el aviso.'); }
  };
  if (state === 'done') return <p className="text-sm text-ok" role="status">{message}</p>;
  return (
    <form onSubmit={submit} className={`grid gap-2 ${compact ? '' : 'max-w-md'}`}>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`n-${releaseId}`}>Tu email</label>
        <input id={`n-${releaseId}`} name="email" type="email" required placeholder="tu@email.com" className="field flex-1" autoComplete="email" />
        <button className="btn btn-gold btn-sm" disabled={state === 'sending'}><Icon name="bell" size={16} /> Avisarme</button>
      </div>
      <label className="flex items-start gap-2 text-xs text-dim">
        <input type="checkbox" name="consent" required className="mt-0.5 accent-[var(--color-gold)]" />
        Acepto recibir un correo cuando se estrene. Puedo darme de baja en cualquier momento.
      </label>
      {state === 'error' && <p className="text-sm text-bad" role="alert">{message}</p>}
    </form>
  );
}

// ------------------------------------------------------------------ Fila horizontal accesible
export function Rail({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (el) setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };
  useEffect(update, []);
  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <div className="group/rail relative">
      <div ref={ref} onScroll={update} role="list" aria-label={label} className="rail flex gap-3 overflow-x-auto px-4 pb-4 sm:gap-4 sm:px-8 lg:px-12 [--rail-pad:1rem] sm:[--rail-pad:2rem] lg:[--rail-pad:3rem]">
        {children}
      </div>
      {!edges.start && <button onClick={() => by(-1)} aria-label="Anteriores" className="absolute left-1 top-[40%] hidden -translate-y-1/2 rounded-full bg-black/70 p-3 opacity-0 transition group-hover/rail:opacity-100 focus:opacity-100 sm:block"><Icon name="back" /></button>}
      {!edges.end && <button onClick={() => by(1)} aria-label="Siguientes" className="absolute right-1 top-[40%] hidden -translate-y-1/2 rotate-180 rounded-full bg-black/70 p-3 opacity-0 transition group-hover/rail:opacity-100 focus:opacity-100 sm:block"><Icon name="back" /></button>}
    </div>
  );
}

// ------------------------------------------------------------------ Comparador antes / después
export function BeforeAfter({ before, after, label }: { before: string; after: string; label: string }) {
  const [pos, setPos] = useState(50);
  return (
    <figure className="relative aspect-video select-none overflow-hidden rounded-xl bg-graphite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt={`${label}: resultado final autorizado`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt={`${label}: material original`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-gold shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${pos}%` }}>
        <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gold text-ink">↔</span>
      </div>
      <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 text-xs">Antes</span>
      <span className="absolute right-3 top-3 rounded bg-black/70 px-2 py-0.5 text-xs">Después</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={`Comparar antes y después: ${label}`}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0" />
    </figure>
  );
}

// ------------------------------------------------------------------ Cuenta regresiva (sólo fechas confirmadas)
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const diff = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(diff / 864e5); const h = Math.floor((diff / 36e5) % 24); const m = Math.floor((diff / 6e4) % 60); const s = Math.floor((diff / 1e3) % 60);
  if (diff === 0) return <p className="text-gold-soft">¡Ya disponible!</p>;
  return (
    <div className="flex gap-3" role="timer" aria-label={`Faltan ${d} días, ${h} horas y ${m} minutos`}>
      {[[d, 'días'], [h, 'horas'], [m, 'min'], [s, 'seg']].map(([v, l]) => (
        <div key={l} className="min-w-14 rounded-lg border border-line bg-black/40 px-2 py-1.5 text-center">
          <div className="display text-2xl tabular-nums">{String(v).padStart(2, '0')}</div>
          <div className="text-[0.65rem] uppercase tracking-wider text-dim">{l}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Analítica de visita (no cuenta como reproducción)
export function PageView({ contentType, contentId }: { contentType: 'title' | 'episode'; contentId: string }) {
  useEffect(() => { track({ event: 'page_view', contentType, contentId }); }, [contentType, contentId]);
  return null;
}

export function BookLink({ href, titleId, children }: { href: string; titleId: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="btn btn-gold btn-sm" onClick={() => track({ event: 'book_click', contentType: 'title', contentId: titleId })}>
      {children}
    </a>
  );
}

// ------------------------------------------------------------------ Teaser silencioso de fondo
export function TeaserBackground({ trailerId, poster }: { trailerId: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    let off = false;
    try { off = localStorage.getItem('cls_autoplay_previews') === 'off'; } catch { /* */ }
    if (reduced || off || saveData?.saveData || ['slow-2g', '2g', '3g'].includes(saveData?.effectiveType ?? '')) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/playback/trailer/${trailerId}?teaser=1`, { cache: 'no-store' }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const s = await res.json();
      const v = ref.current;
      if (!v) return;
      const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
      if (s.kind === 'hls' && !(nativeHls && /apple/i.test(navigator.vendor))) {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) { if (nativeHls) v.src = s.src; else return; }
        else {
          const h = new Hls({ startLevel: 0, capLevelToPlayerSize: true, maxBufferLength: 10 });
          h.loadSource(s.src); h.attachMedia(v); hls = h;
        }
      } else v.src = s.src;
      v.muted = true;
      v.play().then(() => setVisible(true)).catch(() => {});
    })();
    return () => { cancelled = true; hls?.destroy(); };
  }, [trailerId]);
  return (
    <video ref={ref} muted playsInline loop aria-hidden tabIndex={-1} poster={poster ?? undefined}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms] ${visible ? 'opacity-100' : 'opacity-0'}`} />
  );
}
