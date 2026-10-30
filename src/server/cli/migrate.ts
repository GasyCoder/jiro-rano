import { runMigrations } from '../db/migrate';
import { migrationsDir } from '../paths';
import { openCliDatabase } from './common';

/** Applique les migrations (npm run db:migrate). Utilise MIGRATION_DATABASE_URL si elle est définie. */
const handle = await openCliDatabase({ forMigrations: true });
try {
  await runMigrations(handle, migrationsDir());
  console.log('✔ Migrations appliquées');
} catch (error) {
  console.error('✘ Échec des migrations :', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
