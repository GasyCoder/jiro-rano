import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fromRoot('./src/shared'),
      '@': fromRoot('./src/client'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
