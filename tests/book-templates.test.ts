// Book templates and page add-ons: whole-book looks with front matter, openers and closing pages;
// add-on pages (contents, text sections, quotes…); the contents page keeps itself up to date.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOK_TEMPLATES, PAGE_ADDONS, applyBookTemplate, applyPageAddon, contentsEntries, createBook, generateDraft, insertAddonSpread, insertSpreadAfter,
  preflight, printablePages, refreshContents, removeSpread,
  type BookDocument, type ImageElement, type PhotoAsset, type TextElement,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

const texts = (doc: BookDocument, i: number) => doc.spreads[i].elements.filter((e): e is TextElement => e.type === 'text');
const photosIn = (doc: BookDocument) => new Set(doc.spreads.flatMap((s) => s.elements).filter((e): e is ImageElement => e.type === 'image' && !!e.assetId).map((e) => e.assetId));
const tripAssets = () => Array.from({ length: 60 }, (_, i) => fakeAsset({ day: 1 + Math.floor(i / 20), minute: (i % 20) * 25, widthPx: 6000, heightPx: 4000 }));

beforeEach(() => resetFakeAssets());

function draftedBook(assets: PhotoAsset[]) {
  return generateDraft(createBook({ title: 'Lisbon', pages: 24 }), assets, { targetPages: 24, stylePresetId: 'editorial', ordering: 'chronological', includeCaptions: true, seed: 1 }).doc;
}

describe('page add-ons', () => {
  it.each(PAGE_ADDONS.map((a) => a.id))('%s: lands inside the page margins on either side', (id) => {
    const doc = draftedBook(tripAssets());
    for (const side of ['left', 'right'] as const) {
      const next = applyPageAddon(doc, 2, side, id);
      const added = next.spreads[2].elements.filter((e) => !doc.spreads[2].elements.includes(e));
      expect(added.length).toBeGreaterThan(0);
      const W = doc.settings.trimWidthMm;
      for (const e of added) {
        const cx = e.xMm + e.widthMm / 2;
        expect(side === 'left' ? cx < W : cx > W, `${id} ${side}`).toBe(true);
      }
      expect(next.spreads[2].layout?.[side] === `addon:${id}` || id === 'caption-band').toBe(true);
    }
  });

  it('replaces what was on that page but keeps the other page', () => {
    const doc = draftedBook(tripAssets());
    const leftBefore = doc.spreads[3].elements.filter((e) => e.xMm + e.widthMm / 2 < doc.settings.trimWidthMm);
    const next = applyPageAddon(doc, 3, 'right', 'quote');
    for (const e of leftBefore) expect(next.spreads[3].elements).toContainEqual(e);
    expect(texts(next, 3).some((e) => e.text.includes('wander'))).toBe(true);
  });

  it('text uses the book’s styles, so a type pack restyles add-on pages', () => {
    const doc = applyPageAddon(draftedBook(tripAssets()), 2, 'left', 'text-section');
    const heading = texts(doc, 2).find((e) => e.role === 'heading')!;
    expect(heading.styleLinked).toBe(true);
    expect(heading.fontFamily).toBe(doc.style.textStyles.heading.family);
  });
});

describe('table of contents', () => {
  it('lists chapters with their first page, and follows inserted and removed spreads', () => {
    let doc = draftedBook(tripAssets());
    expect(doc.chapters.length).toBe(3);
    doc = insertAddonSpread(doc, 0, { left: 'contents' });
    const toc = () => texts(doc, 1).find((e) => e.auto === 'toc')!;
    const pages = () => texts(doc, 1).find((e) => e.auto === 'toc-pages')!;
    expect(toc().text.split('\n')).toEqual(doc.chapters.map((c) => c.title));
    const before = pages().text.split('\n').map(Number);
    expect(before).toEqual(contentsEntries(doc).map((e) => e.page));
    expect(before[0]).toBeGreaterThan(2);
    // Two more pages before every chapter: every number moves by 2.
    doc = refreshContents(insertSpreadAfter(doc, 1));
    expect(pages().text.split('\n').map(Number)).toEqual(before.map((p) => p + 2));
    doc = refreshContents(removeSpread(doc, 2));
    expect(pages().text.split('\n').map(Number)).toEqual(before);
  });

  it('refreshing an up-to-date book returns the same document', () => {
    const doc = insertAddonSpread(draftedBook(tripAssets()), 0, { left: 'contents' });
    expect(refreshContents(doc)).toBe(doc);
  });
});

