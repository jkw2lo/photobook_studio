import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web UI talks only to the local API server (127.0.0.1). Nothing is fetched from the internet.
// Ports can be moved with PHOTOBOOK_WEB_PORT / PHOTOBOOK_PORT (e.g. to run a second copy).
const apiPort = Number(process.env.PHOTOBOOK_PORT ?? 5174);
const webPort = Number(process.env.PHOTOBOOK_WEB_PORT ?? 5173);

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: { '/api/': `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
