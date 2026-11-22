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

function instance(): Sql {
  return globalForDb.__cineSql ?? (globalForDb.__cineSql = create());
}

/**
 * Cliente SQL compartido (una instancia por proceso). Se crea al primer uso, no al importar el módulo:
 * así una DATABASE_URL ausente o errónea nunca rompe la compilación, sólo las peticiones que la necesitan.
 */
export const sql: Sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _this, args) => (instance() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const target = instance() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
});

export type Tx = Sql | postgres.TransactionSql;
export type { Sql };
