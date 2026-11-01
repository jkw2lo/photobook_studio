// Posters made in the desktop editor open here as designed: hand cut-outs, inverted photos, and a
// background photo moved into place with its own adjustments, and the demo's tea poster recipe.
import { describe, expect, it } from 'vitest';
import { backgroundFrame, gradeColor, gradeFromPreset, isNeutralGrade, maskPath } from '../src/core';
import recipe from '../src/web/demo/tea-poster.json';

describe('desktop features, drawn on the web', () => {
  it('inverts colours after black & white', () => {
    const neg = { ...gradeFromPreset('none'), preset: 'custom', mono: 'bw' as const, invert: true };
    expect(gradeColor(neg, [255, 255, 255])).toEqual([0, 0, 0]);
    expect(isNeutralGrade(neg)).toBe(false);
  });

  it('cuts a photo to a kept outline minus erased areas', () => {
    const m = maskPath({ kind: 'cut', keep: [{ x: 0, y: 0.5 }, { x: 1, y: 0.4 }, { x: 1, y: 1 }, { x: 0, y: 1 }], erase: [[{ x: 0.4, y: 0.7 }, { x: 0.6, y: 0.7 }, { x: 0.5, y: 0.9 }]] }, 100, 80);
    expect(m.evenOdd).toBe(true);
    expect(m.d.match(/M/g)!.length).toBe(2);
  });

  it('places a fitted background photo in its own box, with its adjustment', () => {
    const adjust = { ...gradeFromPreset('none'), preset: 'custom', brightness: 20 };
    const f = backgroundFrame({ id: 's', backgroundImage: { assetId: 'a', fit: 'contain', opacity: 1, crop: { cx: 0.3, cy: 0.3, zoom: 1 }, box: { x: -5, y: -100, w: 300, h: 500 }, adjust } }, { width: 279, height: 356, bleed: 3 })!;
    expect([f.xMm, f.yMm, f.widthMm, f.heightMm]).toEqual([-5, -100, 300, 500]);
    expect(f.adjust).toBe(adjust);
  });

  it('the tea poster recipe names a demo photo for every frame and the background', () => {
    const r = recipe as unknown as { photos: string[]; sheet: { backgroundImage: { assetId: string }; elements: { type: string; assetId?: string | null }[] } };
    const files = new Set(r.photos);
    const refs = [r.sheet.backgroundImage.assetId, ...r.sheet.elements.filter((e) => e.type === 'image').map((e) => e.assetId!)];
    expect(refs.every((ref) => ref.startsWith('file:') && files.has(ref.slice(5)))).toBe(true);
  });
});
