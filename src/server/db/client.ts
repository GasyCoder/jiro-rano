import { readFileSync } from 'node:fs';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbOrTx = Db | Tx;

export type DbHandle =
  | { driver: 'postgres'; db: Db; raw: PostgresJsDatabase<Schema>; close: () => Promise<void> }
  | { driver: 'pglite'; db: Db; raw: PgliteDatabase<Schema>; close: () => Promise<void> };

export type DbOptions = {
  ssl?: 'auto' | 'require' | 'verify-full' | 'disable';
  sslCaFile?: string;
  max?: number;
};

/**
 * Connexion PostgreSQL.
 * - `postgres://…` : Supabase via le pooler Supavisor (IPv4). `prepare: false` rend la connexion
 *   compatible avec le mode transaction (port 6543) comme avec le mode session (port 5432).
 * - `pglite:memory` ou `pglite:./chemin` : PostgreSQL embarqué (WASM) pour le développement et les tests.
 */
export async function createDatabase(url: string, options: DbOptions = {}): Promise<DbHandle> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
    const location = url.slice('pglite:'.length).replace(/^\/\//, '');
    const client = location === '' || location === 'memory' ? new PGlite() : new PGlite(location);
    const raw = drizzlePglite({ client, schema });
    return { driver: 'pglite', raw, db: raw as unknown as Db, close: () => client.close() };
  }

  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 5,
    ssl: resolveSsl(url, options),
    idle_timeout: 20,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
    onnotice: () => undefined,
  });
  const raw = drizzle({ client, schema });
  return { driver: 'postgres', raw, db: raw as unknown as Db, close: () => client.end({ timeout: 5 }) };
}

function resolveSsl(url: string, options: DbOptions): postgres.Options<Record<string, never>>['ssl'] {
  const mode = options.ssl ?? 'auto';
  if (mode === 'disable') return false;
  if (mode === 'verify-full') {
    return { rejectUnauthorized: true, ...(options.sslCaFile ? { ca: readFileSync(options.sslCaFile, 'utf8') } : {}) };
  }
  if (mode === 'require') return 'require';
  const host = new URL(url).hostname;
  return ['localhost', '127.0.0.1', '::1'].includes(host) ? false : 'require';
}
