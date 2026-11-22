import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb } from '../helpers';
import { sql } from '@/lib/db';
import { getHomeSections, upcomingReleases, searchCatalog } from '@/lib/catalog/public';
import { resolvePlayback } from '@/lib/playback';
import { demoSeed, demoClear } from '../../scripts/demo';

const quiet = { log: () => {} };
const snapshot = async () => ({
  counts: await sql`select (select count(*) from titles)::int t, (select count(*) from episodes)::int e, (select count(*) from media_images)::int i,
    (select count(*) from video_assets)::int v, (select count(*) from people)::int p, (select count(*) from release_schedules)::int r`,
  inaugural: await sql`select status, synopsis_short, tagline, source_book from titles where slug = 'los-convidados-al-agape'`,
});

describe('modo demostración', () => {
  beforeAll(resetDb);

  it('carga 10 obras simuladas visibles y reproducibles', async () => {
    const before = await snapshot();
    await demoSeed(quiet);
    const [{ n }] = await sql`select count(*)::int as n from titles where status in ('published', 'scheduled')`;
    expect(n).toBe(10);
    const home = await getHomeSections(null);
    expect(home.map((s) => s.heading)).toEqual(expect.arrayContaining(['Películas originales', 'Series originales', 'Próximamente', 'Cortometrajes', 'Documentales']));
    expect((await upcomingReleases()).length).toBe(4);
    expect((await searchCatalog('faro')).length).toBe(0); // estreno programado: aún no es buscable
    const [ep1] = await sql`select e.id from episodes e join titles t on t.id = e.title_id where t.slug = 'los-convidados-al-agape' and e.number = 1`;
    expect((await resolvePlayback({ contentType: 'episode', contentId: ep1.id, viewer: null, country: 'DO' })).ok).toBe(true);
    const [last] = await sql`select id from titles where slug = 'la-ultima-pagina'`;
    const p = await resolvePlayback({ contentType: 'title', contentId: last.id, viewer: null, country: 'DO' });
    expect(p.ok === false && p.reason).toBe('login_required');
    await expect(demoSeed(quiet)).rejects.toThrow(/ya está cargada/);
    // Al borrar, todo vuelve exactamente como estaba
    await demoClear(quiet);
    expect(await snapshot()).toEqual(before);
  });

  it('no toca una serie inaugural con materiales reales', async () => {
    const [t] = await sql`select id from titles where slug = 'los-convidados-al-agape'`;
    await sql`insert into media_images (owner_type, owner_id, kind, url, alt_text) values ('title', ${t.id}, 'poster', '/media/real.jpg', 'real')`;
    await expect(demoSeed(quiet)).rejects.toThrow(/no la toca/);
    const [{ n }] = await sql`select count(*)::int as n from titles`;
    expect(n).toBe(1);
  });
});
