import type { NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { env } from '@/lib/env';
import { ingestCineViral } from '@/lib/catalog/ingest';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 500_000) return json({ error: 'demasiado grande' }, 413);
  const out = await ingestCineViral(raw, req.headers.get('cineviral-signature'), env.cineviralSecret);
  return json(out, out.status);
}
