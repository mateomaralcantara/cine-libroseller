import { describe, it, expect, beforeAll, vi } from 'vitest';
import { resetDb, mockFetch } from '../helpers';
import { sql } from '@/lib/db';
import { getHomeSections, upcomingReleases, searchCatalog } from '@/lib/catalog/public';
import { resolvePlayback } from '@/lib/playback';
import { demoSeed, demoClear } from '../../scripts/demo';
import postgres from 'postgres';
import fs from 'node:fs';
import { migrate } from '../../scripts/migrate';
import { seed } from '../../scripts/seed';

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

  it('si falla a mitad (p. ej. Supabase Storage sin bucket) deshace todo lo creado', async () => {
    const before = await snapshot();
    vi.stubEnv('STORAGE_DRIVER', 'supabase'); vi.stubEnv('SUPABASE_URL', 'https://demo.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    mockFetch({ 'https://demo.supabase.co/': () => new Response('{"error":"Bucket not found"}', { status: 400 }) });
    await expect(demoSeed(quiet)).rejects.toThrow(/se deshizo todo lo creado.*STORAGE_DRIVER=local/);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    expect(await snapshot()).toEqual(before);
    const [demo] = await sql`select 1 from system_settings where key = 'demo'`;
    expect(demo).toBeUndefined();
  });

  it('no toca una serie inaugural con materiales reales', async () => {
    const [t] = await sql`select id from titles where slug = 'los-convidados-al-agape'`;
    await sql`insert into media_images (owner_type, owner_id, kind, url, alt_text) values ('title', ${t.id}, 'poster', '/media/real.jpg', 'real')`;
    await expect(demoSeed(quiet)).rejects.toThrow(/no la toca/);
    const [{ n }] = await sql`select count(*)::int as n from titles`;
    expect(n).toBe(1);
  });

  it('repara una demo antigua que quedó a medias (serie publicada sin imágenes)', async () => {
    await sql`delete from media_images`;
    await sql`update titles set status = 'published', published_at = now(), tagline = 'Nadie sube a la montaña sin una pregunta.' where slug = 'los-convidados-al-agape'`;
    await expect(demoSeed(quiet)).rejects.toThrow(/no la toca/);
    await demoClear(quiet);
    const [t] = await sql`select status, tagline from titles where slug = 'los-convidados-al-agape'`;
    expect(t).toEqual({ status: 'draft', tagline: null });
    await demoSeed(quiet);
    await demoClear(quiet);
  });
});

describe('esquema creado a mano (editor SQL de Supabase)', () => {
  it('db:migrate lo reconoce y lo registra sin volver a ejecutarlo', async () => {
    const url = process.env.DATABASE_URL!;
    const admin = postgres(url, { max: 1, onnotice: () => {} });
    await admin.unsafe('drop schema public cascade; create schema public; grant all on schema public to public;');
    for (const f of fs.readdirSync('supabase/migrations').sort()) await admin.unsafe(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));
    await admin.end();
    await seed(url, { log: false });
    await migrate(url, { log: false }); // no debe fallar con «already exists»
    const rows = await sql`select version from schema_migrations order by version`;
    expect(rows.length).toBe(fs.readdirSync('supabase/migrations').length);
    const [{ n }] = await sql`select count(*)::int as n from titles`;
    expect(n).toBe(1); // los datos existentes se conservan
  });
});
