// Text effects and looks, vertical text, photos cut by hand, and page grades — in core and through
// the PDF exporter.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TEXT_LOOKS, addTextAt, applyTextLook, createPoster, cutPath, displayText, maskPath, polygonArea, saveTextLook, setSurfaceGrade, textBoxForDirection, textLayers, textLookFields,
  updateElement, makeImageElement, gradeFromPreset, gradeColor, isNeutralGrade, gradeHex, gradeSurfaceColours, pageGrades, PATTERNS, patternPath, setSurfacePattern, STICKER_PACKS, addSticker, stickerFields, type TextElement,
} from '../src/core';
import { exportPosterPdf } from '../src/server/pdf';

describe('text', () => {
  const base = { text: 'Hi there\nYou', uppercase: false, vertical: false };

  it('stacks letters for vertical text, each line a column', () => {
    expect(displayText({ ...base, vertical: true })).toBe('H\ni\n \nt\nh\ne\nr\ne\n\nY\no\nu');
    expect(displayText({ ...base, uppercase: true })).toBe('HI THERE\nYOU');
    const box = textBoxForDirection({ text: 'Lisbon', fontSizePt: 20, lineHeight: 1.1, widthMm: 80, heightMm: 10, paddingMm: 0, uppercase: false }, true);
    expect(box.heightMm).toBeGreaterThan(box.widthMm * 3);
  });

  it('draws effect layers back to front: glow, shadow, 3D, outer outline', () => {
    const layers = textLayers({
      glow: { color: '#f0f', sizeMm: 2 }, shadow: { color: '#000', dxMm: 1, dyMm: 1, opacity: 0.5 },
      extrude: { color: '#333', depthMm: 2, angleDeg: 90 }, outline2: { color: '#fff', widthMm: 0.5 }, strokeWidthMm: 0.4,
    });
    expect(layers[0].blurMm).toBeGreaterThan(0);
    expect(layers.at(-1)).toMatchObject({ color: '#fff', strokeMm: 1.4 });
    const extrusion = layers.filter((l) => l.color === '#333');
    expect(extrusion[0].dyMm).toBeCloseTo(2);
    expect(extrusion.at(-1)!.dyMm).toBeLessThan(0.3);
    expect(textLayers({})).toEqual([]);
  });

  it('looks set every effect (and clear the rest), scaled to the page; saved looks reuse a box', () => {
    const doc0 = createPoster({ title: 'T', sizeId: 'p11x14' });
    const pop = textLookFields(doc0, TEXT_LOOKS.find((l) => l.id === 'pop3d')!);
    expect(pop.extrude!.depthMm).toBeGreaterThan(1);
    expect(pop.glow).toBeUndefined();
    const sheet = doc0.spreads[0].id;
    const r = addTextAt(doc0, sheet, 100, 100, 'Big', 'title');
    let doc = applyTextLook(r.doc, sheet, r.newId, { ...textLookFields(doc0, TEXT_LOOKS.find((l) => l.id === 'neon-pink')!) });
    let el = doc.spreads[0].elements.find((e) => e.id === r.newId) as TextElement;
    expect(el.glow).toBeTruthy();
    doc = applyTextLook(doc, sheet, r.newId, pop);
    el = doc.spreads[0].elements.find((e) => e.id === r.newId) as TextElement;
    expect(el.glow).toBeUndefined();
    expect(el.text).toBe('Big');
    const saved = saveTextLook(doc, 'Mine', el).doc;
    expect(saved.textLooks![0]).toMatchObject({ name: 'Mine', fields: { fontFamily: 'Archivo Black' } });
  });
});

describe('cutting photos by hand', () => {
  it('keeps an outline and removes erased areas, merging overlapping erasers', () => {
    const half = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const d = cutPath({ keep: half, erase: [] }, 100, 50);
    expect(d).toContain('M');
    // Two overlapping round holes in the middle of the frame: still just holes, never refilled.
    const circle = (cx: number) => Array.from({ length: 24 }, (_, i) => ({ x: cx + 0.15 * Math.cos((i / 24) * 2 * Math.PI), y: 0.5 + 0.3 * Math.sin((i / 24) * 2 * Math.PI) }));
    const holes = maskPath({ kind: 'cut', erase: [circle(0.45), circle(0.55)] }, 100, 100);
    expect(holes.evenOdd).toBe(true);
    // One frame outline plus one merged hole.
    expect(holes.d.match(/M/g)!.length).toBe(2);
    const area = (path: string) => path.split('Z').filter((p) => p.trim()).map((ring) => Math.abs(polygonArea([...ring.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))))).reduce((a, b) => a + b, 0);
    expect(area(holes.d)).toBeGreaterThan(10000);
  });
});

