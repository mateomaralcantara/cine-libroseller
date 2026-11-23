'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type HlsType from 'hls.js';
import { formatClock } from '@/lib/format';
import { track, randomKey } from '@/lib/client/track';
import { Icon } from './icons';

export interface PlayerSource {
  contentType: 'episode' | 'title' | 'trailer';
  contentId: string;
  src: string;
  kind: 'hls' | 'mp4';
  poster: string | null;
  storyboard: string | null;
  durationSeconds: number | null;
  subtitles: { language: string; label: string; kind: string; url: string; default: boolean }[];
  heading: string;
  subheading: string | null;
  backHref: string;
  next: { id: string; label: string; href: string; watchHref: string } | null;
  resumeAt: number;
  preview: boolean;
}

interface Props {
  source: PlayerSource;
  signedIn: boolean;
  autoPlay?: boolean;
  variant?: 'cinema' | 'modal';
  onClose?: () => void;
}

type Menu = null | 'subs' | 'speed' | 'quality' | 'audio';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SAVE_EVERY_MS = 15_000;
const HEARTBEAT_MS = 60_000;

function pref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function setPref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* */ } }

interface Thumb { start: number; end: number; url: string; x: number; y: number; w: number; h: number }
async function loadStoryboard(url: string): Promise<Thumb[]> {
  const text = await (await fetch(url)).text();
  const out: Thumb[] = [];
  const toSec = (s: string) => s.split(':').reduce((a, b) => a * 60 + parseFloat(b), 0);
  for (const block of text.split(/\n\n+/)) {
    const m = block.match(/([\d:.]+)\s+-->\s+([\d:.]+)\s*\n(.+#xywh=(\d+),(\d+),(\d+),(\d+))/);
    if (m) out.push({ start: toSec(m[1]), end: toSec(m[2]), url: m[3].split('#')[0], x: +m[4], y: +m[5], w: +m[6], h: +m[7] });
  }
  return out;
}

export function Player({ source, signedIn, autoPlay = true, variant = 'cinema', onClose }: Props) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsType | null>(null);
  const [src, setSrc] = useState(source);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(source.durationSeconds ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [menu, setMenu] = useState<Menu>(null);
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<{ index: number; label: string }[]>([]);
  const [audioTrack, setAudioTrack] = useState(0);
  const [subtitle, setSubtitle] = useState<string>('off');
  const [subSize] = useState(() => pref<string>('cls_sub_size', 'medium'));
  const [showUi, setShowUi] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeNote, setResumeNote] = useState<number | null>(null);
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const autoplayNext = useMemo(() => pref<string>('cls_autoplay_next', 'on') === 'on', []);
  const retries = useRef(0);
  const usingHlsJs = useRef(false);
  const session = useRef({ key: randomKey(), started: false, valid: false, watched: 0, sinceBeat: 0, lastTick: 0, lastSaved: -1, lastSaveAt: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTrailer = src.contentType === 'trailer';

  // ---------------------------------------------------------------- Carga de la fuente
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    const startAt = src.resumeAt > 10 && (!src.durationSeconds || src.resumeAt < src.durationSeconds - 30) ? src.resumeAt : 0;
    const onReady = () => {
      if (startAt && v.currentTime < 1) { v.currentTime = startAt; setResumeNote(startAt); }
      if (autoPlay) v.play().catch(() => setPlaying(false));
    };
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

    // Safari reproduce HLS de forma nativa (mejor batería y AirPlay); el resto usa hls.js con MSE,
    // que permite elegir calidad y pista de audio. Si no hay MSE pero sí HLS nativo, se usa el nativo.
    const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
    const preferNative = nativeHls && /apple/i.test(navigator.vendor);
    if (src.kind === 'hls' && !preferNative) {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          if (nativeHls) { usingHlsJs.current = false; v.src = src.src; v.addEventListener('loadedmetadata', onReady, { once: true }); return; }
          setError('Tu navegador no puede reproducir este video. Prueba con una versión reciente de Chrome, Edge, Firefox o Safari.'); return;
        }
        usingHlsJs.current = true;
        // Los subtítulos los pone nuestro <track>; hls.js no debe mostrar los del manifiesto por su cuenta
        const h = new Hls({ capLevelToPlayerSize: true, startLevel: saveData ? 0 : -1, maxBufferLength: saveData ? 15 : 30, enableWorker: true });
        h.subtitleDisplay = false;
        hls.current = h;
        h.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)} kbps` })).reverse());
          onReady();
        });
        h.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => setAudioTracks(data.audioTracks.map((t, i) => ({ index: i, label: t.name || t.lang || `Pista ${i + 1}` }))));
        h.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrack(data.id));
        h.on(Hls.Events.LEVEL_SWITCHED, () => { /* calidad automática */ });
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (retries.current < 3 && data.type === Hls.ErrorTypes.NETWORK_ERROR) { retries.current++; h.startLoad(); return; }
          if (retries.current < 3 && data.type === Hls.ErrorTypes.MEDIA_ERROR) { retries.current++; h.recoverMediaError(); return; }
          fail(`hls_${data.details}`);
        });
        h.loadSource(src.src);
        h.attachMedia(v);
      }).catch(() => fail('hls_load'));
    } else {
      usingHlsJs.current = false;
      v.src = src.src;
      v.addEventListener('loadedmetadata', onReady, { once: true });
    }
    return () => {
      cancelled = true;
      hls.current?.destroy();
      hls.current = null;
      v.removeAttribute('src');
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.src]);

  useEffect(() => {
    if (src.storyboard) loadStoryboard(src.storyboard).then(setThumbs).catch(() => setThumbs([]));
  }, [src.storyboard]);

  // Subtítulos: respeta la preferencia guardada o el marcado por defecto
  useEffect(() => {
    if (!src.subtitles.length) return;
    const saved = pref<string>('cls_sub_lang', '');
    const initial = saved === 'off' ? 'off' : src.subtitles.find((s) => s.language === saved)?.language ?? src.subtitles.find((s) => s.default)?.language ?? 'off';
    setSubtitle(initial);
  }, [src.subtitles]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // Sólo se muestra UNA pista: la de nuestros archivos <track> del idioma elegido. Las que traiga el
    // propio video (pistas del manifiesto HLS en hls.js o Safari) se desactivan para que no salgan dobles.
    const apply = () => {
      const ours = Array.from(v.querySelectorAll<HTMLTrackElement>('track[data-cls]')).map((el) => el.track);
      const chosen = subtitle === 'off' ? null : ours.find((t) => t.language === subtitle) ?? null;
      for (const t of Array.from(v.textTracks)) {
        const mode: TextTrackMode = t === chosen ? 'showing' : 'disabled';
        if (t.mode !== mode) t.mode = mode;
      }
    };
    apply();
    v.textTracks.addEventListener?.('addtrack', apply);
    v.textTracks.addEventListener?.('change', apply);
    return () => {
      v.textTracks.removeEventListener?.('addtrack', apply);
      v.textTracks.removeEventListener?.('change', apply);
    };
  }, [subtitle]);

  // Los subtítulos suben cuando los controles están visibles, para no quedar tapados
  const showUiRef = useRef(showUi);
  showUiRef.current = showUi;
  const placeCues = useCallback(() => {
    const v = video.current;
    if (!v) return;
    const line = showUiRef.current ? -4 : 'auto';
    for (const t of Array.from(v.textTracks)) {
      if (t.mode !== 'showing' || !t.cues) continue;
      for (const c of Array.from(t.cues) as VTTCue[]) if (c.line !== line) c.line = line;
    }
  }, []);
  useEffect(placeCues, [placeCues, subtitle, showUi]);
  // El archivo .vtt se descarga al activarse: se recoloca cuando llega y cada vez que cambia la frase
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.addEventListener('load', placeCues, true);
    const tracks = Array.from(v.textTracks);
    for (const t of tracks) t.addEventListener('cuechange', placeCues);
    return () => {
      v.removeEventListener('load', placeCues, true);
      for (const t of tracks) t.removeEventListener('cuechange', placeCues);
    };
  }, [placeCues, subtitle]);

  // ---------------------------------------------------------------- Progreso y analítica
  const saveProgress = useCallback((beacon = false) => {
    const v = video.current;
    if (!v || !signedIn || isTrailer || src.preview) return;
    const pos = Math.floor(v.currentTime);
    if (pos === session.current.lastSaved || pos < 1) return;
    session.current.lastSaved = pos;
    session.current.lastSaveAt = Date.now();
    const body = JSON.stringify({ contentType: src.contentType, contentId: src.contentId, position: pos, duration: Number.isFinite(v.duration) ? Math.floor(v.duration) : null });
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/v1/progress', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/v1/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }, [signedIn, isTrailer, src.contentType, src.contentId, src.preview]);

  const flushWatched = useCallback((event: 'heartbeat' | 'pause' | 'complete', beacon = false) => {
    const v = video.current;
    if (!v || src.preview) return;
    const watched = Math.round(session.current.sinceBeat);
    session.current.sinceBeat = 0;
    if (event === 'heartbeat' && watched < 1) return;
    track({ event, contentType: src.contentType, contentId: src.contentId, sessionKey: session.current.key, position: v.currentTime, watched: Math.min(watched, 600) }, { beacon });
  }, [src.contentType, src.contentId, src.preview]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') { saveProgress(true); flushWatched('pause', true); } };
    const onPageHide = () => { saveProgress(true); flushWatched('pause', true); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    const beat = setInterval(() => { if (!video.current?.paused) flushWatched('heartbeat'); }, HEARTBEAT_MS);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide); clearInterval(beat); onPageHide(); };
  }, [saveProgress, flushWatched]);

  const onTimeUpdate = () => {
    const v = video.current!;
    setTime(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    const now = performance.now();
    const s = session.current;
    if (s.lastTick && !v.paused && !v.seeking) {
      const delta = Math.min((now - s.lastTick) / 1000, 2) * v.playbackRate;
      s.watched += delta;
      s.sinceBeat += delta;
    }
    s.lastTick = now;
    const d = Number.isFinite(v.duration) ? v.duration : duration;
    if (!s.valid && !src.preview && (s.watched >= 30 || (d > 0 && d < 60 && s.watched >= d * 0.5))) {
      s.valid = true;
      if (!isTrailer) track({ event: 'play_valid', contentType: src.contentType, contentId: src.contentId, sessionKey: s.key, position: v.currentTime });
    }
    if (Date.now() - s.lastSaveAt > SAVE_EVERY_MS) saveProgress();
    if (src.next && d > 0 && d - v.currentTime < 20 && nextCountdown === null && autoplayNext && !v.paused) setNextCountdown(Math.ceil(Math.min(10, d - v.currentTime)));
  };

  const onPlay = () => {
    setPlaying(true);
    session.current.lastTick = performance.now();
    if (!session.current.started && !src.preview) {
      session.current.started = true;
      track({ event: isTrailer ? 'trailer_start' : 'play_start', contentType: src.contentType, contentId: src.contentId, sessionKey: session.current.key, position: video.current?.currentTime });
    }
  };
  const onPause = () => {
    setPlaying(false);
    session.current.lastTick = 0;
    saveProgress();
    flushWatched('pause');
  };
  const onEnded = () => {
    setPlaying(false);
    saveProgress();
    flushWatched('complete');
    if (src.next) setNextCountdown(autoplayNext ? 8 : -1);
  };

  function fail(code: string) {
    setLoading(false);
    setError('No pudimos reproducir el video. Comprueba tu conexión e inténtalo de nuevo.');
    if (!src.preview) track({ event: 'error', contentType: src.contentType, contentId: src.contentId, sessionKey: session.current.key, errorCode: code.slice(0, 80) });
  }

  // Reintento: pide una fuente nueva (tokens firmados renovados) y continúa donde estaba
  async function retry() {
    const at = video.current?.currentTime || time;
    setError(null);
    setLoading(true);
    retries.current = 0;
    try {
      const res = await fetch(`/api/v1/playback/${src.contentType}/${src.contentId}${src.preview ? '?preview=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) { setLoading(false); setError(data.message || 'El video no está disponible.'); return; }
      setSrc({ ...data, resumeAt: Math.floor(at) });
    } catch {
      setLoading(false);
      setError('Sin conexión. Revisa tu red e inténtalo de nuevo.');
    }
  }

  // Siguiente episodio
  useEffect(() => {
    if (nextCountdown === null || nextCountdown < 0 || !src.next) return;
    if (nextCountdown === 0) { router.push(src.next.watchHref); return; }
    const t = setTimeout(() => setNextCountdown((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [nextCountdown, src.next, router]);

  // ---------------------------------------------------------------- Controles
  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);
  const seekBy = useCallback((s: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.5, v.currentTime + s));
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = wrap.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iPhone
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const poke = useCallback(() => {
    setShowUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!video.current?.paused) { setShowUi(false); setMenu(null); } }, 3000);
  }, []);
  useEffect(() => { if (!playing) setShowUi(true); else poke(); }, [playing, poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      const v = video.current;
      if (!v) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') { if (tag === 'BUTTON' && k === ' ') return; e.preventDefault(); toggle(); }
      else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); seekBy(-10); }
      else if (k === 'arrowright' || k === 'l') { e.preventDefault(); seekBy(10); }
      else if (k === 'arrowup') { e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); }
      else if (k === 'arrowdown') { e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); }
      else if (k === 'm') v.muted = !v.muted;
      else if (k === 'f') toggleFullscreen();
      else if (k === 'c' && src.subtitles.length) chooseSubtitle(subtitle === 'off' ? (src.subtitles[0]?.language ?? 'off') : 'off');
      else if (k === 'escape') { if (menu) setMenu(null); else if (variant === 'modal') onClose?.(); }
      else return;
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  function chooseSubtitle(lang: string) { setSubtitle(lang); setPref('cls_sub_lang', lang); setMenu(null); }
  function chooseLevel(i: number) { if (hls.current) hls.current.currentLevel = i; setLevel(i); setMenu(null); }
  function chooseAudio(i: number) { if (hls.current) hls.current.audioTrack = i; setAudioTrack(i); setMenu(null); }
  function chooseSpeed(s: number) { if (video.current) video.current.playbackRate = s; setSpeed(s); setMenu(null); }

  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const thumb = hover && thumbs.find((t) => hover.t >= t.start && hover.t < t.end);

  return (
    <div
      ref={wrap}
      data-sub-size={subSize}
      onMouseMove={poke}
      onTouchStart={poke}
      className={`group/player relative isolate overflow-hidden bg-black text-cream ${variant === 'cinema' ? 'h-dvh w-full' : 'aspect-video w-full rounded-xl'} ${showUi ? '' : 'cursor-none'}`}
    >
      <video
        ref={video}
        className="absolute inset-0 h-full w-full object-contain"
        poster={src.poster ?? undefined}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onPlaying={() => setLoading(false)}
        onVolumeChange={(e) => { setVolume(e.currentTarget.volume); setMuted(e.currentTarget.muted); }}
        onError={() => { if (!usingHlsJs.current && video.current?.getAttribute('src')) fail('media_error'); }}
        aria-label={`${src.heading}${src.subheading ? ` — ${src.subheading}` : ''}`}
      >
        {src.subtitles.map((s) => (
          <track key={s.url} data-cls="" kind={s.kind === 'captions' ? 'captions' : 'subtitles'} src={s.url} srcLang={s.language} label={s.label} onLoad={placeCues} />
        ))}
      </video>

      {/* Cabecera */}
      <div className={`absolute inset-x-0 top-0 z-10 flex items-start gap-4 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-500 sm:p-6 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        {variant === 'cinema' ? (
          <a href={src.backHref} className="rounded-full p-2 hover:bg-white/15" aria-label="Volver"><Icon name="back" /></a>
        ) : (
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Cerrar"><Icon name="close" /></button>
        )}
        <div className="min-w-0">
          <p className="display truncate text-lg sm:text-2xl">{src.heading}</p>
          {src.subheading && <p className="truncate text-sm text-mist">{src.subheading}</p>}
          {src.preview && <p className="mt-1 inline-block rounded bg-warn/20 px-2 py-0.5 text-xs text-warn">Previsualización privada</p>}
        </div>
      </div>

      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label="Cargando">
          <span className="h-14 w-14 animate-spin rounded-full border-2 border-white/20 border-t-gold" />
        </div>
      )}

      {!playing && !loading && !error && nextCountdown === null && (
        <button onClick={toggle} className="absolute inset-0 m-auto grid h-20 w-20 place-items-center rounded-full bg-black/50 backdrop-blur transition hover:scale-105 hover:bg-black/70" aria-label="Reproducir">
          <Icon name="play" size={34} />
        </button>
      )}

      {resumeNote !== null && time < resumeNote + 8 && (
        <div className="absolute left-4 top-24 z-10 flex items-center gap-3 rounded-full bg-black/70 px-4 py-2 text-sm backdrop-blur sm:left-6">
          <span>Continuando desde {formatClock(resumeNote)}</span>
          <button className="font-semibold text-gold-soft hover:underline" onClick={() => { if (video.current) video.current.currentTime = 0; setResumeNote(null); }}>Empezar de nuevo</button>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/80 p-6 text-center" role="alert">
          <div className="max-w-md">
            <p className="display text-2xl">Algo interrumpió la función</p>
            <p className="mt-2 text-mist">{error}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button className="btn btn-gold" onClick={retry}>Reintentar</button>
              {variant === 'cinema' ? <a className="btn btn-ghost" href={src.backHref}>Volver</a> : <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}
            </div>
          </div>
        </div>
      )}

      {src.next && nextCountdown !== null && (
        <div className="absolute bottom-28 right-4 z-20 w-72 animate-rise rounded-2xl border border-white/15 bg-black/80 p-4 backdrop-blur sm:right-8">
          <p className="eyebrow">Siguiente episodio</p>
          <p className="mt-1 font-semibold">{src.next.label}</p>
          <div className="mt-3 flex gap-2">
            <a href={src.next.watchHref} className="btn btn-primary btn-sm flex-1">{nextCountdown > 0 ? `Ver en ${nextCountdown}` : 'Ver ahora'}</a>
            <button className="btn btn-ghost btn-sm" onClick={() => setNextCountdown(-1)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Controles */}
      <div
        role="group"
        aria-label="Controles del reproductor"
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-16 transition-opacity duration-500 sm:px-6 sm:pb-6 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onFocus={poke}
      >
        <div
          className="relative h-5"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const x = Math.max(0, Math.min(e.clientX - r.left, r.width)); setHover({ x, t: (x / r.width) * duration }); }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/player:h-1.5">
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 bg-gold" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range" min={0} max={duration || 0} step={1} value={Math.min(time, duration || 0)}
            onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value); }}
            aria-label="Progreso" aria-valuetext={`${formatClock(time)} de ${formatClock(duration)}`}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 focus-visible:opacity-100 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gold"
          />
          {hover && duration > 0 && (
            <div className="pointer-events-none absolute bottom-6 -translate-x-1/2 text-center" style={{ left: Math.max(70, Math.min(hover.x, (wrap.current?.clientWidth ?? 400) - 90)) }}>
              {thumb && (
                <div className="mb-1 overflow-hidden rounded-md border border-white/20" style={{ width: thumb.w, height: thumb.h, backgroundImage: `url(${thumb.url})`, backgroundPosition: `-${thumb.x}px -${thumb.y}px` }} />
              )}
              <span className="rounded bg-black/80 px-2 py-0.5 text-xs tabular-nums">{formatClock(hover.t)}</span>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1 sm:gap-2">
          <button onClick={toggle} className="rounded-full p-2 hover:bg-white/15" aria-label={playing ? 'Pausar' : 'Reproducir'}><Icon name={playing ? 'pause' : 'play'} /></button>
          <button onClick={() => seekBy(-10)} className="rounded-full p-2 hover:bg-white/15" aria-label="Retroceder 10 segundos"><Icon name="back10" /></button>
          <button onClick={() => seekBy(10)} className="rounded-full p-2 hover:bg-white/15" aria-label="Adelantar 10 segundos"><Icon name="fwd10" /></button>
          <div className="group/vol hidden items-center sm:flex">
            <button onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} className="rounded-full p-2 hover:bg-white/15" aria-label={muted ? 'Activar sonido' : 'Silenciar'}>
              <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
            </button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} aria-label="Volumen"
              onChange={(e) => { if (video.current) { video.current.volume = Number(e.target.value); video.current.muted = false; } }}
              className="w-0 accent-[var(--color-gold)] transition-all group-hover/vol:w-24 focus-visible:w-24" />
          </div>
          <span className="ml-1 text-xs tabular-nums text-mist sm:text-sm">{formatClock(time)} / {formatClock(duration)}</span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {src.next && <a href={src.next.watchHref} className="hidden items-center gap-1 rounded-full px-3 py-2 text-sm hover:bg-white/15 sm:flex" aria-label={`Siguiente: ${src.next.label}`}><Icon name="next" size={18} /> Siguiente</a>}
            {src.subtitles.length > 0 && <MenuButton label="Subtítulos" icon="subs" active={menu === 'subs'} onClick={() => setMenu(menu === 'subs' ? null : 'subs')} />}
            {audioTracks.length > 1 && <MenuButton label="Audio" icon="audio" active={menu === 'audio'} onClick={() => setMenu(menu === 'audio' ? null : 'audio')} />}
            <MenuButton label="Velocidad" icon="speed" active={menu === 'speed'} onClick={() => setMenu(menu === 'speed' ? null : 'speed')} />
            {levels.length > 1 && <MenuButton label="Calidad" icon="quality" active={menu === 'quality'} onClick={() => setMenu(menu === 'quality' ? null : 'quality')} />}
            <button onClick={toggleFullscreen} className="rounded-full p-2 hover:bg-white/15" aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}><Icon name={fullscreen ? 'shrink' : 'expand'} /></button>
          </div>
        </div>

        {menu && (
          <div role="menu" className="absolute bottom-20 right-4 max-h-72 w-56 overflow-auto rounded-xl border border-white/10 bg-black/90 p-1.5 text-sm backdrop-blur sm:right-6">
            {menu === 'subs' && [{ language: 'off', label: 'Desactivados' }, ...src.subtitles].map((s) => (
              <MenuItem key={s.language} active={subtitle === s.language} onClick={() => chooseSubtitle(s.language)}>{s.label}</MenuItem>
            ))}
            {menu === 'speed' && SPEEDS.map((s) => <MenuItem key={s} active={speed === s} onClick={() => chooseSpeed(s)}>{s === 1 ? 'Normal' : `${s}×`}</MenuItem>)}
            {menu === 'quality' && [{ index: -1, label: 'Automática' }, ...levels].map((l) => <MenuItem key={l.index} active={level === l.index} onClick={() => chooseLevel(l.index)}>{l.label}</MenuItem>)}
            {menu === 'audio' && audioTracks.map((a) => <MenuItem key={a.index} active={audioTrack === a.index} onClick={() => chooseAudio(a.index)}>{a.label}</MenuItem>)}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({ label, icon, active, onClick }: { label: string; icon: Parameters<typeof Icon>[0]['name']; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-haspopup="menu" aria-expanded={active} aria-label={label} className={`rounded-full p-2 hover:bg-white/15 ${active ? 'bg-white/15 text-gold-soft' : ''}`}>
      <Icon name={icon} />
    </button>
  );
}

function MenuItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="menuitemradio" aria-checked={active} onClick={onClick} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10 ${active ? 'text-gold-soft' : ''}`}>
      {children}{active && <span aria-hidden>✓</span>}
    </button>
  );
}
