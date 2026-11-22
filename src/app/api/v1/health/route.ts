import { sql } from '@/lib/db';
import { json } from '@/lib/http';
import { env } from '@/lib/env';
import { localUploadsAvailable } from '@/lib/video/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await sql`select 1`;
    return json({ ok: true, database: 'ok', video_provider: env.mux.configured ? 'mux' : localUploadsAvailable().ok ? 'local (pruebas) y enlaces' : 'solo enlaces', storage: env.storage.driver });
  } catch {
    return json({ ok: false, database: 'error' }, 503);
  }
}
