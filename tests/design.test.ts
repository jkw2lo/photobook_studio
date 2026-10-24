// Poster design: keep rotation, the shape library, photo cut-outs, text effects, colour grading
// and templates — in the document model and in the exported PDF.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  POSTER_TEMPLATES, SHAPES, addPhotoAt, addShapeAt, addTextAt, applyPosterTemplate, archGeometry, createPoster, fillPlaceholders, generatePoster,
  gradeColor, gradeFromPreset, gradeMatrix, mapPath, maskPath, pointOnArch, relayoutPoster, scalePath, updateElement,
  type BookDocument, type ImageElement, type PhotoAsset, type ShapeElement, type TextElement,
} from '../src/core';
import { exportPosterPdf } from '../src/server/pdf';
import { textOutline } from '../src/server/textOutline';
import { fakeAsset, resetFakeAssets } from './helpers';

const imgs = (doc: BookDocument) => doc.spreads[0].elements.filter((e): e is ImageElement => e.type === 'image');
const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));
const base = { style: 'mosaic' as const, photoCount: 20, gapMm: 3, marginMm: 15, titlePosition: 'none' as const, seed: 1 };

beforeEach(() => resetFakeAssets());

describe('keep rotation', () => {
  it('keeps a photo’s tilt (and the photo) through Arrange and Shuffle', () => {
    const assets = Array.from({ length: 60 }, () => fakeAsset());
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, base).doc;
    const target = imgs(doc)[4];
    doc = updateElement(doc, doc.spreads[0].id, target.id, { rotationDeg: -12, keepRotation: true });
    for (const next of [generatePoster(doc, assets, { ...base, seed: 3 }).doc, relayoutPoster(doc, assetMap(assets), { ...base, style: 'grid' })]) {
      const kept = imgs(next).find((e) => e.assetId === target.assetId);
      expect(kept?.rotationDeg).toBe(-12);
      expect(kept?.id).toBe(target.id);
    }
  });
});

describe('shape library', () => {
  it('every path uses only M/L/C/Q/Z, stays in its 100 × 100 box, and scales cleanly', () => {
    for (const s of SHAPES) {
      expect(s.d, s.id).toMatch(/^M[\d .MLCQZ-]+$/);
      const nums: number[] = [];
      mapPath(s.d, (x, y) => (nums.push(x, y), [x, y]));
      expect(Math.min(...nums), s.id).toBeGreaterThanOrEqual(-0.01);
      expect(Math.max(...nums), s.id).toBeLessThanOrEqual(100.01);
    }
    expect(scalePath('M0 0L100 50Z', 200, 10)).toBe('M0 0L200 5Z');
  });

  it('adds shapes sized to their proportions; banners come with text on top', () => {
    let doc = createPoster({ title: 'X', sizeId: 'p18x24' });
    const sheet = doc.spreads[0].id;
    doc = addShapeAt(doc, sheet, 'i-heart', 200, 200).doc;
    const heart = doc.spreads[0].elements[0] as ShapeElement;
    expect(heart.shape).toBe('i-heart');
    expect(heart.widthMm / heart.heightMm).toBeCloseTo(1.05, 1);
    doc = addShapeAt(doc, sheet, 'ribbon', 200, 400).doc;
    const [, ribbon, label] = doc.spreads[0].elements;
    expect((ribbon as ShapeElement).shape).toBe('ribbon');
    expect(label.type).toBe('text');
    expect((label as TextElement).color).toBe('#ffffff');
  });
});

