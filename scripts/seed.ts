// Datos base del catálogo. Idempotente: se puede ejecutar varias veces.
// NO crea videos, imágenes, usuarios ficticios ni estadísticas: esos materiales los carga el administrador.
import './load-env';
import postgres from 'postgres';
import { databaseUrl } from './database-url';

const GENRES = [
  ['drama', 'Drama'], ['misterio', 'Misterio'], ['suspenso', 'Suspenso'], ['historico', 'Histórico'],
  ['documental', 'Documental'], ['ciencia-ficcion', 'Ciencia ficción'], ['fantasia', 'Fantasía'],
  ['romance', 'Romance'], ['comedia', 'Comedia'], ['terror', 'Terror'], ['biografico', 'Biográfico'],
];

const CATEGORIES = [
  ['cine-filosofico', 'Cine filosófico', 'Historias que preguntan por el sentido, la fe, el sufrimiento y la libertad.'],
  ['produccion-hibrida-ia', 'Producciones híbridas con IA', 'Obras con intérpretes reales y escenarios o personajes ampliados con IA, siempre con autorización.'],
  ['cine-historico', 'Cine histórico', 'Relatos ambientados en otras épocas.'],
  ['adaptaciones-literarias', 'Adaptaciones literarias', 'Películas y series basadas en libros.'],
  ['universo-cine-libroseller', 'Universo Cine LibroSeller', 'Producciones originales de Cine LibroSeller Studios.'],
];

export async function seed(databaseUrl: string, { log = true } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      for (const [i, [slug, name]] of GENRES.entries()) {
        await tx`insert into genres (slug, name, position) values (${slug}, ${name}, ${i}) on conflict (slug) do nothing`;
      }
      for (const [i, [slug, name, description]] of CATEGORIES.entries()) {
        await tx`insert into categories (slug, name, description, position) values (${slug}, ${name}, ${description}, ${i}) on conflict (slug) do nothing`;
      }
      await tx`insert into collections (slug, name, description) values ('colecciones-especiales', 'Colecciones especiales', 'Selección editorial') on conflict (slug) do nothing`;

      // Serie inaugural: sólo los datos confirmados en el encargo. Sinopsis, póster, tráiler y video los carga el equipo.
      let [series] = await tx`select id from titles where slug = 'los-convidados-al-agape'`;
      if (!series) {
        [series] = await tx`insert into titles (slug, type, title, original_language, languages, country, status, access, ai_disclosure)
          values ('los-convidados-al-agape', 'series', 'Los Convidados al Ágape', 'es', '{es}', 'República Dominicana', 'draft', 'free', 'none')
          returning id`;
        for (const g of ['drama', 'misterio', 'suspenso']) {
          await tx`insert into title_genres (title_id, genre_id) select ${series.id}, id from genres where slug = ${g} on conflict do nothing`;
        }
        for (const c of ['cine-filosofico', 'universo-cine-libroseller', 'adaptaciones-literarias']) {
          await tx`insert into title_categories (title_id, category_id) select ${series.id}, id from categories where slug = ${c} on conflict do nothing`;
        }
        const [season] = await tx`insert into seasons (title_id, number, name, status) values (${series.id}, 1, 'Temporada 1', 'draft') returning id`;
        const [ep] = await tx`insert into episodes (season_id, title_id, number, name, runtime_minutes, status, access)
          values (${season.id}, ${series.id}, 1, 'La petición en la montaña', 15, 'draft', 'free') returning id`;
        await tx`insert into release_schedules (title_id, episode_id, headline, date_label, is_confirmed, status, is_public)
          values (${series.id}, ${ep.id}, 'Estreno del episodio 1', 'Próximamente', false, 'announced', false)`;
        if (log) console.log('✓ Serie inaugural «Los Convidados al Ágape» (borrador, pendiente de materiales)');
      }

      const [{ n }] = await tx`select count(*)::int as n from homepage_sections`;
      if (n === 0) {
        const S: [string, string, string | null, Record<string, unknown>][] = [
          ['spotlight', 'Gran estreno', null, { title_id: series.id }],
          ['continue_watching', 'Continúa viendo', null, {}],
          ['by_type', 'Películas originales', null, { type: 'movie' }],
          ['by_type', 'Series originales', null, { type: 'series' }],
          ['new_episodes', 'Nuevos episodios', null, { days: 60 }],
          ['upcoming', 'Próximamente', 'Fechas confirmadas y anuncios', {}],
          ['by_type', 'Cortometrajes', null, { type: 'short' }],
          ['by_type', 'Documentales', null, { type: 'documentary' }],
          ['by_category', 'Cine filosófico', 'Preguntas que se quedan contigo', { category: 'cine-filosofico' }],
          ['by_genre', 'Drama', null, { genre: 'drama' }],
          ['by_genre', 'Suspenso', null, { genre: 'suspenso' }],
          ['by_category', 'Cine histórico', null, { category: 'cine-historico' }],
          ['by_category', 'Producciones híbridas con IA', 'Intérpretes reales, mundos ampliados', { category: 'produccion-hibrida-ia' }],
          ['behind_scenes', 'Detrás de cámaras', 'Cómo se hizo', {}],
          ['most_viewed', 'Más vistos', 'Últimos 30 días', {}],
          ['recommended', 'Recomendados para ti', null, {}],
          ['collection', 'Colecciones especiales', null, { collection: 'colecciones-especiales' }],
          ['recent', 'Estrenos recientes', null, {}],
          ['by_category', 'Universo Cine LibroSeller', null, { category: 'universo-cine-libroseller' }],
        ];
        for (const [i, [kind, heading, sub, config]] of S.entries()) {
          await tx`insert into homepage_sections (kind, heading, subheading, config, position) values (${kind}, ${heading}, ${sub}, ${tx.json(config as never)}, ${i})`;
        }
        if (log) console.log(`✓ ${S.length} secciones de portada (las vacías no se muestran)`);
      }

      await tx`insert into system_settings (key, value) values ('site', ${tx.json({ name: 'CINE LIBROSELLER', tagline: 'El futuro del cine comienza aquí.' })}) on conflict do nothing`;
    });
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = databaseUrl();
  seed(url).then(() => console.log('Catálogo base listo.')).catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exitCode = 1; });
}
