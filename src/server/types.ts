import type { Db } from './db/client';
import type { Env } from './env';
import type { Extractors } from './extraction';
import type { StorageProvider } from './storage/storage';

export type AppDeps = {
  env: Env;
  db: Db;
  storage: StorageProvider;
  extractors: Extractors;
  /** Dossier du frontend compilé (dist/client), ou null pour ne servir que l'API. */
  clientDir: string | null;
  version: string;
};
