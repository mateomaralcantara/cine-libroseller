import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, viewerOf, sameOrigin, readJson, limited } from '@/lib/http';
import { sql } from '@/lib/db';

const CONSENT_TEXT = 'Acepto recibir un correo cuando se estrene. Puedo darme de baja en cualquier momento.';

/** Aviso de estreno con consentimiento explícito. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Origen no permitido' }, 403);
  const tooMany = limited(req, 'notify', 10, 10 * 60_000);
  if (tooMany) return tooMany;
  const parsed = z.object({ releaseId: z.string().uuid(), email: z.string().trim().toLowerCase().email().max(254), consent: z.literal(true) }).safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Indica un email válido y acepta recibir el aviso.' }, 400);
  const [r] = await sql`select id from release_schedules where id = ${parsed.data.releaseId} and is_public and status in ('announced', 'confirmed', 'postponed')`;
  if (!r) return json({ error: 'Este estreno ya no admite avisos.' }, 404);
  const viewer = await viewerOf(req);
  await sql`insert into release_notifications (release_schedule_id, email, profile_id, consent_text)
    values (${r.id}, ${parsed.data.email}, ${viewer?.id ?? null}, ${CONSENT_TEXT})
    on conflict (release_schedule_id, lower(email)) do update set unsubscribed_at = null, consented_at = now()`;
  return json({ ok: true }, 201);
}