describe('PDF export', () => {
  it('prints every text effect, a cut photo and a page grade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    try {
      let doc = createPoster({ title: 'FX', sizeId: 'p11x14' });
      const sheet = doc.spreads[0].id;
      for (const look of TEXT_LOOKS) {
        const r = addTextAt(doc, sheet, 140, 60, look.sample, 'title');
        doc = applyTextLook(r.doc, sheet, r.newId, textLookFields(doc, look));
      }
      const v = addTextAt(doc, sheet, 40, 200, 'TALL', 'title');
      doc = updateElement(v.doc, sheet, v.newId, { vertical: true, skewDeg: 8 });
      const frame = { ...makeImageElement(doc, null, { x: 20, y: 20, w: 100, h: 80 }), mask: { kind: 'cut' as const, keep: [{ x: 0, y: 0.3 }, { x: 1, y: 0.1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], erase: [] } };
      doc = { ...doc, spreads: [{ ...doc.spreads[0], elements: [...doc.spreads[0].elements, frame] }] };
      doc = setSurfaceGrade(doc, sheet, gradeFromPreset('warm'));
      const res = await exportPosterPdf(doc, new Map(), join(dir, 'fx.pdf'));
      expect(res.verification.ok).toBe(true);
      expect(res.bytes).toBeGreaterThan(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('inverted photos', () => {
  const g = (over: object) => ({ ...gradeFromPreset('none'), preset: 'custom', ...over });
  it('turns white to black and colours to their opposites, after black & white', () => {
    expect(gradeColor(g({ invert: true }), [255, 255, 255])).toEqual([0, 0, 0]);
    expect(gradeColor(g({ invert: true }), [200, 100, 50])).toEqual([55, 155, 205]);
    const [r, gg, b] = gradeColor(g({ invert: true, mono: 'bw' }), [200, 100, 50]);
    expect(r).toBe(gg);
    expect(gg).toBe(b);
    expect(r).toBeGreaterThan(128); // a mid-dark colour becomes a light grey
    expect(isNeutralGrade(g({ invert: true }))).toBe(false);
  });
});

describe('what a grade applies to', () => {
  const bw = { ...gradeFromPreset('none'), preset: 'custom', mono: 'bw' as const };
  it('photos only leaves the page alone; the whole page recolours background, text and shapes', () => {
    expect(pageGrades([bw, undefined])).toEqual([]);
    const whole = { ...bw, scope: 'page' as const };
    expect(pageGrades([undefined, whole])).toEqual([whole]);
    expect(gradeHex('#ff0000', [whole])).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(gradeHex('none', [whole])).toBe('none');
    let doc = createPoster({ title: 'G', sizeId: 'p11x14' });
    const r = addTextAt(doc, doc.spreads[0].id, 50, 50, 'Hi', 'title');
    doc = updateElement(r.doc, doc.spreads[0].id, r.newId, { color: '#d02020' });
    const shown = gradeSurfaceColours({ ...doc.spreads[0], background: '#2040c0' }, doc.style.background, [whole]);
    expect(shown.background).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect((shown.elements[0] as TextElement).color).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  it('prints a whole-page grade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scope-'));
    try {
      let doc = createPoster({ title: 'G', sizeId: 'p11x14' });
      const r = addTextAt(doc, doc.spreads[0].id, 50, 50, 'Hi', 'title');
      doc = { ...r.doc, grade: { ...bw, scope: 'page' } };
      const res = await exportPosterPdf(doc, new Map(), join(dir, 'g.pdf'));
      expect(res.verification.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('background patterns', () => {
  const sheet = { x: -3, y: -3, w: 285, h: 362 };
  it('covers the page with tiles, never more than a few thousand, and rotates', () => {
    for (const def of PATTERNS) {
      const d = patternPath({ id: def.id, color: '#000', opacity: 1, sizeMm: 12, angleDeg: 30 }, sheet);
      expect(d.length, def.id).toBeGreaterThan(20);
    }
    const tiny = patternPath({ id: 'dots', color: '#000', opacity: 1, sizeMm: 1, angleDeg: 0 }, sheet);
    expect(tiny.match(/M/g)!.length).toBeLessThanOrEqual(4600);
    const flat = patternPath({ id: 'stripes', color: '#000', opacity: 1, sizeMm: 20, angleDeg: 0 }, sheet);
    const turned = patternPath({ id: 'stripes', color: '#000', opacity: 1, sizeMm: 20, angleDeg: 45 }, sheet);
    expect(turned).not.toBe(flat);
  });

  it('prints a gradient pattern and sticker effects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pat-'));
    try {
      let doc = createPoster({ title: 'P', sizeId: 'p11x14' });
      const sheetId = doc.spreads[0].id;
      doc = setSurfacePattern(doc, sheetId, { id: 'halftone', color: '#000', gradient: { from: '#ff0000', to: '#0000ff', angleDeg: 90 }, opacity: 0.4, sizeMm: 8, angleDeg: 20 });
      for (const pack of STICKER_PACKS) for (const shape of pack.shapes) doc = addSticker(doc, sheetId, pack.id, shape, 100, 100).doc;
      const res = await exportPosterPdf(doc, new Map(), join(dir, 'p.pdf'));
      expect(res.verification.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('sticker packs style their stickers from the pack, sized to the sticker', () => {
    const neon = STICKER_PACKS.find((p) => p.id === 'neon')!;
    const a = stickerFields(neon, 0, 40, 40);
    const b = stickerFields(neon, 0, 80, 80);
    expect(a.glow!.sizeMm * 2).toBeCloseTo(b.glow!.sizeMm);
    expect(stickerFields(neon, 1, 40, 40).glow!.color).not.toBe(a.glow!.color);
  });
});
