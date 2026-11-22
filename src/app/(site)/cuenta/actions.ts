'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { login, register, revokeSession, createSession, AuthError } from '@/lib/auth/core';
import { setSessionCookie, clearSessionCookie, sessionToken, requestMeta, getViewer } from '@/lib/auth/session';
import { rateLimit } from '@/lib/rate-limit';
import { sql } from '@/lib/db';
import { sha256 } from '@/lib/auth/core';

export type FormState = { error?: string; field?: string; ok?: string } | undefined;

function safeNext(raw: FormDataEntryValue | null): string {
  const n = String(raw || '/');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const meta = await requestMeta();
  if (!rateLimit(`login:${meta.ip}`, 10, 15 * 60_000).ok) return { error: 'Demasiados intentos. Espera unos minutos.' };
  try {
    const { token, expires } = await login(String(form.get('email') || ''), String(form.get('password') || ''), { userAgent: meta.userAgent });
    await setSessionCookie(token, expires);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, field: e.field };
    throw e;
  }
  redirect(safeNext(form.get('next')));
}

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const meta = await requestMeta();
  if (!rateLimit(`register:${meta.ip}`, 5, 60 * 60_000).ok) return { error: 'Demasiados registros desde esta conexión. Inténtalo más tarde.' };
  if (form.get('website')) return { error: 'No se pudo crear la cuenta.' }; // honeypot
  if (form.get('terms') !== 'on') return { error: 'Debes aceptar la política de privacidad.', field: 'terms' };
  try {
    const id = await register({
      email: String(form.get('email') || ''), password: String(form.get('password') || ''),
      displayName: String(form.get('name') || ''), marketingConsent: form.get('marketing') === 'on',
    });
    const { token, expires } = await createSession(id, meta.userAgent);
    await setSessionCookie(token, expires);
  } catch (e) {
    if (e instanceof AuthError) return { error: e.message, field: e.field };
    throw e;
  }
  redirect(safeNext(form.get('next')));
}

export async function logoutAction() {
  await revokeSession(await sessionToken());
  await clearSessionCookie();
  redirect('/');
}

export async function savePreferences(_prev: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) redirect('/cuenta/entrar');
  const size = String(form.get('subtitle_size'));
  await sql`update viewer_preferences set
      subtitle_language = ${String(form.get('subtitle_language') || '') || null},
      subtitle_size = ${['small', 'medium', 'large'].includes(size) ? size : 'medium'},
      autoplay_next = ${form.get('autoplay_next') === 'on'},
      autoplay_previews = ${form.get('autoplay_previews') === 'on'},
      data_saver = ${form.get('data_saver') === 'on'}
    where viewer_profile_id = ${viewer.viewerProfileId}`;
  await sql`update profiles set marketing_consent_at = ${form.get('marketing') === 'on' ? new Date() : null} where id = ${viewer.id}`;
  await sql`update viewer_profiles set name = ${String(form.get('profile_name') || viewer.displayName).slice(0, 60)} where id = ${viewer.viewerProfileId}`;
  revalidatePath('/cuenta');
  return { ok: 'Preferencias guardadas.' };
}

export async function revokeOtherSessions() {
  const viewer = await getViewer();
  if (!viewer) redirect('/cuenta/entrar');
  await sql`update user_sessions set revoked_at = now() where profile_id = ${viewer.id} and revoked_at is null and token_hash <> ${sha256((await sessionToken()) || '')}`;
  revalidatePath('/cuenta');
}
