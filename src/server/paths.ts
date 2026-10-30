import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Racine de l'application, que le code tourne depuis les sources (src/server) ou depuis le bundle
 * (dist/server) : on remonte jusqu'au dossier qui contient package.json.
 */
export function appRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const migrationsDir = (root = appRoot()) => resolve(root, 'drizzle');
export const clientDistDir = (root = appRoot()) => resolve(root, 'dist/client');
