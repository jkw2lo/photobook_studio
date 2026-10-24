import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPoster, elementBounds, freeRects, generatePoster, heroCandidates, relayoutPoster, updateElement,
  type BookDocument, type CollageSettings, type ImageElement, type PhotoAsset, type Rect,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

// Arranging posters: pinned photos, "keep crop", the photo source, and hero rotation.

const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));
const imgs = (doc: BookDocument) => doc.spreads[0].elements.filter((e): e is ImageElement => e.type === 'image');
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const base: CollageSettings = { style: 'mosaic', photoCount: 24, gapMm: 3, marginMm: 15, titlePosition: 'none', seed: 1 };
const heroOf = (doc: BookDocument) => imgs(doc).filter((e) => !e.pinned).sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm)[0].assetId!;

beforeEach(() => resetFakeAssets());

describe('free space around pinned photos', () => {
  it('pieces never overlap the obstacle (with its gap) or each other', () => {
    const box = { x: 0, y: 0, w: 400, h: 600 };
    const pins = [{ x: 100, y: 150, w: 180, h: 120 }, { x: 20, y: 420, w: 90, h: 140 }];
    const rects = freeRects(box, pins, 4, 10);
    expect(rects.length).toBeGreaterThan(3);
    for (const r of rects) {
      for (const p of pins) expect(overlaps(r, { x: p.x - 4, y: p.y - 4, w: p.w + 8, h: p.h + 8 })).toBe(false);
      expect(r.x).toBeGreaterThanOrEqual(box.x);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h + 1e-6);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
  });
});

describe('pinned photos', () => {
  const setup = (style: CollageSettings['style']) => {
    const assets = Array.from({ length: 40 }, () => fakeAsset({ widthPx: 6000, heightPx: 4000 }));
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p18x24' }), assets, { ...base, style }).doc;
    const target = imgs(doc)[3];
    // The user enlarges a photo, then pins it.
    doc = updateElement(doc, doc.spreads[0].id, target.id, { xMm: 60, yMm: 200, widthMm: 260, heightMm: 180, pinned: true });
    return { assets, doc, pinned: imgs(doc).find((e) => e.id === target.id)! };
  };

  it.each(['mosaic', 'grid', 'hero', 'scatter'] as const)('%s: Arrange, Shuffle and re-flow leave a pinned photo exactly where it is', (style) => {
    const { assets, doc, pinned } = setup(style);
    const runs = [
      generatePoster(doc, assets, { ...base, style, seed: 1 }).doc,
      generatePoster(doc, assets, { ...base, style, seed: 5 }).doc,
      relayoutPoster(doc, assetMap(assets), { ...base, style }),
      relayoutPoster(doc, assetMap(assets), { ...base, style, seed: 3 }, { shuffle: true }),
    ];
    for (const next of runs) {
      const kept = imgs(next).find((e) => e.id === pinned.id);
      expect(kept).toEqual(pinned);
      const others = imgs(next).filter((e) => e.id !== pinned.id);
      expect(others.length).toBeGreaterThan(10);
      expect(others.some((e) => e.assetId === pinned.assetId)).toBe(false);
      // Grid-like styles flow around it; pinboard prints may tilt but still keep clear of it.
      for (const o of others) expect(overlaps(elementBounds(o), elementBounds(pinned)), `${style}: frame overlaps the pinned photo`).toBe(false);
    }
  });

  it('a pinned photo counts towards the photo total', () => {
    const { assets, doc } = setup('mosaic');
    const next = generatePoster(doc, assets, { ...base, photoCount: 20 }).doc;
    expect(imgs(next)).toHaveLength(20);
  });

  it('locked photos are treated as pinned', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, base).doc;
    const target = imgs(doc)[0];
    doc = updateElement(doc, doc.spreads[0].id, target.id, { locked: true, widthMm: 150 });
    const next = relayoutPoster(doc, assetMap(assets), { ...base, style: 'grid' });
    expect(imgs(next).find((e) => e.id === target.id)?.widthMm).toBe(150);
  });
});

describe('keep crop', () => {
  it('keeps the photo, its crop, fit and border through shuffles, wherever it moves', () => {
    const assets = Array.from({ length: 80 }, () => fakeAsset());
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, base).doc;
    const target = imgs(doc)[5];
    const crop = { cx: 0.3, cy: 0.6, zoom: 1.8 };
    doc = updateElement(doc, doc.spreads[0].id, target.id, { crop, fit: 'cover', borderMm: 2, keepCrop: true });
    for (const seed of [2, 3, 4]) {
      const next = generatePoster(doc, assets, { ...base, seed }).doc;
      const kept = imgs(next).find((e) => e.assetId === target.assetId);
      expect(kept, `seed ${seed} dropped the photo`).toBeDefined();
      expect(kept!.id).toBe(target.id);
      expect(kept!.crop).toEqual(crop);
      expect(kept!.borderMm).toBe(2);
      expect(kept!.keepCrop).toBe(true);
    }
  });
});

describe('photo source', () => {
  it('“All” uses every usable photo; “On sheet” shuffles only what is there', () => {
    const assets = Array.from({ length: 50 }, (_, i) => fakeAsset({ excluded: i % 10 === 0 }));
    const all = generatePoster(createPoster({ title: 'X', sizeId: 'p18x24' }), assets, { ...base, source: 'all', photoCount: 10 }).doc;
    expect(imgs(all)).toHaveLength(45);

    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p18x24' }), assets, { ...base, photoCount: 20 }).doc;
    // The user deletes a few photos, then shuffles what is left.
    const sheet = doc.spreads[0];
    doc = { ...doc, spreads: [{ ...sheet, elements: sheet.elements.filter((e, i) => e.type !== 'image' || i % 4 !== 0) }] };
    const left = new Set(imgs(doc).map((e) => e.assetId));
    const orders = new Set<string>();
    for (const seed of [2, 3, 4]) {
      const next = relayoutPoster(doc, assetMap(assets), { ...base, source: 'sheet', seed }, { shuffle: true });
      expect(new Set(imgs(next).map((e) => e.assetId))).toEqual(left);
      orders.add(imgs(next).map((e) => e.assetId).join());
    }
    expect(orders.size).toBe(3);
  });
});

describe('hero rotation', () => {
  it('shuffles step through many strong photos, not just the favourites', () => {
    const assets = Array.from({ length: 40 }, (_, i) => fakeAsset({ widthPx: 6000, heightPx: 4000, favorite: i % 13 === 0, minute: i * 30 }));
    let doc = createPoster({ title: 'X', sizeId: 'p18x24' });
    const heroes: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      doc = generatePoster(doc, assets, { ...base, style: 'hero', photoCount: 15, seed }).doc;
      heroes.push(heroOf(doc));
    }
    for (let i = 1; i < heroes.length; i++) expect(heroes[i]).not.toBe(heroes[i - 1]);
    expect(new Set(heroes).size).toBeGreaterThanOrEqual(10);
    expect(heroes.filter((id) => assets.find((a) => a.id === id)!.favorite).length).toBeLessThan(6);
  });

  it('never features a photo too small to print at hero size', () => {
    const small = Array.from({ length: 20 }, () => fakeAsset({ widthPx: 1200, heightPx: 800 }));
    const big = Array.from({ length: 6 }, () => fakeAsset({ widthPx: 6000, heightPx: 4000 }));
    const doc = createPoster({ title: 'X', sizeId: 'p18x24' });
    const list = heroCandidates(doc, [...small, ...big], 15);
    expect(new Set(list.map((a) => a.id))).toEqual(new Set(big.map((a) => a.id)));
  });
});
