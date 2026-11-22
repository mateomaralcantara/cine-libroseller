// MODO DEMOSTRACIÓN (sólo para desarrollo y presentaciones internas).
//   npm run demo:seed   → carga 10 obras simuladas y rellena la serie inaugural con materiales de prueba
//   npm run demo:clear  → borra TODO lo creado por la demo y deja la serie inaugural como estaba
// Las imágenes se generan aquí (arte abstracto, sin personas reales). Los videos son películas libres de prueba
// (Blender Foundation, Apple) servidas por HLS desde sus CDN públicos. No se generan estadísticas falsas.
import './load-env';
import { sql } from '../src/lib/db';
import { storeImage, storeSubtitle, deleteObject } from '../src/lib/media/storage';
import { makeArt } from './demo-art';

const VIDEO = {
  bunny: process.env.DEMO_VIDEO_URL || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', // Big Buck Bunny (CC BY, Blender Foundation)
  steel: process.env.DEMO_VIDEO_URL || 'https://test-streams.mux.dev/tos_ismc/main.m3u8', // Tears of Steel (CC BY, Blender Foundation)
  bipbop: process.env.DEMO_VIDEO_URL || 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', // señal de prueba de Apple
};

type Row = Record<string, unknown>;
const JSONB = new Set(['source_book', 'related_links', 'relationships', 'config', 'payload', 'value', 'detail', 'snapshot']);
interface DemoState { created: { table: string; id: string }[]; updated: { table: string; id: string; row: Row }[]; files: string[]; at: string }

const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);

