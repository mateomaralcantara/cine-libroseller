import type { NextRequest } from 'next/server';
import { json, viewerOf, sameOrigin } from '@/lib/http';
import { canEdit } from '@/lib/auth/core';
import { appendLocalChunk, completeLocalUpload, localUploadOffset, VideoError, LOCAL_CHUNK_BYTES } from '@/lib/video/service';

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f-]{36}$/i;

async function guard(req: NextRequest, write: boolean) {
  if (write && !sameOrigin(req)) return { error: json({ error: 'Origen no permitido' }, 403) };
  const viewer = await viewerOf(req);
  if (!canEdit(viewer)) return { error: json({ error: 'No autorizado' }, 403) };
  return { viewer: viewer! };
}

const fail = (e: unknown) => {
  if (e instanceof VideoError) return json({ error: e.message }, 422);
  console.error(e);
  return json({ error: 'Error al procesar la subida.' }, 500);
};

/** Cuántos bytes tiene ya el servidor (para reanudar). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const g = await guard(req, false);
  if (g.error) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: 'No encontrado' }, 404);
  try { return json(await localUploadOffset(id)); } catch (e) { return fail(e); }
}

/** Añade una parte del archivo: PUT ?offset=<byte inicial> con el contenido binario. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const g = await guard(req, true);
  if (g.error) return g.error;
  const { id } = await params;
  const offset = Number(req.nextUrl.searchParams.get('offset'));
  if (!UUID.test(id) || !Number.isInteger(offset) || offset < 0) return json({ error: 'Datos inválidos' }, 400);
  const len = Number(req.headers.get('content-length') || 0);
  if (len > LOCAL_CHUNK_BYTES * 2) return json({ error: 'Parte demasiado grande' }, 413);
  try {
    const chunk = Buffer.from(await req.arrayBuffer());
    const out = await appendLocalChunk(id, offset, chunk);
    return json(out, out.mismatch ? 409 : 200);
  } catch (e) { return fail(e); }
}

/** Cierra la subida: verifica el archivo y lo deja «En revisión». */
export async function POST(req: NextRequest, { params }: Ctx) {
  const g = await guard(req, true);
  if (g.error) return g.error;
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: 'No encontrado' }, 404);
  try { return json(await completeLocalUpload(g.viewer.id, id)); } catch (e) { return fail(e); }
}