describe('book templates', () => {
  it.each(BOOK_TEMPLATES.map((t) => t.id))('%s: a complete, printable book in the template’s look', (id) => {
    const assets = tripAssets();
    const start = createBook({ title: 'Lisbon', pages: 24 });
    const { doc } = applyBookTemplate({ ...start, subtitle: 'March 2026' }, assets, id);
    const t = BOOK_TEMPLATES.find((x) => x.id === id)!;
    expect(doc.style.background).toBe(t.background);
    expect(doc.style.textColor).toBe(t.textColor);
    expect(doc.style.typePackId).toBe(t.typePack);
    expect(doc.template).toBe(id);
    expect(printablePages(doc).length).toBe(24);
    // Front matter after the title page, themed openers, closing pages.
    expect(doc.spreads[1].layout).toEqual({ left: `addon:${t.front.left}`, right: `addon:${t.front.right}` });
    const n = doc.spreads.length;
    expect(doc.spreads[n - 1].layout?.left).toBe(`addon:${t.closing.last}`);
    expect(doc.spreads[n - 2].layout?.right).toBe(`addon:${t.closing.right}`);
    expect(doc.spreads.some((s) => s.layout?.left === 'chapter-divider' || s.layout?.right === 'chapter-divider')).toBe(false);
    const openers = doc.spreads.flatMap((s) => [s.layout?.left, s.layout?.right]).filter((l) => l === `addon:${t.opener}`);
    expect(openers.length).toBeGreaterThanOrEqual(2);
    // The contents page (when the template has one) lists the chapters.
    const toc = doc.spreads.flatMap((s) => s.elements).find((e): e is TextElement => e.type === 'text' && e.auto === 'toc');
    if (toc) expect(toc.text.split('\n')).toEqual(doc.chapters.map((c) => c.title));
    // Nothing important off the page, no empty frames, plenty of photos placed.
    const issues = preflight(doc, new Map(assets.map((a) => [a.id, a]))).filter((i) => ['off-page', 'empty-frame', 'missing-photo'].includes(i.code) || i.severity === 'error');
    expect(issues.filter((i) => i.code !== 'page-count'), issues.map((i) => i.message).join('\n')).toEqual([]);
    expect(photosIn(doc).size).toBeGreaterThan(20);
    expect(doc.cover?.layout?.spread).toBe(t.cover);
  });

  it('undated photos stay in the chapter around them (no opener of their own)', () => {
    const assets = [...tripAssets(), fakeAsset({ capturedAt: null }), fakeAsset({ capturedAt: null })];
    const { doc } = applyBookTemplate(createBook({ title: 'Lisbon', pages: 24 }), assets, 'travel-journal');
    const openerHeadings = doc.spreads.flatMap((s) => s.elements).filter((e): e is TextElement => e.type === 'text' && e.role === 'heading' && doc.chapters.every((c) => c.title !== e.text) && e.text === 'Lisbon');
    expect(openerHeadings).toEqual([]);
  });

  it('keeps locked spreads', () => {
    const assets = tripAssets();
    const doc = draftedBook(assets);
    const locked = { ...doc.spreads[4], locked: true };
    const withLock = { ...doc, spreads: doc.spreads.map((s, i) => (i === 4 ? locked : s)) };
    const { doc: themed } = applyBookTemplate(withLock, assets, 'wedding');
    expect(themed.spreads.some((s) => s.id === locked.id && s.locked)).toBe(true);
  });
});
