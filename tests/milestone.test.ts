// Milestone 1, end to end through the real HTTP API, real SQLite, real image pipeline and real PDF:
// import 20 photos → generate a draft → edit spreads → restart the server → reopen → export → verify.

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_VERSION, PRINTERS, SIZE_PRESETS, addTextAt, coverGeometry, generateDraft, printablePages, setSpreadLocked, shuffleSpreadLayout, swapFramePhotos, updateElement,
  type BookDocument, type ImageElement, type PhotoAsset,
} from '../src/core';
import { createApp } from '../src/server/app';
import { Store } from '../src/server/db';

const FIXTURES = join(process.cwd(), 'fixtures', 'generated', 'trip');
let dataDir: string;
let photoDir: string;
let server: Server;
let base: string;
let close: () => void;

async function start() {
  const { app, store } = createApp(dataDir);
  await new Promise<void>((r) => {
    server = app.listen(0, '127.0.0.1', () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.close();
    store.close();
  };
}

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as T };
}

beforeAll(async () => {
  if (!existsSync(FIXTURES)) throw new Error('Run `npm run fixtures` first');
  dataDir = mkdtempSync(join(tmpdir(), 'photobook-data-'));
  photoDir = mkdtempSync(join(tmpdir(), 'photobook-photos-'));
  cpSync(FIXTURES, photoDir, { recursive: true });
  await start();
});

afterAll(() => {
  close?.();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(photoDir, { recursive: true, force: true });
});

describe('creating books', () => {
  it('keeps the chosen page size for every printer and size (regression: sizes reverted to 8×8)', async () => {
    for (const pr of PRINTERS) {
      const sizes = pr.id === 'custom' ? SIZE_PRESETS : pr.sizes;
      for (const z of sizes) {
        const res = await api('POST', '/api/projects', { title: `${pr.id} ${z.id}`, printerId: pr.id, bindingId: 'hardcover', sizeId: z.id, pages: 24 });
        expect(res.status, `${pr.id}/${z.id}`).toBe(201);
        const reopened = await api('GET', `/api/projects/${res.body.doc.id}`);
        expect(reopened.body.doc.settings.trimWidthMm, `${pr.id}/${z.id}`).toBeCloseTo(z.widthMm, 3);
        expect(reopened.body.doc.settings.trimHeightMm, `${pr.id}/${z.id}`).toBeCloseTo(z.heightMm, 3);
        expect(reopened.body.doc.settings.printerId).toBe(pr.id);
      }
    }
  });

  it('rejects an unknown size or one the printer does not offer, instead of silently using 8×8', async () => {
    expect((await api('POST', '/api/projects', { title: 'x', sizeId: 'nope' })).status).toBe(400);
    expect((await api('POST', '/api/projects', { title: 'x', printerId: 'lulu', sizeId: 'blurb-sq7' })).status).toBe(400);
  });

  it('reports its API version so a stale server can be detected', async () => {
    expect((await api('GET', '/api/health')).body.apiVersion).toBe(API_VERSION);
  });
});

