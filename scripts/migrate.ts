// Aplica en orden las migraciones de supabase/migrations que aún no se hayan ejecutado.
// Antes comprueba que la base no pertenezca a otra aplicación: si hay conflicto, no toca nada.
import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { databaseUrl } from './database-url';
import { inspectDb, conflictMessage } from './db-inspect';

export class MigrationConflict extends Error {}

export async function migrate(databaseUrl: string, { log = true } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const state = await inspectDb(sql);
    if (state.conflicts.length) throw new MigrationConflict(conflictMessage(state));
    // Base con tablas de otra app y sin nuestras migraciones: no se escribe nada salvo autorización expresa
    if (state.applied.length === 0 && state.foreign.length && process.env.ALLOW_SHARED_DATABASE !== '1') {
      throw new MigrationConflict(conflictMessage(state) + '\n  (Si de verdad quieres compartir esta base, define ALLOW_SHARED_DATABASE=1; no se recomienda.)');
    }
    // Esquema ya creado a mano (p. ej. pegando el SQL en el editor de Supabase): se registra sin volver a ejecutarlo
    for (const version of state.adoptable) {
      await sql.begin(async (tx) => {
        await tx`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
        await tx`alter table schema_migrations enable row level security`;
        await tx`insert into schema_migrations (version) values (${version}) on conflict do nothing`;
      });
      state.applied.push(version);
      if (log) console.log(`✓ ${version}.sql ya estaba aplicada en la base (se registra, no se vuelve a ejecutar)`);
    }
    const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const version = file.replace(/\.sql$/, '');
      if (state.applied.includes(version)) continue;
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      // Cada migración y su registro van en la misma transacción: o se aplica entera o no se aplica
      await sql.begin(async (tx) => {
        await tx`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
        await tx`alter table schema_migrations enable row level security`; // no expuesta por la API de Supabase
        await tx.unsafe(body);
        await tx`insert into schema_migrations (version) values (${version})`;
      });
      if (log) console.log(`✓ ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const url = databaseUrl();
  migrate(url)
    .then(() => { console.log('Migraciones al día.'); })
    .catch((e) => {
      if (e instanceof MigrationConflict) console.error(`✗ ${e.message}`);
      else console.error(`✗ La migración falló y se revirtió (no quedó nada a medias): ${(e as Error).message}`);
      process.exitCode = 1;
    });
}
