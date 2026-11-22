import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { resetDb, makeUser, mockFetch, json } from '../helpers';
import { sql } from '@/lib/db';
import { makeAssetPublic, VideoError } from '@/lib/video/service';
import { resolvePlayback } from '@/lib/playback';

describe('video subido como «firmado» por error', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeAll(resetDb);

  it('sin claves de firma no se puede ver, y «Hacer pública» lo arregla sin volver a subirlo', async () => {
    const admin = await makeUser('admin');
    const [ep] = await sql`select e.id from episodes e join titles t on t.id = e.title_id where t.slug = 'los-convidados-al-agape' and e.number = 1`;
    const [a] = await sql`insert into video_assets (owner_type, owner_id, provider, provider_asset_id, playback_id, playback_policy, status, is_current, version)
      values ('episode', ${ep.id}, 'mux', 'asset-firmado', 'pb-firmado', 'signed', 'in_review', false, 1) returning id`;
    vi.stubEnv('MUX_SIGNING_KEY_ID', ''); vi.stubEnv('MUX_SIGNING_PRIVATE_KEY', '');
    const before = await resolvePlayback({ contentType: 'episode', contentId: ep.id, viewer: admin, country: 'DO', preview: true });
    expect(before.ok === false && before.reason).toBe('provider_error');

    const calls = mockFetch({ 'https://mux.test/video/v1/assets/asset-firmado/playback-ids': () => json({ id: 'pb-publico', policy: 'public' }, 201) });
    const row = await makeAssetPublic(admin.id, a.id);
    expect(row).toMatchObject({ playback_id: 'pb-publico', playback_policy: 'public' });
    expect(JSON.parse(String(calls.mock.calls[0][1]?.body))).toEqual({ policy: 'public' });

    const after = await resolvePlayback({ contentType: 'episode', contentId: ep.id, viewer: admin, country: 'DO', preview: true });
    expect(after.ok && after.src).toBe('https://stream.mux.com/pb-publico.m3u8');
  });

  it('explica el error si Mux todavía no creó el video', async () => {
    const admin = await makeUser('admin');
    const [ep] = await sql`select id from episodes limit 1`;
    const [a] = await sql`insert into video_assets (owner_type, owner_id, provider, playback_policy, status, version)
      values ('episode', ${ep.id}, 'mux', 'signed', 'processing', 9) returning id`;
    await expect(makeAssetPublic(admin.id, a.id)).rejects.toBeInstanceOf(VideoError);
  });
});
