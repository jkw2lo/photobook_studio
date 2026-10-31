// Text effects and looks, vertical text, photos cut by hand, and page grades — in core and through
// the PDF exporter.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TEXT_LOOKS, addTextAt, applyTextLook, createPoster, cutPath, displayText, maskPath, polygonArea, saveTextLook, setSurfaceGrade, textBoxForDirection, textLayers, textLookFields,
  updateElement, makeImageElement, gradeFromPreset, type TextElement,
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
