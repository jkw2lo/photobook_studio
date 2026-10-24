import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyCoverTemplate, applyPrinter, coverDims, coverGeometry, createBook, generateDraft, insertSpreadAfter, migrateDocument,
  SCHEMA_VERSION, preflight, printablePages, reconcileCover, spineWidth, type BookDocument, type ImageElement, type PhotoAsset,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

const inch = (v: number) => v * 25.4;
const settings = (targetPages: number) => ({ targetPages, stylePresetId: 'editorial', ordering: 'chronological' as const, includeCaptions: true, seed: 3 });
const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));
const lulu = (pages: number, bindingId: 'hardcover' | 'softcover' = 'hardcover') => createBook({ title: 'Trip', printerId: 'lulu', bindingId, sizeId: 'lulu-sq85', pages });

beforeEach(() => resetFakeAssets());

describe('printer presets', () => {
  it('applies Lulu interior rules', () => {
    const b = lulu(24);
    expect(b.settings.trimWidthMm).toBeCloseTo(inch(8.5), 3);
    expect(b.settings.bleedMm).toBeCloseTo(inch(0.125), 3);
    expect(b.settings.bleedMode).toBe('all');
  });

  it('uses Lulu’s published casewrap spine table', () => {
    expect(spineWidth(lulu(24)).mm).toBeCloseTo(inch(0.25), 3);
    expect(spineWidth(lulu(84)).mm).toBeCloseTo(inch(0.25), 3);
    expect(spineWidth(lulu(100)).mm).toBeCloseTo(inch(0.5), 3);
    expect(spineWidth(lulu(200)).mm).toBeCloseTo(inch(0.75), 3);
    expect(spineWidth(lulu(200)).source).toBe('table');
  });

  it('uses Lulu’s paperback formula', () => {
    const s = spineWidth(lulu(100, 'softcover'));
    expect(s.mm).toBeCloseTo(inch(100 / 444 + 0.06), 3);
    expect(s.source).toBe('formula');
  });

  it('marks Blurb spine as an estimate until the user enters it', () => {
    const b = createBook({ title: 'B', printerId: 'blurb', bindingId: 'hardcover', sizeId: 'blurb-sq7', pages: 40 });
    expect(b.settings.bleedMode).toBe('outer');
    expect(spineWidth(b).source).toBe('estimate');
    const manual = { ...b, settings: { ...b.settings, coverOverrides: { ...b.settings.coverOverrides, spineMm: 9.5 } } };
    expect(spineWidth(manual)).toEqual({ mm: 9.5, source: 'manual' });
  });

  it('casewrap cover = back + spine + front with a 0.75 in wrap', () => {
    const g = coverGeometry(lulu(100));
    expect(g.width).toBeCloseTo(2 * inch(8.5) + inch(0.5), 3);
    expect(g.bleed).toBeCloseTo(inch(0.75), 3);
    expect(g.folds).toHaveLength(2);
  });
});

