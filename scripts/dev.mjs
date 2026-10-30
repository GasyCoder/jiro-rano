// Développement : API (tsx watch, port 3000) + frontend Vite (port 5173, proxy /api).
import { spawn } from 'node:child_process';

const processes = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts'], { stdio: 'inherit', env: { NODE_ENV: 'development', ...process.env } }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const child of processes) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of processes) child.on('exit', (code) => code && stop());
