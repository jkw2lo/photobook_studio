import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createApp } from './app';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = resolve(process.env.PHOTOBOOK_DATA_DIR ?? join(ROOT, 'data'));
const port = Number(process.env.PHOTOBOOK_PORT ?? 5174);
const production = process.env.NODE_ENV === 'production';

const { app, store } = createApp(dataDir, { staticDir: production ? join(ROOT, 'dist/web') : undefined });

// 127.0.0.1 only: the API is never exposed to the local network.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Photobook Studio API on http://127.0.0.1:${port}  (data: ${dataDir})`);
  if (production) console.log(`Open http://127.0.0.1:${port}`);
});

const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
