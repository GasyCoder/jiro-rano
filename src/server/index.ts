import { buildApp } from './app';
import { appVersion, createStorage, openDatabase } from './bootstrap';
import { loadDotEnv, parseEnv } from './env';
import { createExtractors } from './extraction';
import { appRoot, clientDistDir } from './paths';

declare const PhusionPassenger: { configure(options: { autoInstall: boolean }): void } | undefined;

async function main(): Promise<void> {
  const root = appRoot();
  loadDotEnv(root);
  const env = parseEnv();
  const handle = await openDatabase(env, root);
  const storage = createStorage(env, root);
  const app = await buildApp({
    env,
    db: handle.db,
    storage,
    extractors: createExtractors(env),
    clientDir: clientDistDir(root),
    version: appVersion(root),
  });

  try {
    await storage.init?.();
  } catch (error) {
    app.log.error({ err: error }, 'Stockage indisponible : les envois de photos échoueront');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} reçu : arrêt propre`);
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // Sous Phusion Passenger (o2switch « Setup Node.js App »), Passenger fournit le socket d'écoute.
  if (typeof PhusionPassenger !== 'undefined') {
    await app.ready();
    app.server.listen('passenger');
    app.log.info(`JIRAMA Share ${appVersion(root)} démarré sous Phusion Passenger`);
    return;
  }
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
