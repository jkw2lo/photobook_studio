import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createApp } from './app';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = resolve(process.env.PHOTOBOOK_DATA_DIR ?? join(ROOT, 'data'));
const port = Number(process.env.PHOTOBOOK_PORT ?? 5174);
const production = process.env.NODE_ENV === 'production';

const webPort = Number(process.env.PHOTOBOOK_WEB_PORT ?? 5173);
const { app, store } = createApp(dataDir, production ? { staticDir: join(ROOT, 'dist/web') } : { devWebUrl: `http://127.0.0.1:${webPort}/` });

// 127.0.0.1 only: the API is never exposed to the local network.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Photobook Studio API on http://127.0.0.1:${port}  (data: ${dataDir})`);
  console.log(production ? `\n  Open the editor: http://127.0.0.1:${port}\n` : `\n  Open the editor: http://127.0.0.1:${webPort}  (this port only serves data)\n`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
