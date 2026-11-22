// Integración de la sesión con Next.js (cookies). Sólo en el servidor.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { viewerFromToken, canEdit, isAdmin, type Viewer } from './core';
import { env } from '../env';

export const SESSION_COOKIE = 'cls_session';

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const jar = await cookies();
  return viewerFromToken(jar.get(SESSION_COOKIE)?.value);
});

export async function setSessionCookie(token: string, expires: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', expires });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function requireViewer(next = '/'): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/cuenta/entrar?next=${encodeURIComponent(next)}`);
  return v;
}

export async function requireEditor(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/cuenta/entrar?next=/admin');
  if (!canEdit(v)) redirect('/?acceso=denegado');
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await requireEditor();
  if (!isAdmin(v)) redirect('/admin?acceso=solo-administradores');
  return v;
}

export async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get('user-agent'),
    // País aproximado sólo si lo aporta la plataforma de despliegue (Vercel / Cloudflare)
    country: h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || null,
    ip: (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'local',
  };
}
