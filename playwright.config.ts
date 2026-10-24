import { defineConfig } from '@playwright/test';

// Drives the real app (production build served by the local server) in the system Chrome.
// Uses a throwaway data directory so it never touches your books.
const PORT = 5185;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: `rm -rf test-results/e2e-data && vite build && NODE_ENV=production PHOTOBOOK_PORT=${PORT} PHOTOBOOK_DATA_DIR=test-results/e2e-data tsx src/server/main.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
