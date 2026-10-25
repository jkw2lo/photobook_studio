import type { BookDocument, PhotoAsset, Spread } from './model';
import { evenPageCount, isPrintable } from './book';
import { applyCoverTemplate, applyStylePreset, updateStyle } from './commands';
import { generateDraft, type DraftReport } from './generator';
import { gradeFromPreset } from './grade';
import { pageOfElement } from './layout';
import { applyPageAddon, chapterDateRanges, insertAddonSpread, refreshContents } from './pageAddons';
import { binding } from './printers';
import { newId } from './random';
import { applyTypePack } from './typography';

// Book templates: a complete look for a whole book — layout style, type, paper and ink colours,
// cover, colour grade — plus its front matter (contents, dedication, introduction), themed chapter
// openers and closing pages. Applying one drafts the book from the photos and then adds those
// pages; everything stays editable, and locked spreads are kept as they are.

export interface BookTemplate {
  id: string;
  name: string;
  description: string;
  stylePresetId: string;
  typePack: string;
  background: string;
  textColor: string;
  cover: string;
  grade?: string;
  /** The spread after the title page. */
  front: { left: string; right: string };
  /** Replaces the draft's plain chapter dividers. */
  opener: string;
  /** The page before the last, and the last page. */
  closing: { right: string; last: string };
  /** Swatch colours for the picker. */
  accent: string;
}

export const BOOK_TEMPLATES: BookTemplate[] = [
  {
    id: 'travel-journal', name: 'Travel journal', description: 'Warm paper, handwritten type, tilted prints, map-pin chapter openers and a notes page.',
    stylePresetId: 'scrapbook', typePack: 'journal', background: '#f6efe2', textColor: '#3b3024', cover: 'cover-framed', grade: 'warm',
    front: { left: 'contents', right: 'intro' }, opener: 'opener-icon', closing: { right: 'notes', last: 'the-end' }, accent: '#c0574f',
  },
  {
    id: 'wedding', name: 'Wedding album', description: 'Ivory pages, romantic script, airy single photos, a dedication and a quote.',
    stylePresetId: 'minimalist', typePack: 'romantic', background: '#fbf8f3', textColor: '#4a3f35', cover: 'cover-framed', grade: 'bright',
    front: { left: 'dedication', right: 'contents' }, opener: 'opener', closing: { right: 'quote', last: 'the-end' }, accent: '#b08968',
  },
  {
    id: 'baby', name: 'First year', description: 'Soft blue-grey paper, friendly type, a page per month or milestone.',
    stylePresetId: 'minimalist', typePack: 'retro', background: '#f3f6f9', textColor: '#34495e', cover: 'cover-band',
    front: { left: 'dedication', right: 'contents' }, opener: 'opener', closing: { right: 'notes', last: 'the-end' }, accent: '#7fa7c9',
  },
  {
    id: 'family', name: 'Family yearbook', description: 'Classic Garamond and bold editorial layouts — a year of family life with chapters.',
    stylePresetId: 'editorial', typePack: 'classic', background: '#fbfaf7', textColor: '#1d1d1b', cover: 'cover-band',
    front: { left: 'dedication', right: 'contents' }, opener: 'opener', closing: { right: 'notes', last: 'colophon' }, accent: '#8c6d46',
  },
  {
    id: 'year-review', name: 'Year in review', description: 'Black pages, bold magazine type, mosaic collages and a film grade.',
    stylePresetId: 'collage', typePack: 'magazine', background: '#151515', textColor: '#f2f2f2', cover: 'cover-wrap', grade: 'film',
    front: { left: 'contents', right: 'intro' }, opener: 'opener', closing: { right: 'quote', last: 'colophon' }, accent: '#e9c46a',
  },
  {
    id: 'field-notes', name: 'Field notes', description: 'Typewriter captions on parchment, documentary pacing, an itinerary and a vintage grade.',
    stylePresetId: 'documentary', typePack: 'documentary', background: '#f2efe8', textColor: '#2e2a24', cover: 'cover-framed', grade: 'vintage',
    front: { left: 'contents', right: 'itinerary' }, opener: 'opener', closing: { right: 'notes', last: 'colophon' }, accent: '#6b705c',
  },
  {
    id: 'portfolio', name: 'Portfolio', description: 'White gallery pages, wide-tracked capitals and generous space around every photo.',
    stylePresetId: 'minimalist', typePack: 'gallery', background: '#ffffff', textColor: '#222222', cover: 'cover-framed',
    front: { left: 'intro', right: 'contents' }, opener: 'opener', closing: { right: 'text-section', last: 'colophon' }, accent: '#222222',
  },
];

export function bookTemplate(id: string): BookTemplate | undefined {
  return BOOK_TEMPLATES.find((t) => t.id === id);
}

/** Plain chapter dividers the draft made: [spread index, side, its heading text]. */
function dividerPages(doc: BookDocument): { index: number; side: 'left' | 'right'; heading?: string }[] {
  const out: { index: number; side: 'left' | 'right'; heading?: string }[] = [];
  doc.spreads.forEach((s, index) => {
    for (const side of ['left', 'right'] as const) {
      if (s.layout?.[side] !== 'chapter-divider') continue;
      const heading = s.elements.find((e) => e.type === 'text' && e.role === 'heading' && pageOfElement(e, doc) === side);
      out.push({ index, side, heading: heading?.type === 'text' ? heading.text : undefined });
    }
  });
  return out;
}

/**
 * Restyle and redraft the whole book from a template. `targetPages` defaults to the current page
 * count (at least the binding's minimum); the template's own pages are included in it.
 */
