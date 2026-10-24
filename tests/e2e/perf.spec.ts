// Editor smoothness under load: a 500-photo library and a 60-page book.
// Drags a photo with real mouse input and records the browser's frame intervals while dragging.
// Needs `npm run fixtures -- 500`; skipped otherwise.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { generateDraft, type BookDocument, type PhotoAsset } from '../../src/core';

const LARGE = join(process.cwd(), 'fixtures', 'generated', 'large-500');

test.skip(!existsSync(LARGE), 'needs npm run fixtures -- 500');

test('dragging a photo stays smooth with 500 photos and 60 pages', async ({ page, request }) => {
  const created = await request.post('/api/projects', { data: { title: 'Perf', printerId: 'lulu', bindingId: 'hardcover', sizeId: 'lulu-sq85', pages: 60 } });
  const { doc, revision } = (await created.json()) as { doc: BookDocument; revision: number };
  let job = await (await request.post(`/api/projects/${doc.id}/import`, { data: { folder: LARGE } })).json();
  while (job.status !== 'done' && job.status !== 'failed') {
    await new Promise((r) => setTimeout(r, 200));
    job = await (await request.get(`/api/jobs/${job.id}`)).json();
  }
  const assets = (await (await request.get(`/api/projects/${doc.id}/assets`)).json()) as PhotoAsset[];
  const draft = generateDraft(doc, assets, { targetPages: 60, stylePresetId: 'documentary', ordering: 'chronological', includeCaptions: true, seed: 1 }).doc;
  await request.put(`/api/projects/${doc.id}`, { data: { doc: draft, baseRevision: revision } });

  await page.goto(`/#/book/${doc.id}`);
  await expect(page.locator('.library .tile').first()).toBeVisible();
  await page.waitForTimeout(800);

  // Simulate a slower laptop: a fast Mac hides render cost behind the 60 Hz frame cap.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const img = (await page.locator('.canvas .el-image').first().boundingBox())!;
  const start = { x: img.x + img.width / 2, y: img.y + img.height / 2 };

  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__frames = [];
    w.__rec = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (w.__rec) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 120; i++) await page.mouse.move(start.x + i * 1.5, start.y + i * 0.8);
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__rec = false;
    return w.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const jank = frames.filter((f) => f > 50).length;
  // Work per drag step, independent of the 60 Hz cap: synthetic moves, each followed by a macrotask
  // (React renders continuous-input updates in a scheduler task before ours runs).
  const workPerMove = await page.evaluate(async () => {
    const overlay = document.querySelector('.overlay') as HTMLElement;
    const r = document.querySelector('.canvas .el-image')!.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top + r.height / 2;
    const fire = (type: string) => overlay.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7, button: 0, buttons: 1, isPrimary: true }));
    const tick = () => new Promise<void>((res) => { const c = new MessageChannel(); c.port1.onmessage = () => res(); c.port2.postMessage(0); });
    // The canvas coalesces moves into requestAnimationFrame; run those callbacks immediately so
    // each synthetic move pays its full update + render cost inside the timed window.
    const realRaf = window.requestAnimationFrame;
    let fakeId = 1;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(performance.now()));
      return fakeId++;
    };
    fire('pointerdown');
    await tick();
    const t0 = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) {
      x += 2;
      y += 1;
      fire('pointermove');
      await tick();
    }
    const per = (performance.now() - t0) / N;
    fire('pointerup');
    window.requestAnimationFrame = realRaf;
    return per;
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`work per drag step (4× throttle): ${workPerMove.toFixed(2)} ms`);
  // Baseline before the memoization work was 15.3 ms per step at 4× throttle.
  expect(workPerMove).toBeLessThan(8);
  console.log(`drag frames (4× CPU throttle): n=${frames.length} p50=${pct(0.5).toFixed(1)}ms p95=${pct(0.95).toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms frames>50ms=${jank}`);
  // Smooth enough: the 95th percentile frame within two vsyncs at 60 Hz.
  expect(pct(0.95)).toBeLessThan(34);
});
