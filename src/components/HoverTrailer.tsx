'use client';
// Vista previa del tráiler dentro de la tarjeta de una obra.
// - Con mouse: al quedarse encima ~medio segundo, empieza el tráiler en silencio (máx. 1 minuto).
// - Con el dedo: el primer toque reproduce el tráiler; el segundo abre la ficha.
// - Con teclado: al enfocar la tarjeta también se reproduce.
// Sólo una tarjeta a la vez; se detiene al salir, al hacer scroll fuera de la pantalla o al cambiar de pestaña.
// No se registra como «vista del tráiler» en las estadísticas: es sólo una vista previa.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './player/icons';

const MAX_SECONDS = 60;
const HOVER_DELAY = 450;
const STOP_EVENT = 'cls:preview-start';

type Source = { kind: 'hls' | 'mp4' | string; src: string };
const sources = new Map<string, Promise<Source | null>>();
let soundOn = false; // preferencia compartida entre tarjetas durante la visita

function loadSource(trailerId: string) {
  let p = sources.get(trailerId);
  if (!p) {
    p = fetch(`/api/v1/playback/trailer/${trailerId}?teaser=1`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as Source) : null))
      .catch(() => null);
    sources.set(trailerId, p);
    // Si falla, se podrá reintentar más tarde; si funciona, la URL firmada dura horas
    p.then((s) => { if (!s) sources.delete(trailerId); });
  }
  return p;
}

function quietMode() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  let off = false;
  try { off = localStorage.getItem('cls_autoplay_previews') === 'off'; } catch { /* almacenamiento bloqueado */ }
  return reduced || off || !!c?.saveData || ['slow-2g', '2g'].includes(c?.effectiveType ?? '');
}

