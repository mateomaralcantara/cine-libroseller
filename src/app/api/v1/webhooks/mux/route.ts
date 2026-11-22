import type { NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { handleMuxWebhook } from '@/lib/video/service';

export const dynamic = 'force-dynamic';

/** Webhook de Mux (firma HMAC verificada, idempotente). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return json({ error: 'demasiado grande' }, 413);
  const out = await handleMuxWebhook(raw, req.headers.get('mux-signature'));
  return json({ result: out.result }, out.status);
}
