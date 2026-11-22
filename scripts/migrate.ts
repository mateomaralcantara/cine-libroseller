// Aplica en orden las migraciones de supabase/migrations que aún no se hayan ejecutado.
import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { databaseUrl } from './database-url';

export async function migrate(databaseUrl: string, { log = true } = {}) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
    const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await sql`select version from schema_migrations`).map((r) => r.version as string));
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (done.has(version)) continue;
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (version) values (${version})`;
      });
      if (log) console.log(`✓ ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = databaseUrl();
  migrate(url).then(() => console.log('Migraciones al día.')).catch((e) => { console.error(e); process.exit(1); });
}
