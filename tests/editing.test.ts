// Editing tools: several items at once (group, align, distribute, duplicate, reorder), per-photo
// adjustments, back cover and spine text, the restart endpoint and poster image export.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addBackBlurb, addPhotoAt, addShapeAt, addTextAt, alignElements, applyCoverTemplate, autoAdjust, backBlurbElement, createBook, createPoster,
  distributeElements, duplicateElements, elementBounds, elementsInRect, expandGroups, generatePoster, gradeChainMatrix, gradeColor, gradeFromPreset,
  groupElements, moveElements, relayoutPoster, removeSpineText, reorderElements, setSpineText, spineTextElement, swapFramePhotos, ungroupElements,
  updateElement, type BookDocument, type ImageElement, type PhotoAsset,
} from '../src/core';
import { createApp } from '../src/server/app';
import { exportPosterImage } from '../src/server/imageExport';
import { fakeAsset, resetFakeAssets } from './helpers';

const els = (doc: BookDocument) => doc.spreads[0].elements;
const byId = (doc: BookDocument, id: string) => els(doc).find((e) => e.id === id)!;
const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));

beforeEach(() => resetFakeAssets());

/** A poster with three text boxes at different places. */
function threeBoxes() {
  let doc = createPoster({ title: 'X', sizeId: 'p16x20' });
  const sheet = doc.spreads[0].id;
  const ids: string[] = [];
  for (const [x, y] of [[80, 60], [200, 150], [320, 300]]) {
    const r = addTextAt(doc, sheet, x, y, 'Hello', 'body');
    doc = r.doc;
    ids.push(r.newId);
  }
  return { doc, sheet, ids };
}

describe('several items at once', () => {
  it('groups expand to all members; ungrouping clears them', () => {
    const { doc, sheet, ids } = threeBoxes();
    const g = groupElements(doc, sheet, ids.slice(0, 2));
    expect(expandGroups(els(g), [ids[0]]).sort()).toEqual(ids.slice(0, 2).sort());
    expect(expandGroups(els(g), [ids[2]])).toEqual([ids[2]]);
    const u = ungroupElements(g, sheet, ids);
    expect(expandGroups(els(u), [ids[0]])).toEqual([ids[0]]);
  });

  it('aligns left edges, centres and bottoms', () => {
    const { doc, sheet, ids } = threeBoxes();
    const left = alignElements(doc, sheet, ids, 'left');
    const xs = ids.map((id) => elementBounds(byId(left, id)).x);
    expect(new Set(xs.map((x) => x.toFixed(6))).size).toBe(1);
    const mid = alignElements(doc, sheet, ids, 'hcenter');
    const cs = ids.map((id) => { const b = elementBounds(byId(mid, id)); return b.x + b.w / 2; });
    expect(Math.max(...cs) - Math.min(...cs)).toBeLessThan(1e-6);
    // One item, or "to the page": against the sheet.
    const toPage = alignElements(doc, sheet, [ids[0]], 'right');
    const b = elementBounds(byId(toPage, ids[0]));
    expect(b.x + b.w).toBeCloseTo(doc.settings.trimWidthMm, 6);
  });

  it('a group aligns as one unit and keeps its shape', () => {
    const { doc, sheet, ids } = threeBoxes();
    const g = groupElements(doc, sheet, ids.slice(0, 2));
    const before = byId(g, ids[1]).xMm - byId(g, ids[0]).xMm;
    const a = alignElements(g, sheet, ids, 'left');
    expect(byId(a, ids[1]).xMm - byId(a, ids[0]).xMm).toBeCloseTo(before, 6);
  });

  it('distributes three items with equal gaps', () => {
    const { doc, sheet, ids } = threeBoxes();
    let d = updateElement(doc, sheet, ids[1], { xMm: 120 });
    d = distributeElements(d, sheet, ids, 'h');
    const bs = ids.map((id) => elementBounds(byId(d, id))).sort((a, b) => a.x - b.x);
    const g1 = bs[1].x - (bs[0].x + bs[0].w);
    const g2 = bs[2].x - (bs[1].x + bs[1].w);
    expect(g1).toBeCloseTo(g2, 6);
    expect(() => distributeElements(d, sheet, ids.slice(0, 2), 'h')).toThrow();
  });

  it('moves, duplicates (with new groups) and reorders together', () => {
    const { doc, sheet, ids } = threeBoxes();
    const moved = moveElements(doc, sheet, ids.slice(0, 2), 10, -5);
    expect(byId(moved, ids[0]).xMm).toBeCloseTo(byId(doc, ids[0]).xMm + 10, 6);
    expect(byId(moved, ids[2]).xMm).toBe(byId(doc, ids[2]).xMm);
    const g = groupElements(doc, sheet, ids.slice(0, 2));
    const dup = duplicateElements(g, sheet, ids.slice(0, 2));
    expect(dup.newIds).toHaveLength(2);
    const copies = dup.newIds.map((id) => byId(dup.doc, id));
    expect(copies[0].groupId).toBe(copies[1].groupId);
    expect(copies[0].groupId).not.toBe(byId(g, ids[0]).groupId);
    const back = reorderElements(doc, sheet, [ids[2]], 'back');
    expect(els(back)[0].id).toBe(ids[2]);
  });

  it('a box selects what it touches', () => {
    const { doc, ids } = threeBoxes();
    const hit = elementsInRect(els(doc), { x: 0, y: 0, w: 260, h: 200 });
    expect(hit.sort()).toEqual(ids.slice(0, 2).sort());
  });

  it('banners come grouped with their text', () => {
    const doc = createPoster({ title: 'X', sizeId: 'p16x20' });
    const next = addShapeAt(doc, doc.spreads[0].id, 'ribbon', 200, 200).doc;
    const [ribbon, label] = els(next);
    expect(ribbon.groupId).toBeDefined();
    expect(label.groupId).toBe(ribbon.groupId);
  });
});