describe('milestone 1: import → draft → edit → reopen → export', () => {
  let projectId: string;
  let revision: number;
  let assets: PhotoAsset[];
  let doc: BookDocument;

  it('imports the fixture folder in the background (AC-01, AC-02)', async () => {
    const created = await api('POST', '/api/projects', { title: 'Spring Trip', sizeId: 'sq8', stylePresetId: 'editorial' });
    expect(created.status).toBe(201);
    projectId = created.body.doc.id;
    revision = created.body.revision;

    const job = await api('POST', `/api/projects/${projectId}/import`, { folder: photoDir });
    expect(job.status).toBe(202);
    let status = job.body;
    while (status.status !== 'done' && status.status !== 'failed') {
      await new Promise((r) => setTimeout(r, 100));
      status = (await api('GET', `/api/jobs/${job.body.id}`)).body;
    }
    expect(status.errors).toEqual([]);
    expect(status.total).toBe(21);
    // The exact copy of a photo is skipped, not imported a second time.
    expect(status.imported).toBe(20);
    expect(status.exactDuplicates).toBe(1);

    assets = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body;
    expect(assets).toHaveLength(20);
    const byName = (n: string) => assets.find((a) => a.fileName === n)!;
    expect(assets.filter((a) => a.fileName.startsWith('day1-03-market'))).toHaveLength(1);
    // EXIF orientation applied: stored 3000×2000, displayed portrait.
    expect([byName('day2-05-rotated.jpg').widthPx, byName('day2-05-rotated.jpg').heightPx]).toEqual([2000, 3000]);
    // HEIC decoded via sips.
    expect(byName('day2-06-heic-sunset.heic').widthPx).toBe(3000);
    // Dates and GPS from EXIF; the PNG has none.
    expect(byName('day1-01-arrival.jpg').capturedAt).toBe('2026-03-14T09:05:00');
    expect(byName('day1-01-arrival.jpg').gpsLat).toBeCloseTo(36.6667, 3);
    expect(byName('undated-scan.png').capturedAt).toBeNull();
    // The blurry frame really is measured as less sharp.
    expect(byName('day2-03-blurry.jpg').analysis!.sharpness).toBeLessThan(byName('day2-04-lake.jpg').analysis!.sharpness / 4);
    // Thumbnails are served.
    const thumb = await fetch(`${base}/api/assets/${assets[0].id}/thumb?size=s`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toContain('image/jpeg');
  });

  it('records colour features at import, and fills them in for older photos (backfill)', async () => {
    expect(assets.every((a) => a.analysis?.colorGrid?.length === 27 && a.analysis.avgColor)).toBe(true);
    // Simulate a photo imported before colour analysis existed.
    const db = new Store(dataDir);
    const victim = assets[0];
    const { colorGrid, avgColor, ...older } = victim.analysis!;
    db.updateAnalysis(victim.id, older);
    db.close();
    const after = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body.find((a) => a.id === victim.id)!;
    expect(after.analysis?.colorGrid).toHaveLength(27);
  });

  it('re-importing the same folder adds nothing new', async () => {
    const job = await api('POST', `/api/projects/${projectId}/import`, { folder: photoDir });
    let status = job.body;
    while (status.status !== 'done') status = (await api('GET', `/api/jobs/${job.body.id}`)).body;
    expect(status.imported).toBe(0);
    expect(status.alreadyInLibrary).toBe(20);
    expect(status.exactDuplicates).toBe(1);
  });

  it('generates a complete 16-page draft from the imported photos (AC-06)', async () => {
    doc = (await api('GET', `/api/projects/${projectId}`)).body.doc;
    const result = generateDraft(doc, assets, { targetPages: 16, stylePresetId: 'editorial', ordering: 'chronological', includeCaptions: true, seed: 3 });
    doc = result.doc;
    expect(printablePages(doc)).toHaveLength(16);
    expect(result.report.exactDuplicates).toBe(0);
    expect(result.report.nearDuplicatesSet).toBeGreaterThanOrEqual(2); // the summit burst
    const used = doc.spreads.flatMap((s) => s.elements).filter((e): e is ImageElement => e.type === 'image').map((e) => e.assetId);
    expect(used.length).toBeGreaterThanOrEqual(14);
    expect(doc.chapters.map((c) => c.title)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    const saved = await api('PUT', `/api/projects/${projectId}`, { doc, baseRevision: revision });
    expect(saved.status).toBe(200);
    revision = saved.body.revision;
  });

  it('applies manual edits to several spreads and saves them (AC-04)', async () => {
    const map = new Map(assets.map((a) => [a.id, a]));
    const s2 = doc.spreads[2];
    const img = s2.elements.find((e): e is ImageElement => e.type === 'image')!;
    doc = updateElement(doc, s2.id, img.id, { xMm: img.xMm + 4, rotationDeg: 2, crop: { cx: 0.4, cy: 0.6, zoom: 1.25 } });
    doc = addTextAt(doc, doc.spreads[3].id, 100, 30, 'The first morning').doc;
    const frames = doc.spreads.slice(1, 5).flatMap((s) => s.elements.filter((e) => e.type === 'image').map((e) => ({ spreadId: s.id, elementId: e.id })));
    doc = swapFramePhotos(doc, frames[0], frames[frames.length - 1], map);
    doc = shuffleSpreadLayout(doc, 4, map, 42);
    doc = setSpreadLocked(doc, doc.spreads[2].id, true);
    const saved = await api('PUT', `/api/projects/${projectId}`, { doc, baseRevision: revision });
    expect(saved.status).toBe(200);
    revision = saved.body.revision;
  });

  it('refuses a stale save instead of overwriting newer work', async () => {
    const stale = await api('PUT', `/api/projects/${projectId}`, { doc, baseRevision: revision - 1 });
    expect(stale.status).toBe(409);
  });

  it('restores everything after the server restarts (AC-03)', async () => {
    close();
    await start();
    const reopened = await api('GET', `/api/projects/${projectId}`);
    expect(reopened.body.revision).toBe(revision);
    expect(reopened.body.doc).toEqual(doc);
    const revisions = await api('GET', `/api/projects/${projectId}/revisions`);
    expect(revisions.body.length).toBeGreaterThanOrEqual(3);
  });

  it('exports a correctly sized, verified PDF (AC-10)', async () => {
    const res = await api('POST', `/api/projects/${projectId}/export`, {});
    expect(res.status).toBe(200);
    const v = res.body.verification;
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.pageCount).toBe(16);
    // 8 in square + 0.125 in bleed on every side.
    expect(v.pageSizeMm.width).toBeCloseTo(203.2 + 2 * 3.175, 1);
    expect(v.pageSizeMm.height).toBeCloseTo(203.2 + 2 * 3.175, 1);
    expect(res.body.textOverflow).toEqual([]);
    // Low-res fixture is flagged if it was placed (AC-11 covered in core tests too).
    const lowres = assets.find((a) => a.fileName === 'day3-05-lowres.jpg')!;
    const placed = doc.spreads.some((s) => s.elements.some((e) => e.type === 'image' && e.assetId === lowres.id));
    if (placed) expect(res.body.issues.some((i: { code: string }) => i.code === 'low-dpi')).toBe(true);
    mkdirSync('test-results', { recursive: true });
    copyFileSync(res.body.path, 'test-results/milestone.pdf');

    // Cover: one page = back + spine + front + wrap on every side, verified like the interior.
    const cover = res.body.cover;
    expect(cover.verification.problems).toEqual([]);
    expect(cover.verification.pageCount).toBe(1);
    const g = coverGeometry(doc);
    expect(cover.verification.trimSizeMm.width).toBeCloseTo(2 * 203.2 + g.spine!.mm, 1);
    expect(cover.verification.pageSizeMm.width).toBeCloseTo(2 * 203.2 + g.spine!.mm + 2 * g.bleed, 1);
    copyFileSync(cover.path, 'test-results/milestone-cover.pdf');

    const outer = await api('POST', `/api/projects/${projectId}/export`, { bleedMode: 'outer' });
    expect(outer.body.verification.ok).toBe(true);
    expect(outer.body.verification.pageSizeMm.width).toBeCloseTo(203.2 + 3.175, 1);
  });

  it('detects a moved original and relinks it (AC-13)', async () => {
    const victim = assets.find((a) => a.fileName === 'day1-01-arrival.jpg')!;
    mkdirSync(join(photoDir, 'moved'));
    renameSync(join(photoDir, 'day1-01-arrival.jpg'), join(photoDir, 'moved', 'day1-01-arrival.jpg'));
    let list = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body;
    expect(list.find((a) => a.id === victim.id)!.missing).toBe(true);
    const relink = await api('POST', `/api/projects/${projectId}/relink`, { folder: photoDir });
    expect(relink.body).toEqual({ relinked: 1, stillMissing: 0 });
    list = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body;
    expect(list.find((a) => a.id === victim.id)!.missing).toBe(false);
  });
});
