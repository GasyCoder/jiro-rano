// Prépare une archive prête à envoyer sur o2switch : deploy/jirama-share.tar.gz
// (code compilé + migrations + manifestes npm ; ni sources, ni .env, ni node_modules).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const required = ['dist/server/index.js', 'dist/client/index.html', 'drizzle'];
for (const path of required) {
  if (!existsSync(path)) {
    console.error(`✘ ${path} manquant : lancez d'abord « npm run build ».`);
    process.exit(1);
  }
}

const target = 'deploy/jirama-share';
rmSync('deploy', { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const path of ['dist', 'drizzle', 'package.json', 'package-lock.json', 'app.cjs', '.env.example', 'README.md', 'docs']) {
  cpSync(path, `${target}/${path}`, { recursive: true });
}
execFileSync('tar', ['-czf', 'deploy/jirama-share.tar.gz', '-C', 'deploy', 'jirama-share']);
console.log('✔ Archive prête : deploy/jirama-share.tar.gz');
