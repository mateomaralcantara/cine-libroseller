// Inspección de la base de datos antes de migrar: evita escribir en una base que pertenece a otra aplicación.
import fs from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';

const MIGRATIONS = path.resolve(__dirname, '..', 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

/** Tablas que crean nuestras migraciones (leídas del propio SQL). */
export function ourTables(): Set<string> {
  const names = new Set<string>(['schema_migrations']);
  for (const f of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/create table(?: if not exists)?\s+([a-z_][a-z0-9_]*)/gi)) names.add(m[1].toLowerCase());
  }
  return names;
}

export interface DbState {
  applied: string[];
  pending: string[];
  /** Tablas con el mismo nombre que las nuestras creadas por otra aplicación (impiden migrar). */
  conflicts: { name: string; rows: number }[];
  /** Otras tablas del esquema public que no son de esta plataforma. */
  foreign: { name: string; rows: number }[];
}

export async function inspectDb(sql: postgres.Sql): Promise<DbState> {
  const files = migrationFiles().map((f) => f.replace(/\.sql$/, ''));
  const [{ has }] = await sql`select to_regclass('public.schema_migrations') is not null as has`;
  const applied = has ? (await sql`select version from schema_migrations`).map((r) => r.version as string) : [];
  const pending = files.filter((f) => !applied.includes(f));
  // reltuples es una estimación de filas: no se lee ningún dato de las tablas
  const tables = await sql`select c.relname as name, greatest(c.reltuples, 0)::bigint as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`;
  const ours = ourTables();
  const firstApplied = applied.includes(files[0]);
  const conflicts = firstApplied ? [] : tables.filter((t) => ours.has(t.name) && t.name !== 'schema_migrations').map((t) => ({ name: t.name as string, rows: Number(t.rows) }));
  const foreign = tables.filter((t) => !ours.has(t.name)).map((t) => ({ name: t.name as string, rows: Number(t.rows) }));
  return { applied, pending, conflicts, foreign };
}

export function conflictMessage(state: DbState): string {
  const list = (items: { name: string; rows: number }[]) => items.slice(0, 15).map((t) => `${t.name}${t.rows > 0 ? ` (~${t.rows} filas)` : ''}`).join(', ') + (items.length > 15 ? `… y ${items.length - 15} más` : '');
  return [
    'Esta base de datos ya contiene tablas de otra aplicación, así que NO se ha modificado nada.',
    state.conflicts.length ? `  Tablas con nombres que chocan con CINE LIBROSELLER: ${list(state.conflicts)}` : '',
    state.foreign.length ? `  Otras tablas existentes: ${list(state.foreign)}` : '',
    '  CINE LIBROSELLER debe tener su PROPIO proyecto de Supabase (no la base de LibroSeller ni de otra app).',
    '  Crea un proyecto nuevo en supabase.com, copia su cadena de conexión en .env.local y vuelve a ejecutar «npm run db:migrate».',
  ].filter(Boolean).join('\n');
}
