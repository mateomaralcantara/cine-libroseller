// Formatos compartidos por servidor y cliente.

export function slugify(input: string): string {
  return input
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  if (!d) return '';
  const date = typeof d === 'string' && d.length === 10 ? new Date(`${d}T12:00:00Z`) : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-DO', { timeZone: 'America/Santo_Domingo', ...opts });
}

export function yearOf(d: string | Date | null | undefined): string {
  if (!d) return '';
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 4);
}

export const TYPE_LABEL: Record<string, string> = {
  movie: 'Película', series: 'Serie', short: 'Cortometraje', documentary: 'Documental', special: 'Especial',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', in_review: 'En revisión', scheduled: 'Programado', published: 'Publicado', withdrawn: 'Retirado', archived: 'Archivado',
};

export const VIDEO_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente', uploading: 'Cargando', processing: 'Procesando', in_review: 'En revisión', ready: 'Listo', published: 'Publicado', error: 'Error',
};

export const AI_LABEL: Record<string, string> = {
  none: 'Sin IA generativa',
  assisted: 'Producción asistida por IA',
  modified: 'Contiene imágenes o sonido modificados con IA',
  generated: 'Contiene contenido generado con IA',
};

export const ACCESS_LABEL: Record<string, string> = { free: 'Gratis', registered: 'Gratis con cuenta', premium: 'Premium' };

export const TRAILER_KIND_LABEL: Record<string, string> = {
  trailer: 'Tráiler', teaser: 'Teaser', clip: 'Clip', behind_the_scenes: 'Detrás de cámaras', interview: 'Entrevista', featurette: 'Making of', lecture: 'Conferencia',
};

export const CREDIT_ROLE_LABEL: Record<string, string> = {
  director: 'Dirección', writer: 'Guion', cast: 'Reparto', producer: 'Producción', executive_producer: 'Producción ejecutiva',
  composer: 'Música', cinematographer: 'Fotografía', editor: 'Montaje', vfx: 'VFX / IA', other: 'Equipo',
};

/** Ruta pública canónica de un título. */
export function titlePath(t: { type: string; slug: string }): string {
  return t.type === 'series' ? `/series/${t.slug}` : `/peliculas/${t.slug}`;
}

export function episodePath(seriesSlug: string, season: number, episode: number): string {
  return `/series/${seriesSlug}/temporada-${season}/episodio-${episode}`;
}
