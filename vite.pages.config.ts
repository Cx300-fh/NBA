import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const base = process.env.PAGES_BASE_PATH || '/NBA/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw Error('PAGES_BASE_PATH must be an absolute directory path, for example /NBA/');
export default defineConfig({
  root: root + 'pages',
  base,
  publicDir: root + 'public',
  plugins: [react()],
  resolve: { alias: { '@': root } },
  define: { __COURTSIDE_PAGES_BASE__: JSON.stringify(base) },
  build: { outDir: root + 'dist-pages', emptyOutDir: true, target: 'es2022' },
});
