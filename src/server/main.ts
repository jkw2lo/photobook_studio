import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createApp } from './app';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = resolve(process.env.PHOTOBOOK_DATA_DIR ?? join(ROOT, 'data'));
const port = Number(process.env.PHOTOBOOK_PORT ?? 5174);
const production = process.env.NODE_ENV === 'production';

const webPort = Number(process.env.PHOTOBOOK_WEB_PORT ?? 5173);
// Restart = run the launcher's start script in the background: it rebuilds the editor if the code
// changed, stops this server and starts a fresh one on the same port and data folder.
const restart = () => {
  spawn('bash', [join(ROOT, 'scripts/launcher/start.sh')], {
    cwd: ROOT, detached: true, stdio: 'ignore',
    env: { ...process.env, PHOTOBOOK_PORT: String(port), PHOTOBOOK_DATA_DIR: dataDir },
  }).unref();
};
// Quit (the editor's Quit button): started from the Dock app, ask that app to quit — its quit
// handler stops this server, so it doesn't then warn that the server stopped. Otherwise (npm start)
// just shut down. Either way, give up waiting after a few seconds and shut down.
const launcherApp = process.env.PHOTOBOOK_LAUNCHER_APP;
const quit = () => {
  if (launcherApp) {
    const target = launcherApp.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    spawn('osascript', ['-e', `tell application "${target}" to quit`], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(shutdown, 5000).unref();
  } else shutdown();
};
const { app, store } = createApp(dataDir, production ? { staticDir: join(ROOT, 'dist/web'), restart, quit } : { devWebUrl: `http://127.0.0.1:${webPort}/` });

// 127.0.0.1 only: the API is never exposed to the local network.
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Photobook Studio API on http://127.0.0.1:${port}  (data: ${dataDir})`);
  console.log(production ? `\n  Open the editor: http://127.0.0.1:${port}\n` : `\n  Open the editor: http://127.0.0.1:${webPort}  (this port only serves data)\n`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Open keep-alive connections would hold close() up: don't wait for them.
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
