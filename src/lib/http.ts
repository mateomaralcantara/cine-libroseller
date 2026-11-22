import { NextResponse, type NextRequest } from 'next/server';
import { viewerFromToken, type Viewer } from './auth/core';
import { rateLimit } from './rate-limit';

export const SESSION_COOKIE = 'cls_session';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

export function clientIp(req: NextRequest) {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}

export function country(req: NextRequest) {
  return req.headers.get('x-vercel-ip-country') || req.headers.get('cf-ipcountry') || null;
}

export function consentGiven(req: NextRequest) {
  return req.cookies.get('cls_consent')?.value === 'yes';
}

/** Protección CSRF para peticiones que modifican datos: el Origin debe ser este mismo sitio. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function viewerOf(req: NextRequest): Promise<Viewer | null> {
  return viewerFromToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function readJson<T = unknown>(req: NextRequest, maxBytes = 16_384): Promise<T | null> {
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export function limited(req: NextRequest, key: string, max: number, windowMs: number) {
  const r = rateLimit(`${key}:${clientIp(req)}`, max, windowMs);
  return r.ok ? null : json({ error: 'Demasiadas solicitudes. Inténtalo en un momento.' }, 429, { 'retry-after': String(r.retryAfter) });
}
