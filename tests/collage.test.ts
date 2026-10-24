import { beforeEach, describe, expect, it } from 'vitest';
import {
  COLLAGE_STYLES, containsRect, createBook, createPoster, elementBounds, generateDraft, generatePoster, layoutCollage,
  mosaicRows, posterGeometry, preflight, printablePages, relayoutPoster, MOSAIC_LAYOUT, type ImageElement, type PhotoAsset,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));
const imgs = (els: { type: string }[]) => els.filter((e): e is ImageElement => e.type === 'image');
const book = createBook({ title: 'T' });
const box = { x: 10, y: 10, w: 400, h: 600 };

beforeEach(() => resetFakeAssets());

describe('collage engine', () => {
  it('mosaic rows fill the box exactly, keep order, and barely crop', () => {
    const photos = Array.from({ length: 37 }, () => fakeAsset());
    const { elements } = layoutCollage(book, box, photos, { style: 'mosaic', gapMm: 3, seed: 1 });
    const frames = imgs(elements);
    expect(frames.map((f) => f.assetId)).toEqual(photos.map((p) => p.id));
    for (const f of frames) expect(containsRect(box, elementBounds(f), 0.01)).toBe(true);
    // Area covered = box area minus gaps (no holes, no overlaps).
    const area = frames.reduce((s, f) => s + f.widthMm * f.heightMm, 0);
    expect(area / (box.w * box.h)).toBeGreaterThan(0.9);
    // Right and bottom edges are flush with the box.
    expect(Math.max(...frames.map((f) => f.xMm + f.widthMm))).toBeCloseTo(box.x + box.w, 6);
    expect(Math.max(...frames.map((f) => f.yMm + f.heightMm))).toBeCloseTo(box.y + box.h, 6);
    // Frames stay close to photo shapes: the worst crop removes well under half the photo.
    const worst = Math.max(...frames.map((f, i) => Math.abs(Math.log(f.widthMm / f.heightMm / (photos[i].widthPx / photos[i].heightPx)))));
    expect(worst).toBeLessThan(Math.log(1.6));
  });

  it('mosaic row partition covers every photo once', () => {
    const rows = mosaicRows(Array.from({ length: 120 }, (_, i) => (i % 3 ? 1.5 : 0.75)), 600, 900, 2);
    expect(rows.flat()).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it('grid uses identical cells and reports which photos it used', () => {
    const photos = Array.from({ length: 23 }, () => fakeAsset());
    const { elements, used } = layoutCollage(book, box, photos, { style: 'grid', gapMm: 2, seed: 1 });
    const frames = imgs(elements);
    expect(frames).toHaveLength(used.length);
    expect(used.length).toBeLessThanOrEqual(23);
    expect(used.length).toBeGreaterThanOrEqual(18);
    expect(new Set(frames.map((f) => f.widthMm.toFixed(4))).size).toBe(1);
  });

  it('hero gives one photo far more space than the others', () => {
    const photos = Array.from({ length: 20 }, () => fakeAsset());
    const { elements } = layoutCollage(book, box, photos, { style: 'hero', gapMm: 3, seed: 1 });
    const areas = imgs(elements).map((f) => f.widthMm * f.heightMm).sort((a, b) => b - a);
    expect(areas[0]).toBeGreaterThan(areas[1] * 4);
  });

  it('pinboard prints are tilted, bordered, and stay inside the box', () => {
    const photos = Array.from({ length: 25 }, () => fakeAsset());
    const { elements } = layoutCollage(book, box, photos, { style: 'scatter', gapMm: 0, seed: 9 });
    const frames = imgs(elements);
    expect(frames.some((f) => Math.abs(f.rotationDeg) > 1)).toBe(true);
    expect(frames.every((f) => f.borderMm > 0)).toBe(true);
    for (const f of frames) expect(containsRect(box, elementBounds(f), 0.05)).toBe(true);
  });
});

describe('posters', () => {
  it.each(COLLAGE_STYLES.map((s) => s.id))('%s poster: curated, inside the sheet, no print errors', (style) => {
    const assets = Array.from({ length: 80 }, (_, i) => fakeAsset({ day: 1 + Math.floor(i / 30) }));
    const poster = createPoster({ title: 'Summer', sizeId: 'p18x24' });
    const { doc, report } = generatePoster(poster, assets, { style, photoCount: 40, gapMm: 3, marginMm: 15, titlePosition: 'bottom', seed: 2 });
    expect(printablePages(doc)).toBeDefined();
    const sheet = doc.spreads[0];
    const frames = imgs(sheet.elements);
    expect(frames.length).toBe(report.placed);
    expect(report.placed).toBeGreaterThan(30);
    expect(sheet.elements.some((e) => e.type === 'text' && e.text === 'Summer')).toBe(true);
    const problems = preflight(doc, assetMap(assets)).filter((i) => i.severity === 'error' || i.code === 'near-trim' || i.code === 'bleed-gap');
    expect(problems, problems.map((p) => p.message).join('\n')).toEqual([]);
  });

  it('edge-to-edge posters run photos into the bleed, never stopping inside it', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    const { doc } = generatePoster(createPoster({ title: 'X', sizeId: 'pA2', landscape: true }), assets, { style: 'mosaic', photoCount: 30, gapMm: 2, marginMm: 0, titlePosition: 'none', seed: 1 });
    const g = posterGeometry(doc);
    expect(g.width).toBeGreaterThan(g.height);
    const frames = imgs(doc.spreads[0].elements);
    expect(Math.min(...frames.map((f) => f.xMm))).toBeCloseTo(-g.bleed, 6);
    expect(preflight(doc, assetMap(assets)).filter((i) => i.code === 'bleed-gap')).toEqual([]);
  });

  it('keeps favourites and skips duplicates and hidden photos', () => {
    const assets = Array.from({ length: 60 }, (_, i) => fakeAsset({ favorite: i % 20 === 0, excluded: i % 7 === 3 }));
    const { doc } = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, { style: 'mosaic', photoCount: 20, gapMm: 2, marginMm: 12, titlePosition: 'none', seed: 1 });
    const used = new Set(imgs(doc.spreads[0].elements).map((f) => f.assetId));
    for (const a of assets.filter((x) => x.favorite && !x.excluded)) expect(used.has(a.id)).toBe(true);
    for (const a of assets.filter((x) => x.excluded)) expect(used.has(a.id)).toBe(false);
  });

  it('switching collage style keeps the same photos', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    const { doc } = generatePoster(createPoster({ title: 'X', sizeId: 'p12x18' }), assets, { style: 'mosaic', photoCount: 24, gapMm: 2, marginMm: 12, titlePosition: 'none', seed: 1 });
    const before = new Set(imgs(doc.spreads[0].elements).map((f) => f.assetId));
    const next = relayoutPoster(doc, assetMap(assets), { ...doc.collage!, style: 'scatter' });
    expect(new Set(imgs(next.spreads[0].elements).map((f) => f.assetId))).toEqual(before);
  });

  it('features a photo that is sharp enough at hero size', () => {
    const small = Array.from({ length: 20 }, () => fakeAsset({ widthPx: 1600, heightPx: 1067 }));
    const big = fakeAsset({ widthPx: 6000, heightPx: 4000, minute: 5000 });
    const { doc } = generatePoster(createPoster({ title: 'X', sizeId: 'p18x24' }), [...small, big], { style: 'hero', photoCount: 21, gapMm: 3, marginMm: 15, titlePosition: 'none', seed: 1 });
    const frames = imgs(doc.spreads[0].elements).sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm);
    expect(frames[0].assetId).toBe(big.id);
    const assets = assetMap([...small, big]);
    expect(preflight(doc, assets).filter((i) => i.code === 'low-dpi')).toEqual([]);
  });

  it('a different seed shuffles in other photos but keeps favourites', () => {
    const assets = Array.from({ length: 80 }, (_, i) => fakeAsset({ favorite: i === 5 }));
    const settings = { style: 'mosaic' as const, photoCount: 25, gapMm: 2, marginMm: 12, titlePosition: 'none' as const, seed: 1 };
    const base = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, settings).doc;
    const again = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, settings).doc;
    const shuffled = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, { ...settings, seed: 2 }).doc;
    const ids = (d: typeof base) => new Set(imgs(d.spreads[0].elements).map((f) => f.assetId));
    expect(ids(again)).toEqual(ids(base));
    const overlap = [...ids(shuffled)].filter((id) => ids(base).has(id)).length;
    expect(overlap).toBeLessThan(25);
    expect(ids(shuffled).has(assets[5].id)).toBe(true);
  });

  it('uses 150 DPI as the poster warning threshold', () => {
    const p = createPoster({ title: 'X', sizeId: 'p24x36' });
    expect(p.settings.minDpiWarning).toBe(150);
    expect(p.settings.product).toBe('poster');
  });
});

describe('collage book style', () => {
  it('lays out multi-photo pages as mosaics and still hits the page count', () => {
    const assets = Array.from({ length: 120 }, () => fakeAsset());
    const { doc } = generateDraft(createBook({ title: 'T', pages: 20 }), assets, { targetPages: 20, stylePresetId: 'collage', ordering: 'chronological', includeCaptions: false, seed: 1 });
    expect(printablePages(doc)).toHaveLength(20);
    const mosaics = doc.spreads.flatMap((s) => [s.layout?.left, s.layout?.right]).filter((l) => l === MOSAIC_LAYOUT);
    expect(mosaics.length).toBeGreaterThan(8);
    const problems = preflight(doc, assetMap(assets)).filter((i) => ['bleed-gap', 'off-page', 'inside-cover'].includes(i.code));
    expect(problems).toEqual([]);
  });
});