describe('per-photo adjustments', () => {
  it('chain the photo’s adjustment with the document grade', () => {
    const own = { ...gradeFromPreset('none'), brightness: 30, preset: 'custom' };
    const bw = gradeFromPreset('bw');
    const { m, o } = gradeChainMatrix([own, bw]);
    const px = [0.8, 0.2, 0.2].map((_, i) => m[i * 3] * 0.8 + m[i * 3 + 1] * 0.2 + m[i * 3 + 2] * 0.2 + o[i]);
    expect(px[0]).toBeCloseTo(px[2], 6); // still black & white
    expect(gradeChainMatrix([undefined, undefined]).m).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('auto-enhance lifts dark photos, calms bright ones and neutralises a cast', () => {
    const dark = autoAdjust({ meanLuma: 0.25, clippedShadows: 0, clippedHighlights: 0, avgColor: [90, 80, 70] });
    expect(dark.brightness).toBeGreaterThan(15);
    expect(dark.contrast).toBeGreaterThan(0);
    const bright = autoAdjust({ meanLuma: 0.8, clippedShadows: 0, clippedHighlights: 0.08 });
    expect(bright.brightness).toBeLessThan(0);
    const blue = autoAdjust({ meanLuma: 0.5, clippedShadows: 0, clippedHighlights: 0, avgColor: [90, 110, 190] });
    expect(blue.warmth).toBeGreaterThan(0);
    const mid = gradeColor(dark, [64, 64, 64]);
    expect(mid[0]).toBeGreaterThan(64);
  });

  it('follow the photo through Arrange and swaps, and reset when the photo is replaced', () => {
    const assets = Array.from({ length: 20 }, () => fakeAsset());
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, { style: 'mosaic', photoCount: 12, gapMm: 3, marginMm: 12, titlePosition: 'none', seed: 1 }).doc;
    const imgs = () => els(doc).filter((e): e is ImageElement => e.type === 'image');
    const [a, b] = imgs();
    const adj = { ...gradeFromPreset('warm') };
    doc = updateElement(doc, doc.spreads[0].id, a.id, { adjust: adj });
    doc = relayoutPoster(doc, assetMap(assets), { ...doc.collage!, style: 'grid' });
    expect(imgs().find((e) => e.assetId === a.assetId)?.adjust).toEqual(adj);
    const frameA = imgs().find((e) => e.assetId === a.assetId)!;
    const frameB = imgs().find((e) => e.assetId === b.assetId)!;
    doc = swapFramePhotos(doc, { spreadId: doc.spreads[0].id, elementId: frameA.id }, { spreadId: doc.spreads[0].id, elementId: frameB.id }, assetMap(assets));
    expect(imgs().find((e) => e.id === frameB.id)?.adjust).toEqual(adj);
    expect(imgs().find((e) => e.id === frameA.id)?.adjust).toBeUndefined();
  });
});

describe('back cover and spine', () => {
  const thickBook = () => {
    const assets = Array.from({ length: 10 }, () => fakeAsset());
    let doc = createBook({ title: 'Lisbon', pages: 200, printerId: 'lulu', bindingId: 'hardcover' });
    doc = applyCoverTemplate(doc, 'cover-band', assetMap(assets), assets);
    return removeSpineText(doc);
  };

  it('adds a back-cover blurb on the back panel', () => {
    const doc = thickBook();
    const { doc: next, newId } = addBackBlurb(doc);
    const el = backBlurbElement(next)!;
    expect(el.id).toBe(newId);
    expect(el.xMm + el.widthMm).toBeLessThan(doc.settings.trimWidthMm);
  });

  it('puts the title on the spine, rotated and sized to it, and updates or removes it', () => {
    const doc = setSpineText(thickBook(), 'Lisbon 2026');
    const el = spineTextElement(doc)!;
    expect(el.rotationDeg).toBe(90);
    expect(el.type === 'text' && el.text).toBe('Lisbon 2026');
    const renamed = setSpineText(doc, 'Lisbon');
    expect(renamed.cover!.elements.filter((e) => e.type === 'text' && Math.abs(e.rotationDeg) === 90)).toHaveLength(1);
    expect(spineTextElement(removeSpineText(renamed))).toBeUndefined();
  });
});

describe('restart and image export (server)', () => {
  it('restart: refused without the app header, refused in development, accepted when it can restart', async () => {
    const data = mkdtempSync(join(tmpdir(), 'restart-'));
    let restarted = 0;
    for (const restart of [undefined, () => void restarted++]) {
      const { app, store } = createApp(data, { restart });
      const server = app.listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(`${base}/api/restart`, { method: 'POST' })).status).toBe(403);
      const res = await fetch(`${base}/api/restart`, { method: 'POST', headers: { 'x-photobook': '1' } });
      expect(res.status).toBe(restart ? 202 : 409);
      expect((await (await fetch(`${base}/api/health`)).json()).canRestart).toBe(!!restart);
      await new Promise((r) => setTimeout(r, 250));
      server.close();
      store.close();
    }
    expect(restarted).toBe(1);
    rmSync(data, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'darwin')('exports a poster as JPEG and PNG at the asked resolution, trimmed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'img-'));
    const photo = join(dir, 'p.jpg');
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toFile(photo);
    const asset = fakeAsset({ widthPx: 3000, heightPx: 2000 });
    let doc = createPoster({ title: 'X', sizeId: 'p11x14' });
    doc = addPhotoAt(doc, doc.spreads[0].id, asset, 140, 180).doc;
    const assets = new Map([[asset.id, { asset, workPath: photo }]]);
    for (const format of ['jpeg', 'png'] as const) {
      const out = join(dir, `poster.${format}`);
      const r = await exportPosterImage(doc, assets, out, { format, dpi: 100 });
      expect(r.widthPx).toBeCloseTo(1100, -1); // 11 in × 100 DPI, bleed trimmed off
      expect(r.heightPx).toBeCloseTo(1400, -1);
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe(format);
      expect(meta.density).toBe(100);
    }
    writeFileSync(join(dir, 'done'), '');
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
