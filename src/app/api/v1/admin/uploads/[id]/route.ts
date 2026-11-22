import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, viewerOf, sameOrigin, readJson } from '@/lib/http';
import { canEdit } from '@/lib/auth/core';
import { markUploadSent, markUploadFailed, refreshFromProvider } from '@/lib/video/service';
import { sql } from '@/lib/db';

const polled = new Map<string, number>();
const lastPoll = (id: string) => polled.get(id) ?? 0;

/** El navegador informa del resultado de la subida directa. El estado «listo» sólo lo fija el proveedor. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const viewer = await viewerOf(req);
  if (!canEdit(viewer)) return json({ error: 'No autorizado' }, 403);
  const { id } = await params;
  const parsed = z.object({ state: z.enum(['sent', 'failed']), message: z.string().max(500).optional() }).safeParse(await readJson(req));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Datos inválidos' }, 400);
  if (parsed.data.state === 'sent') await markUploadSent(id);
  else await markUploadFailed(id, parsed.data.message || 'error desconocido');
  return json({ ok: true });
}

/** Estado actual (para refrescar la interfaz mientras el proveedor procesa). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOf(req);
  if (!canEdit(viewer)) return json({ error: 'No autorizado' }, 403);
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'No encontrado' }, 404);
  const [row] = await sql`select id, provider, status, updated_at from video_assets where id = ${id}`;
  if (!row) return json({ error: 'No encontrado' }, 404);
  // Sin webhook (p. ej. en local, donde Mux no puede llamar a localhost) se pregunta al proveedor,
  // como mucho una vez cada 10 s por video. En producción el webhook suele llegar antes.
  if (row.provider === 'mux' && ['uploading', 'processing'].includes(row.status) && Date.now() - lastPoll(id) > 10_000) {
    polled.set(id, Date.now());
    await refreshFromProvider(viewer!.id, id, { quiet: true }).catch(() => {});
  }
  const [a] = await sql`select id, status, error_message, duration_seconds, max_resolution from video_assets where id = ${id}`;
  return json(a);
}
