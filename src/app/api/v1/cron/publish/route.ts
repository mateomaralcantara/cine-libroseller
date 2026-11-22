import type { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { json } from '@/lib/http';
import { activateScheduled } from '@/lib/catalog/admin';

export const dynamic = 'force-dynamic';

/** Activa estrenos programados. Vercel Cron envía `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return json({ error: 'No autorizado' }, 401);
  }
  return json({ ok: true, activated: await activateScheduled() });
}
