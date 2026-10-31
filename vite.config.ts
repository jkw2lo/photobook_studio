import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web UI talks only to the local API server (127.0.0.1). Nothing is fetched from the internet.
// Ports can be moved with PHOTOBOOK_WEB_PORT / PHOTOBOOK_PORT (e.g. to run a second copy).
//
// `--mode pages` builds the web version instead: the backend runs in the browser (IndexedDB,
// workers), there is no server, and the files are served from GitHub Pages under /photobook_studio/.
const apiPort = Number(process.env.PHOTOBOOK_PORT ?? 5174);
const webPort = Number(process.env.PHOTOBOOK_WEB_PORT ?? 5173);

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  return {
    root: 'src/web',
    base: pages ? '/photobook_studio/' : '/',
    plugins: [react()],
    define: { __BROWSER_BACKEND__: JSON.stringify(pages) },
    worker: { format: 'es' },
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: pages ? undefined : { '/api/': `http://127.0.0.1:${apiPort}` },
      fs: { allow: ['../..'] },
    },
    build: { outDir: pages ? '../../dist/pages' : '../../dist/web', emptyOutDir: true, target: 'es2022' },
  };
});