export function HoverTrailer({ trailerId, title }: { trailerId: string; title: string }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<{ destroy: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const token = useRef(0);
  const lastPointer = useRef<string>('mouse');
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(true);
  const [touchHint, setTouchHint] = useState(false);

  const stop = useCallback(() => {
    token.current++;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    hls.current?.destroy(); hls.current = null;
    const v = video.current;
    setState('idle');
    stateRef.current = 'idle';
    if (v && v.getAttribute('src') !== null) { v.pause(); v.removeAttribute('src'); v.load(); } else v?.pause(); setProgress(0); setTouchHint(false);
  }, []);

  const start = useCallback(async (byTouch: boolean) => {
    const my = ++token.current;
    window.dispatchEvent(new CustomEvent(STOP_EVENT, { detail: root.current }));
    setState('loading'); setTouchHint(byTouch);
    const s = await loadSource(trailerId);
    const v = video.current;
    if (my !== token.current || !v) return;
    if (!s) { setState('idle'); return; }
    const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
    if (s.kind === 'hls' && !(nativeHls && /apple/i.test(navigator.vendor))) {
      const { default: Hls } = await import('hls.js');
      if (my !== token.current) return;
      if (Hls.isSupported()) {
        const h = new Hls({ capLevelToPlayerSize: true, startLevel: -1, maxBufferLength: 12, maxMaxBufferLength: 20 });
        h.subtitleDisplay = false;
        h.loadSource(s.src); h.attachMedia(v); hls.current = h;
      } else if (nativeHls) v.src = s.src;
      else { setState('idle'); return; }
    } else v.src = s.src;
    v.muted = !soundOn;
    setMuted(!soundOn);
    startedAt.current = 0;
    try {
      await v.play();
    } catch {
      // Sin interacción previa el navegador sólo permite reproducir en silencio
      v.muted = true; setMuted(true);
      try { await v.play(); } catch { if (my === token.current) stop(); return; }
    }
    if (my === token.current) setState('playing');
  }, [trailerId, stop]);

  // Eventos de la tarjeta (el enlace que contiene esta vista previa)
  useEffect(() => {
    const card = root.current?.closest('a');
    if (!card) return;
    const onDown = (e: PointerEvent) => { lastPointer.current = e.pointerType; };
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || quietMode()) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => start(false), HOVER_DELAY);
    };
    const onLeave = (e: PointerEvent) => { if (e.pointerType === 'mouse') stop(); };
    const onFocus = () => { if (card.matches(':focus-visible') && !quietMode()) timer.current = setTimeout(() => start(false), HOVER_DELAY); };
    const onBlur = () => stop();
    const onClick = (e: MouseEvent) => {
      // Botón de sonido: no abre la ficha
      if ((e.target as HTMLElement).closest('[data-preview-sound]')) {
        e.preventDefault();
        const v = video.current;
        if (!v) return;
        soundOn = v.muted;
        v.muted = !soundOn; setMuted(!soundOn);
        if (v.paused) v.play().catch(() => {});
        return;
      }
      // Primer toque con el dedo: reproduce el tráiler; el segundo abre la ficha
      if (lastPointer.current === 'touch' && stateRef.current === 'idle') {
        e.preventDefault();
        start(true);
      }
    };
    card.addEventListener('pointerdown', onDown);
    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('focus', onFocus);
    card.addEventListener('blur', onBlur);
    card.addEventListener('click', onClick);
    return () => {
      card.removeEventListener('pointerdown', onDown);
      card.removeEventListener('pointerenter', onEnter);
      card.removeEventListener('pointerleave', onLeave);
      card.removeEventListener('focus', onFocus);
      card.removeEventListener('blur', onBlur);
      card.removeEventListener('click', onClick);
    };
  }, [start, stop]);

  // Sólo una vista previa a la vez; se detiene fuera de la pantalla o con la pestaña oculta
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== el && stateRef.current !== 'idle') stop(); };
    const onHidden = () => { if (document.hidden) stop(); };
    const io = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting && stateRef.current !== 'idle') stop(); }, { threshold: 0.4 });
    io.observe(el);
    window.addEventListener(STOP_EVENT, onOther);
    document.addEventListener('visibilitychange', onHidden);
    return () => { io.disconnect(); window.removeEventListener(STOP_EVENT, onOther); document.removeEventListener('visibilitychange', onHidden); stop(); };
  }, [stop]);

  const onTime = () => {
    const v = video.current;
    if (!v) return;
    if (!startedAt.current && v.currentTime > 0) startedAt.current = v.currentTime;
    const elapsed = v.currentTime - startedAt.current;
    const total = Math.min(MAX_SECONDS, (v.duration || MAX_SECONDS) - startedAt.current);
    setProgress(Math.min(1, elapsed / total));
    if (elapsed >= MAX_SECONDS) stop();
  };

  const active = state !== 'idle';
  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-[1]" aria-hidden={!active}>
      {/* Indicador discreto: esta tarjeta tiene tráiler */}
      <span className={`absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-cream/90 backdrop-blur transition-opacity duration-300 ${active ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
        <Icon name="play" size={10} /> Tráiler
      </span>
      <video
        ref={video} muted playsInline preload="none" disablePictureInPicture tabIndex={-1}
        onTimeUpdate={onTime} onEnded={stop} onError={() => { if (stateRef.current !== 'idle') stop(); }}
        aria-label={`Tráiler de ${title}`}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${state === 'playing' ? 'opacity-100' : 'opacity-0'}`}
      />
      {active && (
        <>
          <div className={`absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/85 to-transparent transition-opacity duration-500 ${state === 'playing' ? 'opacity-100' : 'opacity-0'}`} />
          {state === 'loading' && <span className="absolute inset-0 m-auto h-8 w-8 animate-spin rounded-full border-2 border-cream/25 border-t-gold" />}
          {state === 'playing' && (
            <>
              <span className="absolute left-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-ink">Tráiler</span>
              {touchHint && <span className="absolute inset-x-2 bottom-12 animate-fade text-center text-[0.7rem] text-cream/90 drop-shadow">Toca otra vez para abrir</span>}
              <button
                type="button" data-preview-sound tabIndex={-1}
                aria-label={muted ? 'Activar sonido del tráiler' : 'Silenciar tráiler'}
                className="pointer-events-auto absolute bottom-3 right-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-cream ring-1 ring-white/25 backdrop-blur transition hover:bg-black/80 hover:ring-gold"
              >
                <Icon name={muted ? 'mute' : 'volume'} size={16} />
              </button>
              <div className="absolute inset-x-2 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-white/20">
                <div className="h-full bg-gold transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
