// AC-01: import 500 photos without losing files or freezing the app.
// Needs `npm run fixtures -- 500` first; skipped otherwise.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createBook, generateDraft, printablePages, type PhotoAsset } from '../src/core';
import { createApp } from '../src/server/app';

const DIR = join(process.cwd(), 'fixtures', 'generated', 'large-500');

describe.skipIf(!existsSync(DIR))('scale', () => {
  it('imports 500 photos while the API stays responsive, then drafts a 60-page book', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'photobook-scale-'));
    const { app, store } = createApp(dataDir);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const json = async (path: string, init?: RequestInit) => (await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...init })).json();
    try {
      const { doc } = await json('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'Big' }) });
      const started = Date.now();
      let job = await json(`/api/projects/${doc.id}/import`, { method: 'POST', body: JSON.stringify({ folder: DIR }) });
      const latencies: number[] = [];
      while (job.status !== 'done' && job.status !== 'failed') {
        const t = Date.now();
        job = await json(`/api/jobs/${job.id}`);
        await json('/api/health');
        latencies.push(Date.now() - t);
        await new Promise((r) => setTimeout(r, 100));
      }
      const seconds = (Date.now() - started) / 1000;
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
      console.log(`500 photos imported in ${seconds.toFixed(1)}s; API p95 latency during import ${p95} ms (max ${latencies[latencies.length - 1]} ms)`);
      expect(job.status).toBe('done');
      expect(job.imported).toBe(500);
      expect(job.failed).toBe(0);
      expect(p95).toBeLessThan(500);

      const assets: PhotoAsset[] = await json(`/api/projects/${doc.id}/assets`);
      expect(assets).toHaveLength(500);
      const t = Date.now();
      const { doc: draft } = generateDraft(createBook({ title: 'Big' }), assets, { targetPages: 60, stylePresetId: 'documentary', ordering: 'chronological', includeCaptions: true, seed: 1 });
      console.log(`Draft of 60 pages from 500 photos generated in ${Date.now() - t} ms`);
      expect(printablePages(draft)).toHaveLength(60);
    } finally {
      server.close();
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 600_000);
});
