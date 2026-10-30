import type { DbHandle } from './client';

/** Applique les migrations SQL versionnées du dossier `drizzle/` (idempotent). */
export async function runMigrations(handle: DbHandle, migrationsFolder: string): Promise<void> {
  if (handle.driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.raw, { migrationsFolder });
    return;
  }
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  await migrate(handle.raw, { migrationsFolder });
}
