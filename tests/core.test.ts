import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STYLE_PRESETS, TEMPLATES, applyTemplate, containsRect, createBook, effectiveDpi, elementBounds, generateDraft,
  imagePlacement, migrateDocument, pageBleedRect, pageContentRect, preflight, printablePages, resolveTemplate,
  setSpreadLocked, shuffleSpreadLayout, spreadBleedRect, updateElement, visibleRegion, type BookDocument,
  type ImageElement, type PhotoAsset,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

const settingsFor = (targetPages: number, stylePresetId = 'editorial') => ({
  targetPages, stylePresetId, ordering: 'chronological' as const, includeCaptions: true, seed: 7,
});
const imagesOf = (doc: BookDocument) => doc.spreads.flatMap((s) => s.elements.filter((e): e is ImageElement => e.type === 'image'));
const assetMap = (assets: PhotoAsset[]) => new Map(assets.map((a) => [a.id, a]));

beforeEach(() => resetFakeAssets());

describe('crop geometry', () => {
  it('cover always fills the frame, whatever the crop centre', () => {
    for (const cx of [0, 0.2, 0.5, 1]) {
      for (const zoom of [1, 1.7]) {
        const p = imagePlacement({ w: 100, h: 50 }, { w: 3000, h: 4000 }, { cx, cy: 0.3, zoom }, 'cover');
        expect(p.x).toBeLessThanOrEqual(1e-9);
        expect(p.y).toBeLessThanOrEqual(1e-9);
        expect(p.x + p.w).toBeGreaterThanOrEqual(100 - 1e-9);
        expect(p.y + p.h).toBeGreaterThanOrEqual(50 - 1e-9);
      }
    }
  });

  it('contain shows the whole image centred', () => {
    const p = imagePlacement({ w: 100, h: 100 }, { w: 4000, h: 2000 }, { cx: 0.5, cy: 0.5, zoom: 1 }, 'contain');
    expect(p).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    const v = visibleRegion({ w: 100, h: 100 }, p)!;
    expect(v.src).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('visible source region matches the frame aspect for cover crops', () => {
    const box = { w: 80, h: 120 };
    const img = { w: 4032, h: 3024 };
    const v = visibleRegion(box, imagePlacement(box, img, { cx: 0.7, cy: 0.5, zoom: 1.3 }, 'cover'))!;
    const srcAspect = (v.src.w * img.w) / (v.src.h * img.h);
    expect(srcAspect).toBeCloseTo(box.w / box.h, 6);
    expect(v.dest).toEqual({ x: 0, y: 0, w: 80, h: 120 });
  });

  it('effective DPI drops when the frame grows or zoom increases', () => {
    const asset = fakeAsset({ widthPx: 1200, heightPx: 800 });
    const el = { widthMm: 101.6, heightMm: 67.7, borderMm: 0, crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'cover' } as ImageElement;
    expect(effectiveDpi(el, asset)).toBeCloseTo(300, 0);
    expect(effectiveDpi({ ...el, crop: { ...el.crop, zoom: 2 } }, asset)).toBeCloseTo(150, 0);
  });
});

describe('templates', () => {
  const book = createBook({ title: 'T' });
  it.each(STYLE_PRESETS.map((p) => p.id))('every template stays inside its box for %s', (presetId) => {
    const style = { ...book.style, ...STYLE_PRESETS.find((p) => p.id === presetId)!.style, presetId };
    for (const t of TEMPLATES) {
      for (const side of t.scope === 'spread' ? (['spread'] as const) : (['left', 'right'] as const)) {
        for (const r of resolveTemplate(t, side, book.settings, style)) {
          expect(r.rect.w).toBeGreaterThan(0);
          expect(r.rect.h).toBeGreaterThan(0);
          const box = side === 'spread' ? spreadBleedRect(book.settings) : r.slot.box === 'bleed' ? pageBleedRect(side, book.settings) : pageContentRect(side, book.settings, style);
          expect(containsRect(box, r.rect)).toBe(true);
        }
      }
    }
  });

  it('separates neighbouring slots by exactly one gap', () => {
    const t = TEMPLATES.find((x) => x.id === 'duo-columns')!;
    const [a, b] = resolveTemplate(t, 'right', book.settings, book.style);
    expect(b.rect.x - (a.rect.x + a.rect.w)).toBeCloseTo(book.style.gapMm, 6);
  });
});

describe('draft generation', () => {
  it('produces exactly the requested page count for many photo/page combinations', () => {
    for (const photos of [6, 20, 45, 120]) {
      for (const pages of [10, 14, 20, 40]) {
        for (const preset of STYLE_PRESETS) {
          resetFakeAssets();
          const assets = Array.from({ length: photos }, () => fakeAsset());
          const { doc } = generateDraft(createBook({ title: 'Trip' }), assets, settingsFor(pages, preset.id));
          expect(printablePages(doc)).toHaveLength(pages);
          // No photo appears twice.
          const ids = imagesOf(doc).map((e) => e.assetId);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    const book = createBook({ title: 'Trip' });
    const a = generateDraft(book, assets, settingsFor(16)).doc;
    const b = generateDraft(book, assets, settingsFor(16)).doc;
    const strip = (d: BookDocument) => d.spreads.map((s) => [s.layout, s.elements.map((e) => [e.type, e.xMm, e.yMm, e.type === 'image' ? e.assetId : e.type === 'text' ? e.text : e.fill])]);
    expect(strip(a)).toEqual(strip(b));
  });

  it('keeps every favourite (AC-07) even when photos far exceed capacity', () => {
    const assets = Array.from({ length: 150 }, (_, i) => fakeAsset({ favorite: i % 15 === 0 }));
    const { doc } = generateDraft(createBook({ title: 'Trip' }), assets, settingsFor(10, 'minimalist'));
    const used = new Set(imagesOf(doc).map((e) => e.assetId));
    for (const fav of assets.filter((a) => a.favorite)) expect(used.has(fav.id)).toBe(true);
  });

  it('skips exact duplicates and collapses near-duplicates to one frame', () => {
    // Highly rated so the burst is certainly selected — the question is how many of its frames.
    const original = fakeAsset({ minute: 10, hash: 'ffff0000ffff0000', rating: 5 });
    const exact = fakeAsset({ minute: 10, hash: 'ffff0000ffff0000', exactDuplicateOf: original.id, rating: 5 });
    const burst = [1, 2, 3].map((k) => fakeAsset({ minute: 10 + k, hash: 'ffff0000ffff000' + k, rating: 5 }));
    const others = Array.from({ length: 30 }, () => fakeAsset());
    const { doc, report } = generateDraft(createBook({ title: 'T' }), [original, exact, ...burst, ...others], settingsFor(10));
    const used = new Set(imagesOf(doc).map((e) => e.assetId));
    expect(used.has(exact.id)).toBe(false);
    expect([original, ...burst].filter((a) => used.has(a.id))).toHaveLength(1);
    expect(report.exactDuplicates).toBe(1);
    expect(report.nearDuplicatesSet).toBeGreaterThanOrEqual(3);
  });

  it('never uses excluded or missing photos', () => {
    const assets = Array.from({ length: 24 }, (_, i) => fakeAsset({ excluded: i % 4 === 0, missing: i % 7 === 0 }));
    const { doc } = generateDraft(createBook({ title: 'T' }), assets, settingsFor(12));
    const bad = new Set(assets.filter((a) => a.excluded || a.missing).map((a) => a.id));
    expect(imagesOf(doc).some((e) => bad.has(e.assetId!))).toBe(false);
  });

  it('leaves locked spreads untouched on regeneration (AC-09)', () => {
    const assets = Array.from({ length: 40 }, () => fakeAsset());
    const first = generateDraft(createBook({ title: 'T' }), assets, settingsFor(16)).doc;
    const locked = setSpreadLocked(first, first.spreads[3].id, true);
    const again = generateDraft(locked, assets, { ...settingsFor(16), seed: 99 }).doc;
    expect(again.spreads[3]).toEqual(locked.spreads[3]);
    // Locked photos are not reused elsewhere.
    const lockedIds = new Set(imagesOf({ ...locked, spreads: [locked.spreads[3]] }).map((e) => e.assetId));
    const elsewhere = again.spreads.filter((_, i) => i !== 3).flatMap((s) => s.elements).filter((e) => e.type === 'image' && lockedIds.has(e.assetId));
    expect(elsewhere).toHaveLength(0);
  });

  it('generates no layout problems: no bleed gaps, no text in the binding, nothing off the page (AC-08)', () => {
    for (const preset of STYLE_PRESETS) {
      resetFakeAssets();
      const assets = Array.from({ length: 60 }, (_, d) => fakeAsset({ day: 1 + Math.floor(d / 20) }));
      const { doc } = generateDraft(createBook({ title: 'T', pages: 20 }), assets, settingsFor(20, preset.id));
      const issues = preflight(doc, assetMap(assets)).filter((i) => ['bleed-gap', 'off-page', 'inside-cover', 'empty-frame'].includes(i.code) || (i.code === 'binding' && i.severity !== 'info'));
      expect(issues, `${preset.id}: ${issues.map((i) => i.message).join('\n')}`).toEqual([]);
    }
  });

  it('keeps one chapter per day when regenerating around a locked spread', () => {
    const assets = [1, 2, 3].flatMap((day) => Array.from({ length: 8 }, () => fakeAsset({ day })));
    const first = generateDraft(createBook({ title: 'T' }), assets, settingsFor(12)).doc;
    const again = generateDraft(setSpreadLocked(first, first.spreads[2].id, true), assets, { ...settingsFor(12), seed: 5 }).doc;
    expect(again.chapters.map((c) => c.title)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    expect(again.chapters.some((c) => c.id === again.spreads[2].chapterId)).toBe(true);
  });

  it('creates day chapters for a multi-day trip', () => {
    const assets = [1, 2, 3].flatMap((day) => Array.from({ length: 8 }, () => fakeAsset({ day })));
    const { doc } = generateDraft(createBook({ title: 'T' }), assets, settingsFor(12));
    expect(doc.chapters.map((c) => c.title)).toEqual(['Day 1', 'Day 2', 'Day 3']);
  });

  it('keeps panorama subjects out of the binding', () => {
    const assets = Array.from({ length: 12 }, () => fakeAsset({ widthPx: 6000, heightPx: 3000 }));
    const doc = generateDraft(createBook({ title: 'T' }), assets, settingsFor(20, 'editorial')).doc;
    const issues = preflight(doc, assetMap(assets)).filter((i) => i.code === 'binding' && i.message.includes('main subject'));
    expect(issues).toEqual([]);
    expect(doc.spreads.some((s) => s.layout?.spread === 'panorama')).toBe(true);
  });
});

describe('editing commands', () => {
  it('shuffle keeps the same photos and refuses locked spreads', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    const doc = generateDraft(createBook({ title: 'T' }), assets, settingsFor(12)).doc;
    const before = new Set(doc.spreads[2].elements.filter((e) => e.type === 'image').map((e) => (e as ImageElement).assetId));
    const after = shuffleSpreadLayout(doc, 2, assetMap(assets), 1234);
    expect(new Set(after.spreads[2].elements.filter((e) => e.type === 'image').map((e) => (e as ImageElement).assetId))).toEqual(before);
    const locked = setSpreadLocked(doc, doc.spreads[2].id, true);
    expect(() => shuffleSpreadLayout(locked, 2, assetMap(assets), 1)).toThrow(/locked/);
  });

  it('applyTemplate keeps locked elements in place', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    let doc = generateDraft(createBook({ title: 'T' }), assets, settingsFor(12, 'documentary')).doc;
    const spread = doc.spreads[2];
    const right = spread.elements.find((e) => e.xMm > doc.settings.trimWidthMm)!;
    doc = updateElement(doc, spread.id, right.id, { locked: true });
    const next = applyTemplate(doc, 2, 'right', 'single-margin', assetMap(assets));
    expect(next.spreads[2].elements.find((e) => e.id === right.id)).toEqual({ ...right, locked: true });
  });

  it('commands never mutate the previous document (undo safety)', () => {
    const assets = Array.from({ length: 20 }, () => fakeAsset());
    const doc = generateDraft(createBook({ title: 'T' }), assets, settingsFor(10)).doc;
    const snapshot = JSON.stringify(doc);
    const el = doc.spreads[1].elements[0];
    updateElement(doc, doc.spreads[1].id, el.id, { xMm: 1, rotationDeg: 33 });
    shuffleSpreadLayout(doc, 1, assetMap(assets), 5);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});

describe('preflight', () => {
  it('flags low resolution and photos stopping inside the bleed (AC-11)', () => {
    const lowRes = fakeAsset({ widthPx: 400, heightPx: 300 });
    const book = createBook({ title: 'T' });
    const spread = book.spreads[1];
    spread.elements.push(
      { id: 'low', type: 'image', assetId: lowRes.id, xMm: 20, yMm: 20, widthMm: 150, heightMm: 110, rotationDeg: 0, locked: false, crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'cover', borderMm: 0, borderColor: '#fff' },
      { id: 'gap', type: 'image', assetId: lowRes.id, xMm: -1, yMm: 30, widthMm: 20, heightMm: 20, rotationDeg: 0, locked: false, crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'cover', borderMm: 0, borderColor: '#fff' },
      { id: 'txt', type: 'text', text: 'Hi', role: 'body', xMm: 195, yMm: 50, widthMm: 30, heightMm: 10, rotationDeg: 0, locked: false, fontFamily: 'Inter', fontWeight: 400, fontSizePt: 10, lineHeight: 1.2, letterSpacingEm: 0, uppercase: false, styleLinked: false, align: 'left', color: '#000' },
    );
    const codes = preflight(book, assetMap([lowRes])).map((i) => `${i.code}:${i.elementId ?? ''}`);
    expect(codes).toContain('low-dpi:low');
    expect(codes).toContain('bleed-gap:gap');
    expect(codes).toContain('binding:txt');
  });

  it('rotated bounds grow', () => {
    const b = elementBounds({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, rotationDeg: 45 });
    expect(b.w).toBeCloseTo(Math.SQRT2 * 10, 6);
  });
});

describe('schema', () => {
  it('round-trips a document through JSON', () => {
    const assets = Array.from({ length: 20 }, () => fakeAsset());
    const doc = generateDraft(createBook({ title: 'T' }), assets, settingsFor(10)).doc;
    expect(migrateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it('rejects documents from a newer schema', () => {
    expect(() => migrateDocument({ ...createBook({ title: 'x' }), schemaVersion: 99 })).toThrow(/newer version/);
  });
});

describe('architecture boundaries', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));

  it('core imports nothing from Node, React, the server, or the web UI', () => {
    for (const f of files('src/core')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](node:|fs|path|react|express|sharp|\.\.\/(server|web))/);
    }
  });

  it('no source file references a remote URL (local-first guarantee)', () => {
    for (const f of files('src')) {
      // Comments may cite documentation; code may not contain remote URLs.
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      const urls = src.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      expect(urls.filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u)), f).toEqual([]);
    }
  });
});