export async function demoSeed({ log = console.log } = {}) {
  const [existing] = await sql`select 1 from system_settings where key = 'demo'`;
  if (existing) throw new Error('La demostración ya está cargada. Bórrala antes con «npm run demo:clear».');
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (!/localhost|127\.0\.0\.1/.test(site) && process.env.DEMO_FORCE !== '1') {
    throw new Error(`NEXT_PUBLIC_SITE_URL es ${site}: la demo es para tu entorno local. Si de verdad quieres cargarla ahí, define DEMO_FORCE=1.`);
  }
  const [inaugural] = await sql`select * from titles where slug = 'los-convidados-al-agape'`;
  if (!inaugural) throw new Error('Falta la serie inaugural: ejecuta antes «npm run db:seed».');
  const [{ n: realMedia }] = await sql`select (select count(*) from media_images where owner_id = ${inaugural.id})
    + (select count(*) from video_assets va join episodes e on e.id = va.owner_id where e.title_id = ${inaugural.id})::int as n`;
  if (inaugural.status !== 'draft' || Number(realMedia) > 0) {
    throw new Error('«Los Convidados al Ágape» ya tiene materiales o está publicada: la demo no la toca para no mezclar contenido real con simulado.');
  }

  const state: DemoState = { created: [], updated: [], files: [], at: new Date().toISOString() };
  const genre = Object.fromEntries((await sql`select slug, id from genres`).map((g) => [g.slug, g.id]));
  const category = Object.fromEntries((await sql`select slug, id from categories`).map((c) => [c.slug, c.id]));

  async function ins(table: string, row: Row) {
    const [r] = await sql`insert into ${sql(table)} ${sql(row as never)} returning *`;
    if (r.id) state.created.push({ table, id: String(r.id) });
    return r;
  }
  async function upd(table: string, id: string, changes: Row) {
    const [before] = await sql`select * from ${sql(table)} where id = ${id}`;
    if (!state.updated.some((u) => u.table === table && u.id === id)) state.updated.push({ table, id, row: JSON.parse(JSON.stringify(before)) });
    await sql`update ${sql(table)} set ${sql(changes as never)} where id = ${id}`;
  }
  let seed = 1;
  async function art(ownerType: string, ownerId: string, kind: string, alt: string, palette: [string, string, string, string], size: [number, number], extra: Partial<Parameters<typeof makeArt>[0]> = {}) {
    const png = makeArt({ width: size[0], height: size[1], palette, seed: seed++ * 7919, ...extra });
    const saved = await storeImage(`demo/${ownerType}`, png);
    state.files.push(saved.path);
    await ins('media_images', { owner_type: ownerType, owner_id: ownerId, kind, url: saved.url, storage_path: saved.path, width: saved.width, height: saved.height, alt_text: alt });
    return saved.url;
  }
  async function video(ownerType: 'episode' | 'title' | 'trailer', ownerId: string, url: string, published: boolean) {
    await ins('video_assets', { owner_type: ownerType, owner_id: ownerId, provider: 'link', source_url: url, status: published ? 'published' : 'ready', is_current: true, version: 1, original_filename: 'demo' });
  }
  async function rights(titleId: string) {
    await ins('content_rights', { title_id: titleId, rights_type: 'streaming', holder: 'Cine LibroSeller Studios (demo)', verified: true, notes: 'Registro de demostración' });
  }
  async function taxonomies(titleId: string, genres: string[], categories: string[]) {
    for (const g of genres) if (genre[g]) await sql`insert into title_genres (title_id, genre_id) values (${titleId}, ${genre[g]}) on conflict do nothing`;
    for (const c of categories) if (category[c]) await sql`insert into title_categories (title_id, category_id) values (${titleId}, ${category[c]}) on conflict do nothing`;
  }
  async function person(name: string, bio: string) {
    const slug = `demo-${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`;
    return ins('people', { slug, name, bio });
  }

  type FilmSpec = {
    slug: string; type: 'movie' | 'short' | 'documentary'; title: string; tagline: string; short: string; long: string; year: number; minutes: number;
    rating: string; genres: string[]; categories: string[]; palette: [string, string, string, string]; video: string; trailer?: string;
    access?: 'free' | 'registered'; ai?: { kind: 'assisted' | 'modified' | 'generated'; note: string }; book?: Row; status?: 'published' | 'scheduled'; publishIn?: number;
    director: string; cast: string[];
  };

  async function film(f: FilmSpec) {
    const status = f.status ?? 'published';
    const t = await ins('titles', {
      slug: f.slug, type: f.type, title: f.title, tagline: f.tagline, synopsis_short: f.short, synopsis_long: f.long,
      release_date: `${f.year}-${String(1 + (seed % 12)).padStart(2, '0')}-15`, runtime_minutes: f.minutes, age_rating: f.rating,
      country: 'República Dominicana', status, access: f.access ?? 'free', publish_at: status === 'scheduled' ? days(f.publishIn ?? 21) : null,
      published_at: status === 'published' ? days(-(seed % 40)) : null, ai_disclosure: f.ai?.kind ?? 'none', ai_disclosure_note: f.ai?.note ?? null,
      source_book: f.book ? sql.json(f.book as never) : null, external_ref: `demo:${f.slug}`,
    });
    await taxonomies(t.id, f.genres, f.categories);
    await art('title', t.id, 'poster', `Cartel de ${f.title}`, f.palette, [500, 750]);
    await art('title', t.id, 'backdrop', `Imagen de ${f.title}`, f.palette, [1280, 720], { ridges: 4 });
    await rights(t.id);
    await video('title', t.id, f.video, status === 'published');
    if (f.trailer) {
      const tr = await ins('trailers', { title_id: t.id, name: 'Tráiler oficial', kind: 'trailer', is_primary: true, is_published: true });
      await video('trailer', tr.id, f.trailer, true);
    }
    const d = await person(f.director, 'Perfil de demostración.');
    await ins('title_credits', { title_id: t.id, person_id: d.id, role: 'director', position: 0 });
    for (const [i, name] of f.cast.entries()) {
      const p = await person(name, 'Perfil de demostración.');
      await ins('title_credits', { title_id: t.id, person_id: p.id, role: 'cast', position: i + 1 });
    }
    log(`  ✓ ${f.title} (${f.type === 'movie' ? 'película' : f.type === 'short' ? 'cortometraje' : 'documental'}${status === 'scheduled' ? ', estreno programado' : ''})`);
    return t;
  }

  type EpSpec = { name: string; synopsis: string; minutes: number; video?: string; status: 'published' | 'scheduled' | 'draft'; publishIn?: number };
  async function seriesContent(titleId: string, seasonId: string, seasonNumber: number, eps: EpSpec[], palette: [string, string, string, string], startAt = 1) {
    const ids: string[] = [];
    for (const [i, e] of eps.entries()) {
      const ep = await ins('episodes', {
        season_id: seasonId, title_id: titleId, number: startAt + i, name: e.name, synopsis: e.synopsis, runtime_minutes: e.minutes, status: e.status,
        publish_at: e.status === 'scheduled' ? days(e.publishIn ?? 10) : null, published_at: e.status === 'published' ? days(-(14 - i)) : null,
      });
      if (e.video) await video('episode', ep.id, e.video, e.status === 'published');
      await art('episode', ep.id, 'thumbnail', `Fotograma de «${e.name}»`, palette, [800, 450], { ridges: 2 + (i % 3) });
      ids.push(ep.id);
      void seasonNumber;
    }
    return ids;
  }

  log('Cargando la demostración…');

  // ------------------------------------------------------------------ 1. Serie inaugural (materiales simulados)
  const conv = inaugural.id as string;
  const convPalette: [string, string, string, string] = ['#140f1f', '#b5693c', '#ffe2b0', '#2b1a22'];
  await upd('titles', conv, {
    tagline: 'Nadie sube a la montaña sin una pregunta.',
    synopsis_short: 'Siete desconocidos reciben la misma invitación a un banquete en lo alto de una montaña. Sólo uno sabe por qué fue elegido.',
    synopsis_long: 'Una invitación sin remitente reúne a siete desconocidos en un refugio de montaña. Mientras la tormenta los aísla, cada convidado descubre que la cena es también una pregunta: ¿qué estarías dispuesto a pedir si supieras que serás escuchado?\n\nDrama filosófico, misterio y suspenso existencial en episodios breves.\n\n(Texto de demostración.)',
    age_rating: '+13', release_date: days(-14).toISOString().slice(0, 10), status: 'published', published_at: days(-14),
    source_book: sql.json({ title: 'Los Convidados al Ágape', author: 'Autor de la novela (demo)', relation: 'Adaptación de la novela homónima.', purchase_url: 'https://libroseller.com' }),
  });
  await art('title', conv, 'poster', 'Cartel de Los Convidados al Ágape', convPalette, [500, 750], { sun: { x: 0.5, y: 0.3, r: 0.11 } });
  await art('title', conv, 'backdrop', 'Montaña al atardecer', convPalette, [1280, 720], { ridges: 4, sun: { x: 0.68, y: 0.34, r: 0.08 } });
  await art('title', conv, 'gallery', 'Fotograma: el refugio', ['#0c1420', '#3a5f7a', '#e9efe9', '#0b141b'], [960, 540]);
  await art('title', conv, 'gallery', 'Fotograma: la mesa del banquete', ['#1c120c', '#8a5a2b', '#ffd28f', '#1a0f08'], [960, 540]);
  await rights(conv);
  const [season] = await sql`select * from seasons where title_id = ${conv} and number = 1`;
  await upd('seasons', season.id, { status: 'published', synopsis: 'La invitación, la subida y la primera noche en el refugio.' });
  const [ep1] = await sql`select * from episodes where season_id = ${season.id} and number = 1`;
  await upd('episodes', ep1.id, {
    status: 'published', published_at: days(-14),
    synopsis: 'Matías recibe una carta que no recuerda haber pedido y emprende la subida hacia el refugio donde lo esperan seis desconocidos.',
  });
  await video('episode', ep1.id, VIDEO.bunny, true);
  await art('episode', ep1.id, 'thumbnail', 'Fotograma de «La petición en la montaña»', convPalette, [800, 450], { ridges: 3 });
  const vtt = await storeSubtitle('demo/subtitles', Buffer.from('WEBVTT\n\n1\n00:00:02.000 --> 00:00:08.000\n(Subtítulos de demostración)\n\n2\n00:00:10.000 --> 00:00:16.000\n—¿Quién te invitó?\n—Nadie. Por eso vine.\n'));
  state.files.push(vtt.path);
  await ins('subtitle_tracks', { owner_type: 'episode', owner_id: ep1.id, language: 'es', label: 'Español', url: vtt.url, storage_path: vtt.path, is_default: false });
  const [ep2Id, ep3Id] = await seriesContent(conv, season.id, 1, [
    { name: 'El banquete de los ausentes', synopsis: 'Falta un convidado en la mesa, pero su plato está servido.', minutes: 16, video: VIDEO.steel, status: 'scheduled', publishIn: 10 },
    { name: 'Lo que el agua recuerda', synopsis: 'La tormenta corta el camino de vuelta.', minutes: 15, status: 'draft' },
  ], convPalette, 2);
  const [rel1] = await sql`select * from release_schedules where episode_id = ${ep1.id}`;
  if (rel1) await upd('release_schedules', rel1.id, { status: 'released', is_public: false });
  await ins('release_schedules', { title_id: conv, episode_id: ep2Id, headline: 'Estreno del episodio 2', release_at: days(10), is_confirmed: true, status: 'confirmed', is_public: true });
  await ins('release_schedules', { title_id: conv, episode_id: ep3Id, headline: 'Episodio 3', date_label: 'Primavera 2027', is_confirmed: false, status: 'announced', is_public: true });
  const teaser = await ins('trailers', { title_id: conv, name: 'Tráiler oficial', kind: 'trailer', is_primary: true, is_published: true });
  await video('trailer', teaser.id, VIDEO.bipbop, true);
  const making = await ins('trailers', { title_id: conv, name: 'Así construimos la montaña', kind: 'behind_the_scenes', description: 'Del decorado real al plano final.', is_published: true });
  await video('trailer', making.id, VIDEO.bunny, true);
  const people = [
    await person('Lucía Marte', 'Actriz de demostración.'), await person('Rafael Espaillat', 'Actor de demostración.'),
    await person('Inés Cabral', 'Actriz de demostración.'), await person('Tomás Alcántara', 'Director de demostración.'),
  ];
  const chars = [
    { name: 'Matías', summary: 'El último en llegar. Lleva la carta en el bolsillo y no se la enseña a nadie.', actor: people[1], rel: [{ name: 'Abigail', relation: 'Se reconocen sin saber de dónde' }] },
    { name: 'Abigail', summary: 'Restauradora de órganos de iglesia. Escucha más de lo que habla.', actor: people[0], rel: [{ name: 'El Anfitrión', relation: 'Le debe un favor antiguo' }] },
    { name: 'El Anfitrión', summary: 'Nadie lo ha visto, pero todos sienten que los observa.', actor: people[2], digital: 'Voz procesada (demo)', rel: [] },
  ];
  for (const [i, c] of chars.entries()) {
    const ch = await ins('characters', {
      title_id: conv, slug: `demo-${c.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`, name: c.name, summary: c.summary,
      story: 'Historia de demostración: aquí irá la biografía oficial del personaje.', actor_id: c.actor.id, digital_identity: c.digital ?? null,
      relationships: sql.json(c.rel), first_episode_id: ep1.id, is_published: true, position: i,
    });
    const url = await art('character', ch.id, 'poster', `Silueta de ${c.name}`, [['#2a1d12', '#a7743a', '#ffe7b8', '#1d140c'], ['#101a24', '#4f7896', '#e6f0f4', '#0b1218'], ['#1d1024', '#7a3f6e', '#f4d6ec', '#120a16']][i] as [string, string, string, string], [480, 640], { portrait: true, ridges: 1, sun: { x: 0.5, y: 0.34, r: 0.19 } });
    await sql`update characters set image_url = ${url} where id = ${ch.id}`;
    await sql`insert into character_appearances (character_id, episode_id) values (${ch.id}, ${ep1.id})`;
    await ins('title_credits', { title_id: conv, person_id: c.actor.id, role: 'cast', character_id: ch.id, position: i + 1 });
  }
  await ins('title_credits', { title_id: conv, person_id: people[3].id, role: 'director', position: 0 });
  // Comparación antes/después (ambas imágenes generadas)
  const before = await storeImage('demo/comparisons', makeArt({ width: 960, height: 540, palette: ['#3a3a3a', '#7a7a7a', '#dddddd', '#4a4a4a'], seed: 99, ridges: 2 }));
  const after = await storeImage('demo/comparisons', makeArt({ width: 960, height: 540, palette: convPalette, seed: 99, ridges: 2 }));
  state.files.push(before.path, after.path);
  await ins('media_comparisons', { title_id: conv, label: 'La montaña: plató gris y plano final', description: 'Comparación de demostración generada automáticamente.', category: 'set', before_url: before.url, after_url: after.url, rights_note: 'Imágenes generadas para la demo', approved_for_public: true, approved_at: new Date() });
  await ins('featured_content', { title_id: conv, headline: 'Gran estreno', position: 0, is_active: true });
  log('  ✓ Los Convidados al Ágape (serie inaugural: E1 publicado, E2 programado, E3 anunciado)');

  // ------------------------------------------------------------------ 2-3. Series
  for (const s of [
    { slug: 'la-isla-de-los-relojes-parados', title: 'La Isla de los Relojes Parados', tagline: 'En Saona el tiempo se detuvo a las 4:17.', palette: ['#06141c', '#1f6f78', '#d9fff5', '#04232a'] as [string, string, string, string],
      short: 'Una relojera llega a una isla donde todos los relojes marcan la misma hora y nadie envejece desde hace veinte años.', genres: ['misterio', 'suspenso'], cats: ['universo-cine-libroseller'],
      eps: [{ name: 'Las 4:17', synopsis: 'La llegada de Clara a la isla.', minutes: 22, video: VIDEO.steel, status: 'published' as const }, { name: 'La campana sin badajo', synopsis: 'Alguien toca una campana que no puede sonar.', minutes: 24, video: VIDEO.bunny, status: 'published' as const }] },
    { slug: 'cronicas-del-barrio-alto', title: 'Crónicas del Barrio Alto', tagline: 'Una calle, tres familias, un verano.', palette: ['#1f0d08', '#c0532b', '#ffd18a', '#2a120b'] as [string, string, string, string],
      short: 'Tres familias de un barrio de Santiago de los Caballeros comparten azotea, secretos y un negocio que nadie sabe cómo empezó.', genres: ['drama', 'comedia'], cats: ['universo-cine-libroseller'],
      eps: [{ name: 'La azotea', synopsis: 'El calor obliga a todos a subir.', minutes: 28, video: VIDEO.bunny, status: 'published' as const }, { name: 'El colmado', synopsis: 'Una deuda antigua vuelve con intereses.', minutes: 27, video: VIDEO.steel, status: 'published' as const }, { name: 'Apagón', synopsis: 'Doce horas sin luz y una verdad.', minutes: 29, video: VIDEO.bipbop, status: 'published' as const }] },
  ]) {
    const t = await ins('titles', {
      slug: s.slug, type: 'series', title: s.title, tagline: s.tagline, synopsis_short: s.short, synopsis_long: `${s.short}\n\n(Texto de demostración.)`, age_rating: '+13',
      country: 'República Dominicana', status: 'published', published_at: days(-20), release_date: days(-20).toISOString().slice(0, 10), external_ref: `demo:${s.slug}`,
    });
    await taxonomies(t.id, s.genres, s.cats);
    await art('title', t.id, 'poster', `Cartel de ${s.title}`, s.palette, [500, 750]);
    await art('title', t.id, 'backdrop', `Imagen de ${s.title}`, s.palette, [1280, 720], { ridges: 4 });
    await rights(t.id);
    const se = await ins('seasons', { title_id: t.id, number: 1, name: 'Temporada 1', status: 'published' });
    await seriesContent(t.id, se.id, 1, s.eps, s.palette);
    if (s.slug === 'cronicas-del-barrio-alto') {
      await ins('release_schedules', { title_id: t.id, headline: 'Temporada 2 en preparación', date_label: 'Verano 2027', is_confirmed: false, status: 'announced', is_public: true });
    }
    log(`  ✓ ${s.title} (serie, ${s.eps.length} episodios)`);
  }

  // ------------------------------------------------------------------ 4-10. Películas, corto, documental y próximo estreno
  const films: FilmSpec[] = [
    { slug: 'el-peso-de-la-luz', type: 'movie', title: 'El Peso de la Luz', tagline: '¿Cuánto pesa una certeza?', year: 2026, minutes: 98, rating: '+13', genres: ['drama'], categories: ['cine-filosofico', 'universo-cine-libroseller'],
      short: 'Un astrónomo que perdió la fe en todo encuentra en un pueblo de la cordillera una luz que no aparece en ningún mapa del cielo.', long: 'Drama filosófico sobre la duda, la fe y la necesidad de mirar hacia arriba.\n\n(Texto de demostración.)',
      palette: ['#05070f', '#2b3a6b', '#fff3c4', '#0a0d18'], video: VIDEO.steel, trailer: VIDEO.bipbop, director: 'Natalia Brito', cast: ['Esteban Rosario', 'Carmen Liriano'] },
    { slug: 'santo-domingo-1965', type: 'movie', title: 'Santo Domingo, 1965', tagline: 'Una ciudad partida en dos. Un amor en medio.', year: 2026, minutes: 112, rating: '+16', genres: ['historico', 'drama'], categories: ['cine-historico'],
      short: 'En abril de 1965, una enfermera y un estudiante quedan atrapados en lados opuestos de una ciudad en guerra.', long: 'Relato histórico de ficción ambientado en la Guerra de Abril.\n\n(Texto de demostración.)',
      palette: ['#170c08', '#7d3b1f', '#ffcf9a', '#1d0f0a'], video: VIDEO.bunny, director: 'Héctor Almonte', cast: ['Daniela Pérez', 'Joel Mateo'] },
    { slug: 'sal-y-viento', type: 'short', title: 'Sal y Viento', tagline: 'Lo que el mar devuelve.', year: 2025, minutes: 18, rating: 'TP', genres: ['drama'], categories: ['universo-cine-libroseller'],
      short: 'Un pescador de Montecristi y su nieta esperan una barca que salió hace tres días.', long: 'Cortometraje sobre la espera.\n\n(Texto de demostración.)',
      palette: ['#071621', '#3f8aa6', '#f5fbff', '#06202c'], video: VIDEO.bipbop, director: 'Patricia Núñez', cast: ['Ramón Tavárez'] },
    { slug: 'voces-del-cibao', type: 'documentary', title: 'Voces del Cibao', tagline: 'Historias que se cuentan en el patio.', year: 2025, minutes: 74, rating: 'TP', genres: ['documental'], categories: ['universo-cine-libroseller'],
      short: 'Narradores orales del Cibao comparten los cuentos que aprendieron de sus abuelos antes de que se pierdan.', long: 'Documental sobre la tradición oral dominicana.\n\n(Texto de demostración.)',
      palette: ['#0d1408', '#4f7a2b', '#f2f7c9', '#0d1a07'], video: VIDEO.bunny, director: 'Manuel Ureña', cast: [] },
    { slug: 'la-ultima-pagina', type: 'movie', title: 'La Última Página', tagline: 'Algunos libros no deberían terminarse.', year: 2026, minutes: 104, rating: '+16', genres: ['suspenso', 'misterio'], categories: ['adaptaciones-literarias'],
      short: 'Una correctora recibe el manuscrito de un autor desaparecido. Cada capítulo describe algo que todavía no ha ocurrido.', long: 'Thriller literario. Requiere una cuenta gratuita para verse (ejemplo de acceso «con cuenta»).\n\n(Texto de demostración.)',
      palette: ['#0b0b0e', '#3a2f45', '#e8dcff', '#0d0b12'], video: VIDEO.steel, trailer: VIDEO.bipbop, access: 'registered', director: 'Sofía Guzmán', cast: ['Valeria Cruz', 'Andrés Peña'],
      book: { title: 'La Última Página', author: 'Autora de la novela (demo)', relation: 'Adaptación de la novela.', purchase_url: 'https://libroseller.com' } },
    { slug: 'memoria-sintetica', type: 'movie', title: 'Memoria Sintética', tagline: 'Recordar también es inventar.', year: 2026, minutes: 91, rating: '+13', genres: ['ciencia-ficcion', 'drama'], categories: ['produccion-hibrida-ia'],
      short: 'Una ingeniera reconstruye con IA la voz de su padre y descubre recuerdos que él nunca le contó.', long: 'Producción híbrida: intérpretes reales y entornos ampliados con IA.\n\n(Texto de demostración.)',
      palette: ['#04121a', '#0f6d7a', '#c8fff7', '#031a20'], video: VIDEO.bunny, director: 'Iván Polanco', cast: ['Laura Batista'],
      ai: { kind: 'modified', note: 'Escenarios ampliados con IA y voz sintética de un personaje ficticio, con autorización (demo).' } },
    { slug: 'el-faro-de-samana', type: 'movie', title: 'El Faro de Samaná', tagline: 'Cada noche, alguien enciende un faro abandonado.', year: 2027, minutes: 101, rating: '+13', genres: ['misterio', 'drama'], categories: ['universo-cine-libroseller'],
      short: 'Una guardacostas investiga quién enciende, cada noche, un faro que lleva cuarenta años apagado.', long: 'Próximo estreno.\n\n(Texto de demostración.)',
      palette: ['#060b16', '#26406b', '#fff1b8', '#070d18'], video: VIDEO.steel, trailer: VIDEO.bipbop, status: 'scheduled', publishIn: 21, director: 'Carla Ventura', cast: ['Yanelis Rodríguez'] },
  ];
  const created: Row[] = [];
  for (const f of films) created.push(await film(f));
  const faro = created.find((t) => t.slug === 'el-faro-de-samana')!;
  await ins('release_schedules', { title_id: faro.id, headline: 'Estreno en cines digitales', release_at: days(21), is_confirmed: true, status: 'confirmed', is_public: true });

  // Colección editorial
  const [coll] = await sql`select id from collections where slug = 'colecciones-especiales'`;
  if (coll) {
    const picks = ['el-peso-de-la-luz', 'la-ultima-pagina', 'memoria-sintetica', 'santo-domingo-1965'];
    for (const [i, slug] of picks.entries()) {
      await sql`insert into collection_items (collection_id, title_id, position) select ${coll.id}, id, ${i} from titles where slug = ${slug} on conflict do nothing`;
    }
  }

  await sql`insert into system_settings (key, value) values ('demo', ${sql.json(state as never)})`;
  log(`\nDemostración lista: 10 obras (3 series, 5 películas, 1 corto, 1 documental) y 4 próximos estrenos.`);
  log('Arranca «npm run dev» y abre http://localhost:3000. Para borrarla: «npm run demo:clear».');
  return state;
}

