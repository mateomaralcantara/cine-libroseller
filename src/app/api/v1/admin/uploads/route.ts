import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, viewerOf, sameOrigin, readJson } from '@/lib/http';
import { canEdit } from '@/lib/auth/core';
import { createMuxUpload, VideoError } from '@/lib/video/service';

const schema = z.object({
  ownerType: z.enum(['episode', 'title', 'trailer']),
  ownerId: z.string().uuid(),
  signed: z.boolean().default(false),
  file: z.object({ name: z.string().min(1).max(250), size: z.number().int().positive(), type: z.string().max(100) }),
});

/** Registra el trabajo de carga y devuelve la URL de subida directa (reanudable) del proveedor. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const viewer = await viewerOf(req);
  if (!canEdit(viewer)) return json({ error: 'No autorizado' }, 403);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Datos de subida inválidos' }, 400);
  try {
    const out = await createMuxUpload(viewer!.id, { ...parsed.data, corsOrigin: req.headers.get('origin')! });
    return json(out, 201);
  } catch (e) {
    if (e instanceof VideoError) return json({ error: e.message }, 422);
    console.error(e);
    return json({ error: 'No se pudo iniciar la subida.' }, 500);
  }
}