/** Pages a template adds around the drafted photo pages (front spread + closing spread). */
export const TEMPLATE_EXTRA_PAGES = 4;

/** Elements of the existing add-on page(s) on a spread, to carry edited words through a redraft. */
function addonPage(doc: BookDocument | undefined, index: number, side: 'left' | 'right', addonId: string) {
  const s = doc?.spreads[index];
  if (!s || s.layout?.[side] !== `addon:${addonId}`) return null;
  return s.elements.filter((e) => pageOfElement(e, doc!) === side);
}

/**
 * Turn freshly drafted photo pages into a template book: themed chapter openers, the front spread
 * after the title page, and the closing spread. Pages the user already filled in on `previous`
 * (their dedication, notes…) are carried over instead of starting again.
 */
export function finishTemplateBook(drafted: BookDocument, t: BookTemplate, assets: PhotoAsset[], previous?: BookDocument): BookDocument {
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  let book = drafted;
  const dates = chapterDateRanges(book, assetMap);

  // Themed chapter openers in place of the plain dividers.
  for (const d of dividerPages(book)) {
    const ch = book.chapters.find((c) => c.title === d.heading);
    const n = ch ? book.chapters.indexOf(ch) + 1 : 0;
    book = applyPageAddon(book, d.index, d.side, t.opener, { heading: d.heading, label: n ? `Chapter ${n}` : undefined, subtitle: ch ? dates(ch.id) : undefined, chapterDates: dates });
    if (ch) book = { ...book, spreads: book.spreads.map((s, i) => (i === d.index && !s.chapterId ? { ...s, chapterId: ch.id } : s)) };
  }

  // Front matter: the spread after the title page.
  book = insertAddonSpread(book, 0, t.front, { chapterDates: dates });
  const keepFront = [addonPage(previous, 1, 'left', t.front.left), addonPage(previous, 1, 'right', t.front.right)];
  book = {
    ...book,
    spreads: book.spreads.map((s, i) => {
      if (i !== 1) return s;
      const fresh = (side: 'left' | 'right') => s.elements.filter((e) => pageOfElement(e, book) === side);
      return { ...s, chapterId: undefined, elements: [...(keepFront[0] ?? fresh('left')), ...(keepFront[1] ?? fresh('right'))] };
    }),
  };

  // Closing: the photos on the last page move to a new spread before it, whose right page gets the
  // template's closing design; the last page becomes the template's final page.
  const lastIndex = book.spreads.length - 1;
  const last = book.spreads[lastIndex];
  if (!last.locked && isPrintable(lastIndex, 'left', book.spreads.length)) {
    const moved: Spread = { ...last, id: newId(), layout: { left: last.layout?.left } };
    const emptiedLast: Spread = { ...last, elements: [], layout: {}, provenance: undefined };
    book = { ...book, spreads: [...book.spreads.slice(0, lastIndex), moved, emptiedLast] };
    book = applyPageAddon(book, lastIndex, 'right', t.closing.right, { chapterDates: dates });
    book = applyPageAddon(book, lastIndex + 1, 'left', t.closing.last, { chapterDates: dates });
    const pn = previous ? previous.spreads.length : 0;
    const keptRight = addonPage(previous, pn - 2, 'right', t.closing.right);
    const keptLast = addonPage(previous, pn - 1, 'left', t.closing.last);
    if (keptRight || keptLast) {
      book = {
        ...book,
        spreads: book.spreads.map((s, i) => {
          if (i === lastIndex && keptRight) return { ...s, elements: [...s.elements.filter((e) => pageOfElement(e, book) === 'left'), ...keptRight] };
          if (i === lastIndex + 1 && keptLast) return { ...s, elements: keptLast };
          return s;
        }),
      };
    }
  }
  return refreshContents({ ...book, template: t.id });
}

/**
 * Restyle and redraft the whole book from a template. `targetPages` defaults to the current page
 * count (at least the binding's minimum); the template's own pages are included in it.
 */
export function applyBookTemplate(
  doc: BookDocument,
  assets: PhotoAsset[],
  templateId: string,
  opts: { targetPages?: number; includeCaptions?: boolean } = {},
): { doc: BookDocument; report: DraftReport } {
  const t = bookTemplate(templateId);
  if (!t) throw new Error(`Unknown book template “${templateId}”`);
  const assetMap = new Map(assets.map((a) => [a.id, a]));

  // 1. The look: layout style, type pack, paper and ink.
  let styled = applyStylePreset(doc, t.stylePresetId);
  styled = applyTypePack(styled, t.typePack);
  styled = updateStyle(styled, { background: t.background, textColor: t.textColor });

  // 2. Draft the photo pages, leaving room for the template's front and closing spreads.
  const bind = binding(doc.settings);
  const target = evenPageCount(Math.max(opts.targetPages ?? doc.spreads.length * 2 - 2, bind.minPages ?? 0, 12));
  const photoPages = evenPageCount(Math.max(4, target - TEMPLATE_EXTRA_PAGES));
  const { doc: drafted, report } = generateDraft(styled, assets, {
    targetPages: photoPages, stylePresetId: t.stylePresetId, ordering: 'chronological', includeCaptions: opts.includeCaptions ?? true, seed: 1, chapterOpeners: true,
  });

  // 3. Openers, front matter, closing pages.
  let book = finishTemplateBook(drafted, t, assets);

  // 4. Cover and colour grade.
  if (!book.cover?.locked) book = applyCoverTemplate(book, t.cover, assetMap, assets.filter((a) => !a.excluded));
  book = { ...book, grade: t.grade ? gradeFromPreset(t.grade) : undefined };
  return { doc: book, report: { ...report, pages: book.spreads.length * 2 - 2 } };
}
