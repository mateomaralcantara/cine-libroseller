'use client';
// Envío de eventos de analítica (sólo agregados si no hay consentimiento).

export const CONSENT_KEY = 'cls_consent';

export function hasConsent(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
}

export function setConsent(value: 'yes' | 'no') {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* almacenamiento no disponible */ }
  document.cookie = `${CONSENT_KEY}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}

function utm() {
  try {
    const stored = sessionStorage.getItem('cls_utm');
    const p = new URLSearchParams(location.search);
    if (p.get('utm_source')) {
      const v = { source: p.get('utm_source') || undefined, medium: p.get('utm_medium') || undefined, campaign: p.get('utm_campaign') || undefined };
      sessionStorage.setItem('cls_utm', JSON.stringify(v));
      return v;
    }
    return stored ? JSON.parse(stored) : undefined;
  } catch { return undefined; }
}

function source() {
  try {
    if (!document.referrer) return 'directo';
    const host = new URL(document.referrer).hostname;
    return host === location.hostname ? 'interno' : host.replace(/^www\./, '').slice(0, 80);
  } catch { return undefined; }
}

export type TrackEvent = {
  event: 'page_view' | 'play_start' | 'play_valid' | 'heartbeat' | 'pause' | 'complete' | 'error' | 'trailer_start' | 'share' | 'book_click';
  contentType: 'episode' | 'title' | 'trailer';
  contentId: string;
  sessionKey?: string;
  position?: number;
  watched?: number;
  errorCode?: string;
};

export function track(e: TrackEvent, { beacon = false } = {}) {
  const body = JSON.stringify({ ...e, source: e.event === 'page_view' ? source() : undefined, utm: e.event === 'page_view' ? utm() : undefined });
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/events', new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch('/api/v1/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* nunca romper la experiencia por la analítica */ }
}

export function randomKey() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
