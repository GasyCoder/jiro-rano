import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: fromRoot('./src/client'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': fromRoot('./src/shared'),
      '@': fromRoot('./src/client'),
    },
  },
  build: {
    outDir: fromRoot('./dist/client'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000' },
    },
  },
});