export async function demoClear({ log = console.log } = {}) {
  const [row] = await sql`select value from system_settings where key = 'demo'`;
  if (!row) { log('No hay ninguna demostración cargada.'); return; }
  const state = row.value as DemoState;
  await sql.begin(async (tx) => {
    // Borra lo creado en orden inverso (los hijos antes que los padres)
    for (const c of [...state.created].reverse()) {
      if (!isUuid(c.id)) continue;
      await tx`delete from ${tx(c.table)} where id = ${c.id}`;
    }
    // Restaura lo modificado (serie inaugural, su temporada, el episodio 1 y su anuncio)
    for (const u of state.updated) {
      const { id, created_at: _c, updated_at: _u, ...rest } = u.row as Row; // eslint-disable-line @typescript-eslint/no-unused-vars
      for (const k of Object.keys(rest)) if (JSONB.has(k) && rest[k] !== null) rest[k] = tx.json(rest[k] as never);
      await tx`update ${tx(u.table)} set ${tx(rest as never)} where id = ${id as string}`;
    }
    await tx`delete from collection_items where title_id not in (select id from titles)`;
    await tx`delete from system_settings where key = 'demo'`;
  });
  for (const f of state.files) await deleteObject(f).catch(() => {});
  log(`Demostración eliminada: ${state.created.length} registros borrados y ${state.updated.length} restaurados. La serie inaugural vuelve a estar en borrador.`);
}

if (require.main === module) {
  const cmd = process.argv[2];
  const run = cmd === 'clear' ? demoClear : cmd === 'seed' ? demoSeed : null;
  if (!run) { console.error('Uso: tsx scripts/demo.ts seed|clear'); process.exitCode = 1; }
  else run().catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exitCode = 1; }).finally(() => sql.end({ timeout: 5 }));
}