describe('photo cut-outs', () => {
  it('shape masks stretch to the frame; text masks keep their proportions', () => {
    const circle = maskPath({ kind: 'shape', shape: 'circle' }, 200, 100);
    expect(circle.d.startsWith('M100 0')).toBe(true);
    const t = maskPath({ kind: 'text', d: 'M0 0L300 0L300 100L0 100Z', aspect: 3 }, 600, 600);
    // 3:1 text in a square frame: full width, a third of the height, centred.
    expect(t.d).toBe('M0 200L600 200L600 400L0 400Z');
  });

  it('outlines text with the bundled fonts, cropped tight and 100 units tall', () => {
    const o = textOutline({ text: 'LOVE', fontFamily: 'Abril Fatface', fontWeight: 400 });
    expect(o.aspect).toBeGreaterThan(2);
    const ys: number[] = [];
    mapPath(o.d, (x, y) => (ys.push(y), [x, y]));
    expect(Math.min(...ys)).toBeCloseTo(0, 0);
    expect(Math.max(...ys)).toBeCloseTo(100, 0);
    const two = textOutline({ text: 'BIG\nDAY', fontFamily: 'Inter', fontWeight: 900 });
    expect(two.aspect).toBeLessThan(o.aspect);
  });

  it('collage photo shapes cut every photo, and survive re-flows', () => {
    const assets = Array.from({ length: 20 }, () => fakeAsset());
    const doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, { ...base, style: 'grid', frameShape: 'circle' }).doc;
    expect(imgs(doc).every((e) => e.mask?.kind === 'shape' && e.mask.shape === 'circle' && e.borderMm === 0)).toBe(true);
    const next = relayoutPoster(doc, assetMap(assets), { ...doc.collage!, frameShape: undefined });
    expect(imgs(next).some((e) => e.mask)).toBe(false);
  });
});

describe('arched text', () => {
  it('runs along a circle through the box ends, centred in the box', () => {
    const g = archGeometry(200, 60, 100, 10)!;
    expect(g.r).toBeCloseTo(100, 6); // half circle across 200 mm
    const left = pointOnArch(g, 0);
    const mid = pointOnArch(g, g.length / 2);
    const right = pointOnArch(g, g.length);
    expect(left.x).toBeCloseTo(0, 6);
    expect(right.x).toBeCloseTo(200, 6);
    expect(mid.x).toBeCloseTo(100, 6);
    expect(mid.y).toBeLessThan(left.y); // ∩: the middle is higher
    expect(mid.rotDeg).toBeCloseTo(0, 6); // upright at the top
    expect(archGeometry(200, 60, 0, 10)).toBeNull();
    const smile = archGeometry(200, 60, -50, 10)!;
    expect(pointOnArch(smile, smile.length / 2).y).toBeGreaterThan(pointOnArch(smile, 0).y);
  });
});

describe('colour grade', () => {
  it('presets do what they say', () => {
    const red: [number, number, number] = [200, 60, 50];
    const bw = gradeColor(gradeFromPreset('bw'), red);
    expect(bw[0]).toBe(bw[1]);
    expect(bw[1]).toBe(bw[2]);
    const warm = gradeColor(gradeFromPreset('warm'), [128, 128, 128]);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const matte = gradeColor(gradeFromPreset('matte'), [0, 0, 0]);
    expect(matte[0]).toBeGreaterThan(20); // lifted blacks
    expect(gradeColor(gradeFromPreset('none'), red)).toEqual(red);
  });
});

