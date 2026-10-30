import { z } from 'zod';
import { createDatabase, type DbHandle } from '../db/client';
import { runMigrations } from '../db/migrate';
import { loadDotEnv } from '../env';
import { appRoot, migrationsDir } from '../paths';

/** Connexion pour les commandes CLI : seules les variables de base de données sont requises. */
export async function openCliDatabase(options: { forMigrations?: boolean } = {}): Promise<DbHandle> {
  const root = appRoot();
  loadDotEnv(root);
  const env = z
    .object({
      DATABASE_URL: z.string().min(1, 'DATABASE_URL manquante'),
      MIGRATION_DATABASE_URL: z.string().optional(),
      DATABASE_SSL: z.enum(['auto', 'require', 'verify-full', 'disable']).default('auto'),
    })
    .parse(process.env);
  const url = options.forMigrations ? env.MIGRATION_DATABASE_URL || env.DATABASE_URL : env.DATABASE_URL;
  const handle = await createDatabase(url, { ssl: env.DATABASE_SSL, max: 1 });
  if (handle.driver === 'pglite' && !options.forMigrations) await runMigrations(handle, migrationsDir(root));
  return handle;
}

export function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Lecture d'un mot de passe sans écho à l'écran (ou depuis l'entrée standard si elle est redirigée). */
export function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk: string) => (data += chunk));
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] ?? ''));
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Annulé'));
          return;
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}
