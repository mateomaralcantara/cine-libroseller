import crypto from 'node:crypto';
import postgres from 'postgres';
import { vi } from 'vitest';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { sql } from '@/lib/db';
import { register, viewerFromToken, createSession } from '@/lib/auth/core';

/** Base de datos limpia: borra el esquema, aplica migraciones y la siembra base. */
export async function resetDb() {
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop schema public cascade; create schema public; grant all on schema public to public;`);
  await admin.end();
  await migrate(process.env.DATABASE_URL!, { log: false });
  await seed(process.env.DATABASE_URL!, { log: false });
}

export async function makeUser(role: 'viewer' | 'editor' | 'admin' = 'viewer', email = `${role}-${crypto.randomBytes(4).toString('hex')}@test.example`) {
  await register({ email, password: 'Prueba2026segura', displayName: role });
  if (role !== 'viewer') await sql`update profiles set role = ${role} where lower(email) = ${email}`;
  const [p] = await sql`select id from profiles where lower(email) = ${email}`;
  const { token } = await createSession(p.id, 'vitest');
  return (await viewerFromToken(token))!;
}

/** Firma un webhook como lo haría Mux. */
export function muxWebhook(type: string, data: Record<string, unknown>, id: string = crypto.randomUUID()) {
  const body = JSON.stringify({ id, type, data, created_at: new Date().toISOString() });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.MUX_WEBHOOK_SECRET!).update(`${t}.${body}`).digest('hex');
  return { body, header: `t=${t},v1=${sig}` };
}

/** Sustituye fetch para simular la API de Mux y los CDN externos. */
export function mockFetch(routes: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [prefix, handler] of Object.entries(routes)) if (url.startsWith(prefix)) return handler(url, init);
    throw new TypeError(`fetch failed (sin ruta simulada para ${url})`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });

export async function addImage(ownerType: string, ownerId: string, kind: string) {
  await sql`insert into media_images (owner_type, owner_id, kind, url, alt_text) values (${ownerType}, ${ownerId}, ${kind}, ${`/media/test/${kind}.jpg`}, ${kind})`;
}

export async function verifyRights(actorId: string, titleId: string) {
  await sql`insert into content_rights (title_id, rights_type, holder, verified) values (${titleId}, 'streaming', 'Cine LibroSeller Studios', true)`;
  void actorId;
}