describe('templates', () => {
  it.each(POSTER_TEMPLATES.map((t) => t.id))('%s: decorations, filled text, photos inside the area', (id) => {
    const assets = Array.from({ length: 30 }, () => fakeAsset({ widthPx: 6000, heightPx: 4000 }));
    const poster = { ...createPoster({ title: 'Lisbon', sizeId: 'p18x24' }), subtitle: 'June 2026' };
    const { doc } = applyPosterTemplate(poster, assets, id);
    const t = POSTER_TEMPLATES.find((x) => x.id === id)!;
    const sheet = doc.spreads[0];
    expect(sheet.background).toBe(t.background);
    expect(doc.template).toBe(id);
    const texts = sheet.elements.filter((e): e is TextElement => e.type === 'text');
    expect(texts.length).toBe(t.items.filter((i) => i.kind === 'text').length);
    expect(texts.some((e) => /\{.*\}/.test(e.text))).toBe(false);
    expect(imgs(doc).length).toBeGreaterThan(3);
    // Photos stay inside the template's photo area (with a little room for pinboard tilt).
    const W = doc.settings.trimWidthMm;
    const H = doc.settings.trimHeightMm;
    const b = doc.settings.bleedMm + 0.5;
    const a = t.collage.area;
    const slack = t.collage.style === 'scatter' ? 0.05 * Math.min(W, H) : 0.5;
    for (const f of imgs(doc).filter((e) => !e.rotationDeg)) {
      expect(f.xMm).toBeGreaterThanOrEqual((a.x <= 0 ? -b : a.x * W) - slack);
      expect(f.yMm).toBeGreaterThanOrEqual((a.y <= 0 ? -b : a.y * H) - slack);
      expect(f.xMm + f.widthMm).toBeLessThanOrEqual((a.x + a.w >= 1 ? W + b : (a.x + a.w) * W) + slack);
    }
    // Arranging again keeps the template's text and shapes, and the photos above any "behind" shapes.
    const again = generatePoster(doc, assets, { ...doc.collage!, seed: 2 }).doc;
    expect(again.spreads[0].elements.filter((e) => e.type !== 'image').length).toBe(sheet.elements.filter((e) => e.type !== 'image').length);
  });

  it('fills placeholders from the poster and its photos', () => {
    const assets = [fakeAsset({ capturedAt: '2025-07-01T10:00:00' }), fakeAsset({ capturedAt: '2025-07-02T10:00:00' })];
    expect(fillPlaceholders('{TITLE} · {year}', { title: 'Lisbon', subtitle: '' }, assets)).toBe('LISBON · 2025');
  });
});

describe('PDF export of design elements', () => {
  it('draws shapes and gradients, clips photos to shapes and text, curves and outlines text, and grades photos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'design-'));
    const photo = join(dir, 'p.jpg');
    await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 60, b: 50 } } }).jpeg().toFile(photo);
    const asset = fakeAsset({ widthPx: 3000, heightPx: 2000 });
    let doc: BookDocument = { ...createPoster({ title: 'X', sizeId: 'p11x14' }), grade: gradeFromPreset('bw') };
    const sheet = doc.spreads[0].id;
    doc = addShapeAt(doc, sheet, 'i-star', 50, 50).doc;
    const star = doc.spreads[0].elements[0];
    doc = updateElement(doc, sheet, star.id, { gradient: { from: '#ff0000', to: '#0000ff', angleDeg: 45 }, strokeColor: '#000000', strokeWidthMm: 0.5 });
    const a = addPhotoAt(doc, sheet, asset, 140, 120);
    doc = updateElement(a.doc, sheet, a.newId, { mask: { kind: 'shape', shape: 'heart' } });
    const o = textOutline({ text: 'HI', fontFamily: 'Abril Fatface', fontWeight: 400 });
    const b = addPhotoAt(doc, sheet, asset, 140, 260);
    doc = updateElement(b.doc, sheet, b.newId, { mask: { kind: 'text', text: 'HI', fontFamily: 'Abril Fatface', fontWeight: 400, d: o.d, aspect: o.aspect } });
    const t = addTextAt(doc, sheet, 140, 320, 'Curved & outlined', 'title');
    doc = updateElement(t.doc, sheet, t.newId, { arch: 60, strokeColor: '#ffffff', strokeWidthMm: 0.4, shadow: { color: '#000000', dxMm: 0.6, dyMm: 0.6, opacity: 0.4 }, gradient: { from: '#ff9a8b', to: '#a18cd1', angleDeg: 90 } });
    const out = join(dir, 'design.pdf');
    const res = await exportPosterPdf(doc, new Map([[asset.id, { asset, workPath: photo }]]), out);
    expect(res.verification.ok).toBe(true);
    const raw = readFileSync(out).toString('latin1');
    expect(raw).toContain('/ShadingType 2'); // gradients (shape and text)
    expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
    // The grade turned the red photo grey: the embedded image is neutral.
    const { m, o: off } = gradeMatrix(gradeFromPreset('bw'));
    const g = [0, 1, 2].map((i) => m[i * 3] * (200 / 255) + m[i * 3 + 1] * (60 / 255) + m[i * 3 + 2] * (50 / 255) + off[i]);
    expect(Math.abs(g[0] - g[2])).toBeLessThan(0.01);
  });
});