describe('covers', () => {
  it('a generated draft gets a cover with the title and a photo on the front', () => {
    const assets = Array.from({ length: 40 }, () => fakeAsset());
    const { doc } = generateDraft(lulu(24), assets, settings(24));
    expect(doc.cover).toBeDefined();
    const { panelW, spine } = coverDims(doc);
    const front = doc.cover!.elements.filter((e) => e.xMm + e.widthMm / 2 > panelW + spine.mm);
    expect(front.some((e) => e.type === 'image' && e.assetId)).toBe(true);
    expect(front.some((e) => e.type === 'text' && e.text === 'Trip')).toBe(true);
    // 24 pages: too thin for spine text by Lulu's guidance.
    expect(doc.cover!.elements.some((e) => e.type === 'text' && e.rotationDeg === 90)).toBe(false);
  });

  it('adds spine text once the book is thick enough', () => {
    const assets = Array.from({ length: 150 }, () => fakeAsset());
    const { doc } = generateDraft(lulu(100), assets, settings(100));
    const spineText = doc.cover!.elements.find((e) => e.type === 'text' && e.rotationDeg === 90);
    expect(spineText).toBeDefined();
    expect(preflight(doc, assetMap(assets)).filter((i) => i.spreadIndex === -1 && i.severity !== 'info')).toEqual([]);
  });

  it.each(['cover-band', 'cover-framed', 'cover-wrap'])('%s passes cover preflight', (tpl) => {
    const assets = Array.from({ length: 150 }, () => fakeAsset());
    let { doc } = generateDraft(lulu(100), assets, settings(100));
    doc = applyCoverTemplate(doc, tpl, assetMap(assets));
    const problems = preflight(doc, assetMap(assets)).filter((i) => i.spreadIndex === -1 && i.severity !== 'info');
    expect(problems, problems.map((p) => p.message).join('\n')).toEqual([]);
  });

  it('keeps the front cover aligned when pages are added (spine grows)', () => {
    const assets = Array.from({ length: 150 }, () => fakeAsset());
    let { doc } = generateDraft(lulu(84), assets, settings(84));
    const before = coverDims(doc);
    const frontImg = (d: BookDocument) => d.cover!.elements.find((e): e is ImageElement => e.type === 'image' && e.xMm > coverDims(d).panelW)!;
    const offsetBefore = frontImg(doc).xMm - (before.panelW + before.spine.mm);
    // 84 → 86 pages crosses into Lulu's 0.5 in spine row.
    doc = reconcileCover(insertSpreadAfter(doc, 3));
    const after = coverDims(doc);
    expect(after.spine.mm).toBeGreaterThan(before.spine.mm);
    expect(frontImg(doc).xMm - (after.panelW + after.spine.mm)).toBeCloseTo(offsetBefore, 6);
    expect(doc.cover!.spineMm).toBeCloseTo(after.spine.mm, 6);
  });

  it('switching printer updates spine and keeps the cover aligned', () => {
    const assets = Array.from({ length: 40 }, () => fakeAsset());
    const { doc } = generateDraft(lulu(24), assets, settings(24));
    const next = applyPrinter(doc, 'lulu', 'softcover');
    expect(next.cover!.spineMm).toBeCloseTo(spineWidth(next).mm, 6);
  });

  it('flags the Blurb spine estimate in preflight', () => {
    const assets = Array.from({ length: 40 }, () => fakeAsset());
    const book = createBook({ title: 'B', printerId: 'blurb', bindingId: 'hardcover', sizeId: 'blurb-sq7', pages: 24 });
    const { doc } = generateDraft(book, assets, settings(24));
    expect(preflight(doc, assetMap(assets)).some((i) => i.code === 'spine' && i.severity === 'warning')).toBe(true);
  });

  it('flags page counts outside the binding limits', () => {
    const doc = lulu(10);
    expect(printablePages(doc)).toHaveLength(10);
    expect(preflight(doc, new Map()).some((i) => i.code === 'page-count' && i.severity === 'error')).toBe(true);
  });
});

describe('schema migration', () => {
  it('upgrades a v1 book through every migration as a custom-printer book without a cover', () => {
    const current = createBook({ title: 'Old' });
    const { printerId, bindingId, bleedMode, coverOverrides, product, ...oldSettings } = current.settings;
    const { typePackId, textStyles, ...oldStyle } = current.style;
    const v1 = {
      ...current, schemaVersion: 1, settings: oldSettings,
      style: { ...oldStyle, headingFont: { family: 'Playfair Display', weight: 700 }, bodyFont: { family: 'Source Serif 4', weight: 400 }, captionFont: { family: 'Inter', weight: 400 } },
    };
    const migrated = migrateDocument(JSON.parse(JSON.stringify(v1)));
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.style.textStyles.title.family).toBe('Playfair Display');
    expect(migrated.settings.printerId).toBe('custom');
    expect(migrated.settings.bleedMode).toBe('all');
    expect(migrated.cover).toBeUndefined();
  });
});
