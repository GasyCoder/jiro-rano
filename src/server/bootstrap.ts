import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase, type DbHandle } from './db/client';
import { runMigrations } from './db/migrate';
import type { Env } from './env';
import { appRoot, migrationsDir } from './paths';
import { LocalStorage, type StorageProvider, SupabaseStorage } from './storage/storage';

export function createStorage(env: Env, root = appRoot()): StorageProvider {
  if (env.STORAGE_DRIVER === 'supabase' && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_STORAGE_BUCKET);
  }
  return new LocalStorage(resolve(root, env.LOCAL_STORAGE_DIR));
}

/** Ouvre la base. Une base PGlite embarquée (développement) est migrée automatiquement. */
export async function openDatabase(env: Env, root = appRoot()): Promise<DbHandle> {
  const handle = await createDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL, max: env.DATABASE_POOL_MAX });
  if (handle.driver === 'pglite') await runMigrations(handle, migrationsDir(root));
  return handle;
}

export function appVersion(root = appRoot()): string {
  try {
    return (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
