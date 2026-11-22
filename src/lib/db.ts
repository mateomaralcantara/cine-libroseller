import postgres from 'postgres';
import { env } from './env';

type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __cineSql?: Sql };

function create(): Sql {
  return postgres(env.databaseUrl, {
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // compatible con el pooler de Supabase (modo transacción)
    onnotice: () => {},
    transform: { undefined: null },
  });
}

/** Cliente SQL compartido (una instancia por proceso). */
export const sql: Sql = globalForDb.__cineSql ?? (globalForDb.__cineSql = create());

export type Tx = Sql | postgres.TransactionSql;
export type { Sql };
