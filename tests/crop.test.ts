// The crop tool: dragging the crop box's edges re-frames the photo without moving it on the page,
// and never lets the box run past the photo. Background photos can be moved and resized.
import { describe, expect, it } from 'vitest';
import { backgroundBox, backgroundFrame, imagePlacement, innerBox, moveBackground, reframeCrop, scaleBackground, type BackgroundImage, type ImageElement } from '../src/core';

const IMG = { w: 2000, h: 1000 };

const frame = (over: Partial<ImageElement> = {}): ImageElement => ({
  id: 'f', type: 'image', assetId: 'a', xMm: 10, yMm: 20, widthMm: 100, heightMm: 100, rotationDeg: 0, locked: false,
  crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'cover', borderMm: 0, borderColor: '#fff', ...over,
});

/** Where a point of the photo (normalized u, v) lands on the page. */
function pagePoint(el: ImageElement, u: number, v: number) {
  const box = innerBox(el);
  const p = imagePlacement(box, IMG, el.crop, el.fit);
  const lx = box.x + p.x + u * p.w - el.widthMm / 2;
  const ly = box.y + p.y + v * p.h - el.heightMm / 2;
  const r = (el.rotationDeg * Math.PI) / 180;
  return { x: el.xMm + el.widthMm / 2 + lx * Math.cos(r) - ly * Math.sin(r), y: el.yMm + el.heightMm / 2 + lx * Math.sin(r) + ly * Math.cos(r) };
}

const expectSamePhotoPosition = (a: ImageElement, b: ImageElement) => {
  for (const [u, v] of [[0, 0], [1, 1], [0.3, 0.7]]) {
    const pa = pagePoint(a, u, v);
    const pb = pagePoint(b, u, v);
    expect(pb.x).toBeCloseTo(pa.x, 6);
    expect(pb.y).toBeCloseTo(pa.y, 6);
  }
};

describe('crop box', () => {
  it('moves one edge without moving the photo', () => {
    const el = frame();
    const next = { ...el, ...reframeCrop(el, IMG, 'e', -30, 0) };
    expect(next.widthMm).toBeCloseTo(70);
    expect(next.xMm).toBeCloseTo(10);
    expectSamePhotoPosition(el, next);
  });

  it('keeps the photo still for rotated, bordered and zoomed frames', () => {
    const el = frame({ rotationDeg: 17, borderMm: 3, crop: { cx: 0.4, cy: 0.55, zoom: 1.6 } });
    for (const [h, dx, dy] of [['nw', 12, 9], ['s', 0, -25], ['w', 20, 0]] as const) {
      const next = { ...el, ...reframeCrop(el, IMG, h, dx, dy) };
      expectSamePhotoPosition(el, next);
    }
  });

  it('stops at the edge of the photo', () => {
    // The photo is 200 mm wide in a 100 mm frame, centred: 50 mm hidden on each side, none above or below.
    const el = frame();
    const wider = reframeCrop(el, IMG, 'e', 500, 0);
    expect(wider.widthMm).toBeCloseTo(150);
    const taller = reframeCrop(el, IMG, 's', 0, 40);
    expect(taller.heightMm).toBeCloseTo(100);
  });

  it('crops a fitted photo to the photo itself, then fills', () => {
    const el = frame({ fit: 'contain' }); // a 100 × 50 photo letterboxed in a 100 × 100 frame
    const next = { ...el, ...reframeCrop(el, IMG, 'e', -10, 0) };
    expect(next.fit).toBe('cover');
    expect(next.heightMm).toBeCloseTo(50);
    expect(next.widthMm).toBeCloseTo(90);
    expectSamePhotoPosition(el, next);
  });

  it('keeps a chosen shape while dragging and when the shape is picked', () => {
    const el = frame();
    const square = reframeCrop(el, IMG, 'se', -40, -10, 1);
    expect(square.widthMm / square.heightMm).toBeCloseTo(1);
    const wide = reframeCrop(el, IMG, null, 0, 0, 16 / 9);
    expect(wide.widthMm / wide.heightMm).toBeCloseTo(16 / 9);
    expect(wide.widthMm).toBeLessThanOrEqual(200.0001);
    expectSamePhotoPosition(el, { ...el, ...wide });
  });
});

describe('background photo', () => {
  const g = { width: 300, height: 400, bleed: 3 };
  const asset = { widthPx: 2000, heightPx: 1000 };
  const bg: BackgroundImage = { assetId: 'a', fit: 'contain', opacity: 1, crop: { cx: 0.5, cy: 0.5, zoom: 1 } };

  it('starts fitted and centred, and can be moved and resized when fitted', () => {
    const start = backgroundBox(bg, g, asset);
    expect(start.w).toBeCloseTo(306);
    expect(start.y + start.h / 2).toBeCloseTo(200);
    const moved = { ...bg, ...moveBackground(bg, g, asset, 0, -100) };
    expect(moved.box!.y).toBeCloseTo(start.y - 100);
    const f = backgroundFrame({ id: 's', backgroundImage: moved }, g)!;
    expect([f.yMm, f.heightMm]).toEqual([moved.box!.y, moved.box!.h]);
    const smaller = { ...moved, ...scaleBackground(moved, g, asset, 0.5, { x: moved.box!.x, y: moved.box!.y }) };
    expect(smaller.box!.w).toBeCloseTo(start.w / 2);
    expect(smaller.box!.x).toBeCloseTo(moved.box!.x);
  });

  it('pans and zooms a filling background, never leaving a gap', () => {
    const fill: BackgroundImage = { ...bg, fit: 'cover' };
    const panned = { ...fill, ...moveBackground(fill, g, asset, 1e4, 0) };
    // Pushed as far right as it goes: its left edge meets the sheet's (bleed) edge, no gap.
    expect(imagePlacement({ w: 306, h: 406 }, { w: 2000, h: 1000 }, panned.crop, 'cover').x).toBeCloseTo(0);
    const zoomed = { ...fill, ...scaleBackground(fill, g, asset, 0.5, { x: 150, y: 200 }) };
    expect(zoomed.crop.zoom).toBe(1);
    expect(backgroundFrame({ id: 's', backgroundImage: { ...fill, adjust: { preset: 'custom', brightness: 20, contrast: 10, saturation: 0, warmth: 0, fade: 0 } } }, g)!.adjust?.brightness).toBe(20);
  });
});
