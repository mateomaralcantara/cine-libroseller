import crypto from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb } from '../helpers';
import { sql } from '@/lib/db';
import { ingestCineViral } from '@/lib/catalog/ingest';

const SECRET = 'cv-secret';
function signed(payload: unknown) {
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  return { body, sig: `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}` };
}
const okFetch = (async () => new Response('#EXTM3U\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } })) as unknown as typeof fetch;

describe('integración CineViral (producciones terminadas)', () => {
  beforeAll(resetDb);

  it('rechaza firmas inválidas y sin secreto configurado', async () => {
    const { body } = signed({});
    expect((await ingestCineViral(body, 't=1,v1=00', SECRET)).status).toBe(401);
    expect((await ingestCineViral(body, null, undefined)).status).toBe(503);
  });

  it('crea la obra como borrador, con derechos sin verificar, y es idempotente', async () => {
    const ev = { id: 'evt-1', type: 'production.completed', data: { production_id: 'CV-001', title: 'El Huerto', type: 'short', synopsis: 'Un corto.', video_url: 'https://cdn.test/huerto.m3u8',
      distribution: { rights_holder: 'CineViral', territories: ['DO'] } } };
    const { body, sig } = signed(ev);
    const r = await ingestCineViral(body, sig, SECRET, okFetch);
    expect(r.result).toBe('recibido como borrador');
    const [t] = await sql`select * from titles where external_ref = 'CV-001'`;
    expect(t.status).toBe('draft');
    const [right] = await sql`select verified from content_rights where title_id = ${t.id}`;
    expect(right.verified).toBe(false);
    const [asset] = await sql`select status, provider from video_assets where owner_id = ${t.id}`;
    expect(asset).toMatchObject({ status: 'in_review', provider: 'link' });
    expect((await ingestCineViral(body, sig, SECRET, okFetch)).result).toBe('duplicado');
  });

  it('no modifica en silencio una obra ya publicada', async () => {
    await sql`update titles set status = 'published' where external_ref = 'CV-001'`;
    const { body, sig } = signed({ id: 'evt-2', type: 'production.completed', data: { production_id: 'CV-001', title: 'Título cambiado' } });
    expect((await ingestCineViral(body, sig, SECRET, okFetch)).result).toMatch(/revisión manual/);
    const [t] = await sql`select title from titles where external_ref = 'CV-001'`;
    expect(t.title).toBe('El Huerto');
  });
});
