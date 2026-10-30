// Compile le serveur et les commandes CLI en modules ES dans dist/server.
// Les dépendances npm restent externes (installées par `npm install` sur l'hébergeur).
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist/server', { recursive: true, force: true });

await build({
  entryPoints: {
    index: 'src/server/index.ts',
    migrate: 'src/server/cli/migrate.ts',
    seed: 'src/server/cli/seed.ts',
    'create-superadmin': 'src/server/cli/create-superadmin.ts',
  },
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  tsconfig: 'tsconfig.server.json',
  sourcemap: true,
  logLevel: 'info',
});
