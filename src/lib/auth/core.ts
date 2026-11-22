// Autenticación sin dependencia del framework (usable desde Server Actions, rutas API y pruebas).
import crypto from 'node:crypto';
import { sql, type Tx } from '../db';
import { hashPassword, verifyPassword, passwordProblem, DUMMY_HASH } from './password';

export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type Role = 'viewer' | 'editor' | 'admin';
export interface Viewer {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  viewerProfileId: string;
}

export class AuthError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export function deviceFromUA(ua: string | null | undefined): string {
  const u = (ua || '').toLowerCase();
  if (/smart-tv|smarttv|hbbtv|appletv|googletv|tizen|webos|roku|crkey/.test(u)) return 'tv';
  if (/ipad|tablet/.test(u)) return 'tablet';
  if (/mobi|iphone|android/.test(u)) return 'mobile';
  return u ? 'desktop' : 'unknown';
}

export async function register(
  input: { email: string; password: string; displayName: string; marketingConsent?: boolean; role?: Role },
  db: Tx = sql,
) {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.displayName || '').trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) throw new AuthError('Introduce un email válido.', 'email');
  if (!name) throw new AuthError('Indica tu nombre.', 'displayName');
  const pwErr = passwordProblem(input.password);
  if (pwErr) throw new AuthError(pwErr, 'password');
  const [exists] = await db`select 1 from profiles where lower(email) = ${email}`;
  if (exists) throw new AuthError('Ya existe una cuenta con ese email.', 'email');
  const [profile] = await db`
    insert into profiles (email, password_hash, display_name, role, marketing_consent_at)
    values (${email}, ${hashPassword(input.password)}, ${name}, ${input.role ?? 'viewer'}, ${input.marketingConsent ? new Date() : null})
    returning id`;
  await ensureViewerProfile(profile.id as string, name, db);
  return profile.id as string;
}

export async function ensureViewerProfile(profileId: string, name: string, db: Tx = sql): Promise<string> {
  const [existing] = await db`select id from viewer_profiles where profile_id = ${profileId} and is_default`;
  if (existing) return existing.id as string;
  const [vp] = await db`insert into viewer_profiles (profile_id, name, is_default) values (${profileId}, ${name}, true) returning id`;
  await db`insert into viewer_preferences (viewer_profile_id) values (${vp.id}) on conflict do nothing`;
  await db`insert into watchlists (viewer_profile_id) values (${vp.id})`;
  return vp.id as string;
}

/** Verifica credenciales y crea una sesión. Devuelve el token en claro (sólo para la cookie). */
export async function login(emailRaw: string, password: string, meta: { userAgent?: string | null } = {}) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const [p] = await sql`select * from profiles where lower(email) = ${email}`;
  if (!p) {
    verifyPassword(String(password || ''), DUMMY_HASH); // igualar tiempos de respuesta
    throw new AuthError('Email o contraseña incorrectos.');
  }
  if (p.locked_until && new Date(p.locked_until) > new Date()) {
    throw new AuthError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
  }
  if (!verifyPassword(String(password || ''), p.password_hash) || p.status !== 'active') {
    const failed = (p.failed_logins as number) + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await sql`update profiles set failed_logins = ${lock ? 0 : failed}, locked_until = ${lock} where id = ${p.id}`;
    throw new AuthError('Email o contraseña incorrectos.');
  }
  await sql`update profiles set failed_logins = 0, locked_until = null, last_login_at = now() where id = ${p.id}`;
  await ensureViewerProfile(p.id, p.display_name);
  return createSession(p.id, meta.userAgent);
}

export async function createSession(profileId: string, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await sql`insert into user_sessions (profile_id, token_hash, user_agent, device, expires_at)
    values (${profileId}, ${sha256(token)}, ${(userAgent || '').slice(0, 300)}, ${deviceFromUA(userAgent)}, ${expires})`;
  return { token, expires };
}

export async function viewerFromToken(token: string | undefined | null): Promise<Viewer | null> {
  if (!token) return null;
  const [row] = await sql`
    select p.id, p.email, p.display_name, p.role, vp.id as vp_id, s.id as session_id, s.last_seen_at
    from user_sessions s
    join profiles p on p.id = s.profile_id
    left join viewer_profiles vp on vp.profile_id = p.id and vp.is_default
    where s.token_hash = ${sha256(token)} and s.revoked_at is null and s.expires_at > now() and p.status = 'active'`;
  if (!row) return null;
  // Actualiza la actividad como mucho cada 10 minutos para evitar escrituras constantes
  if (Date.now() - new Date(row.last_seen_at).getTime() > 600_000) {
    await sql`update user_sessions set last_seen_at = now() where id = ${row.session_id}`;
  }
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, viewerProfileId: row.vp_id };
}

export async function revokeSession(token: string | undefined | null) {
  if (token) await sql`update user_sessions set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
}

export const canEdit = (v: Viewer | null) => !!v && (v.role === 'editor' || v.role === 'admin');
export const isAdmin = (v: Viewer | null) => !!v && v.role === 'admin';
