import { produce, type Draft } from 'immer';
import type { BookDocument, Element, PhotoAsset, Rect, Spread, TextElement, TextRole } from './model';
import { blankSpread, isPrintable, pageContentRect, pageNumberOf, type PageSide } from './book';
import { CommandError } from './commands';
import { dateRangeOf } from './curation';
import { makeImageElement, makeShapeElement, makeTextElement, pageOfElement } from './layout';
import { shapeDef } from './shapes';
import { mixColor, roleSizePt } from './typography';
import { MM_PER_PT } from './units';

// Page add-ons: ready-made pages for a book — table of contents, title page, dedication, quote,
// text sections, chapter openers, notes, the end. They are built from the book's text styles (so a
// type pack restyles them) plus a few lines and icons, inside the page margins. The contents page
// fills itself in from the chapters and keeps its page numbers up to date.

export type AddonCategory = 'front' | 'text' | 'chapter' | 'back';

type Tone = 'text' | 'muted' | 'accent';

type Item =
  | { kind: 'text'; role: TextRole; text: string; x: number; y: number; w: number; h: number; align?: 'left' | 'center' | 'right'; scale?: number; italic?: boolean; lineHeight?: number; auto?: TextElement['auto'] }
  | { kind: 'shape'; shape: string; x: number; y: number; w: number; h: number; tone?: Tone; keepAspect?: boolean }
  | { kind: 'frame'; x: number; y: number; w: number; h: number };

export interface PageAddon {
  id: string;
  name: string;
  description: string;
  category: AddonCategory;
  items: Item[];
}

const T = (role: TextRole, text: string, x: number, y: number, w: number, h: number, extra: Partial<Extract<Item, { kind: 'text' }>> = {}): Item => ({ kind: 'text', role, text, x, y, w, h, align: 'center', ...extra });
const S = (shape: string, x: number, y: number, w: number, h: number, extra: Partial<Extract<Item, { kind: 'shape' }>> = {}): Item => ({ kind: 'shape', shape, x, y, w, h, tone: 'muted', ...extra });
const F = (x: number, y: number, w: number, h: number): Item => ({ kind: 'frame', x, y, w, h });

const LOREM = 'Write a few lines here — where you were, who came along, what you will want to remember in twenty years.';

export const PAGE_ADDONS: PageAddon[] = [
  // ---- front matter
  {
    id: 'contents', name: 'Contents', category: 'front', description: 'Chapters and their page numbers — updates itself as the book changes.',
    items: [
      T('heading', 'Contents', 0.1, 0.08, 0.8, 0.09),
      S('line', 0.42, 0.185, 0.16, 0.003),
      // Two columns with identical type, so titles and page numbers line up row for row.
      T('body', '', 0.14, 0.24, 0.56, 0.68, { align: 'left', auto: 'toc', scale: 1.25, lineHeight: 1.9 }),
      T('body', '', 0.72, 0.24, 0.14, 0.68, { align: 'right', auto: 'toc-pages', scale: 1.25, lineHeight: 1.9 }),
    ],
  },
  {
    id: 'title', name: 'Title page', category: 'front', description: 'The book’s title and dates with a fine rule.',
    items: [
      T('title', '{title}', 0.05, 0.34, 0.9, 0.16),
      S('line', 0.44, 0.52, 0.12, 0.003),
      T('subtitle', '{subtitle}', 0.1, 0.55, 0.8, 0.06),
    ],
  },
  {
    id: 'dedication', name: 'Dedication', category: 'front', description: 'A short line for someone, quietly centred.',
    items: [T('quote', 'For everyone who\nmade this trip.', 0.12, 0.38, 0.76, 0.18, { scale: 0.8, italic: true }), S('i-heart', 0.47, 0.6, 0.06, 0.04, { keepAspect: true, tone: 'accent' })],
  },
  {
    id: 'intro', name: 'Introduction', category: 'front', description: 'A heading and a paragraph to open the book.',
    items: [T('label', 'Introduction', 0.1, 0.12, 0.8, 0.04), T('heading', 'Before we begin', 0.1, 0.17, 0.8, 0.1), T('body', LOREM, 0.14, 0.32, 0.72, 0.5, { align: 'left' })],
  },

  // ---- text sections
  {
    id: 'text-section', name: 'Text section', category: 'text', description: 'Heading and body text at the top of the page.',
    items: [T('heading', 'A heading', 0, 0.02, 1, 0.09, { align: 'left' }), S('line', 0, 0.125, 0.18, 0.003), T('body', LOREM, 0, 0.16, 1, 0.5, { align: 'left' })],
  },
  {
    id: 'text-columns', name: 'Two columns', category: 'text', description: 'A heading over two columns of text.',
    items: [
      T('heading', 'A longer story', 0, 0.02, 1, 0.09, { align: 'left' }),
      T('body', LOREM, 0, 0.16, 0.47, 0.78, { align: 'left' }),
      T('body', 'And a second column to keep going — the funny bits, the wrong turns, the meals.', 0.53, 0.16, 0.47, 0.78, { align: 'left' }),
    ],
  },
  {
    id: 'text-photo', name: 'Story + photo', category: 'text', description: 'A short story with an empty frame below — drag a photo onto it.',
    items: [T('heading', 'The day it rained', 0, 0.01, 1, 0.08, { align: 'left' }), T('body', LOREM, 0, 0.11, 1, 0.22, { align: 'left' }), F(0, 0.36, 1, 0.64)],
  },
  {
    id: 'quote', name: 'Quote', category: 'text', description: 'A big quote with an attribution.',
    items: [
      T('quote', '“', 0.1, 0.24, 0.8, 0.14, { scale: 2.6 }),
      T('quote', 'Not all those who wander are lost.', 0.1, 0.38, 0.8, 0.2),
      T('label', '— J. R. R. Tolkien', 0.1, 0.6, 0.8, 0.05),
    ],
  },
  {
    id: 'caption-band', name: 'Caption band', category: 'text', description: 'A slim text band at the foot of a photo page — add it on top of photos.',
    items: [S('rect', -0.02, 0.88, 1.04, 0.12, { tone: 'text' }), T('caption', 'A caption for this page', 0.04, 0.905, 0.92, 0.07, { align: 'left' })],
  },

  // ---- chapters
  {
    id: 'opener', name: 'Chapter opener', category: 'chapter', description: 'Chapter number, title and a rule.',
    items: [T('label', 'Chapter', 0.1, 0.36, 0.8, 0.04), T('heading', 'Chapter title', 0.05, 0.41, 0.9, 0.12), S('line', 0.44, 0.555, 0.12, 0.003), T('subtitle', '', 0.1, 0.58, 0.8, 0.05)],
  },
  {
    id: 'opener-icon', name: 'Opener with icon', category: 'chapter', description: 'A travel icon above the chapter title.',
    items: [S('i-pin', 0.45, 0.28, 0.1, 0.1, { keepAspect: true, tone: 'accent' }), T('heading', 'Chapter title', 0.05, 0.41, 0.9, 0.12), T('subtitle', '', 0.1, 0.55, 0.8, 0.05)],
  },
  {
    id: 'itinerary', name: 'Itinerary', category: 'chapter', description: 'Each chapter with its dates, like a travel plan.',
    items: [T('heading', 'Itinerary', 0.1, 0.08, 0.8, 0.09), S('dots', 0.3, 0.185, 0.4, 0.008), T('body', '{itinerary}', 0.12, 0.24, 0.76, 0.68, { align: 'left' })],
  },

  // ---- back matter
  {
    id: 'notes', name: 'Notes', category: 'back', description: 'Ruled lines for handwritten notes.',
    items: [
      T('heading', 'Notes', 0, 0.02, 1, 0.08, { align: 'left' }),
      ...Array.from({ length: 12 }, (_, i) => S('line', 0, 0.16 + i * 0.068, 1, 0.0015)),
    ],
  },
  {
    id: 'the-end', name: 'The end', category: 'back', description: 'A closing page.',
    items: [T('title', 'The end', 0.1, 0.4, 0.8, 0.13), S('i-heart', 0.47, 0.56, 0.06, 0.04, { keepAspect: true, tone: 'accent' })],
  },
  {
    id: 'colophon', name: 'Colophon', category: 'back', description: 'Small print at the foot of the page: who made it, when.',
    items: [S('line', 0.44, 0.82, 0.12, 0.002), T('caption', 'Photographs and words by us.\nMade with Photobook Studio, {year}.', 0.1, 0.84, 0.8, 0.08)],
  },
];

export const ADDON_CATEGORIES: { id: AddonCategory; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'text', label: 'Text' },
  { id: 'chapter', label: 'Chapters' },
  { id: 'back', label: 'Back' },
];

export function pageAddon(id: string): PageAddon | undefined {
  return PAGE_ADDONS.find((a) => a.id === id);
}

// ---- contents -------------------------------------------------------------------------------------

/** Chapters in reading order with the page they start on. */
export function contentsEntries(doc: BookDocument): { title: string; page: number }[] {
  const n = doc.spreads.length;
  const seen = new Set<string>();
  const out: { title: string; page: number }[] = [];
  doc.spreads.forEach((s, i) => {
    if (!s.chapterId || seen.has(s.chapterId)) return;
    const ch = doc.chapters.find((c) => c.id === s.chapterId);
    if (!ch) return;
    seen.add(s.chapterId);
    // A chapter starts on the spread's left page when it has content there, else on the right.
    const hasLeft = isPrintable(i, 'left', n) && s.elements.some((e) => pageOfElement(e, doc) === 'left');
    const page = pageNumberOf(i, hasLeft ? 'left' : 'right', n) ?? pageNumberOf(i, 'right', n);
    if (page) out.push({ title: ch.title, page });
  });
  return out;
}

const NO_CHAPTERS = 'Chapters appear here — the draft makes one per day, or add them in the spread panel.';

/** Fill in every contents page from the chapters (returns the same document when nothing changed). */
export function refreshContents(doc: BookDocument): BookDocument {
  const hasToc = doc.spreads.some((s) => s.elements.some((e) => e.type === 'text' && e.auto));
  if (!hasToc) return doc;
  const entries = contentsEntries(doc);
  const titles = entries.length ? entries.map((e) => e.title).join('\n') : NO_CHAPTERS;
  const pages = entries.map((e) => String(e.page)).join('\n');
  let changed = false;
  const spreads = doc.spreads.map((s) => {
    let touched = false;
    const elements = s.elements.map((e) => {
      if (e.type !== 'text' || !e.auto) return e;
      const want = e.auto === 'toc' ? titles : pages;
      if (e.text === want) return e;
      touched = true;
      return { ...e, text: want };
    });
    if (!touched) return s;
    changed = true;
    return { ...s, elements };
  });
  return changed ? { ...doc, spreads } : doc;
}

// ---- building pages -------------------------------------------------------------------------------

/** The year in the book's dates (its subtitle), or this year. */
function bookYear(doc: BookDocument): string {
  const m = `${doc.subtitle} ${doc.title}`.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : String(new Date().getFullYear());
}

/** Date range of each chapter's photos, from the frames on its spreads. */
export function chapterDateRanges(doc: BookDocument, assets: Map<string, PhotoAsset>): (chapterId: string) => string {
  const byChapter = new Map<string, PhotoAsset[]>();
  for (const s of doc.spreads) {
    if (!s.chapterId) continue;
    for (const e of s.elements) {
      const a = e.type === 'image' && e.assetId ? assets.get(e.assetId) : undefined;
      if (a) byChapter.set(s.chapterId, [...(byChapter.get(s.chapterId) ?? []), a]);
    }
  }
  return (id) => dateRangeOf(byChapter.get(id) ?? []);
}

/** Chapter list with date ranges, for the itinerary. */
function itinerary(doc: BookDocument, dates: (chapterId: string) => string): string {
  if (!doc.chapters.length) return 'Day 1 — where it began\nDay 2 — the long walk\nDay 3 — home again';
  return doc.chapters.map((c) => `${c.title}${dates(c.id) ? ` — ${dates(c.id)}` : ''}`).join('\n');
}

export interface AddonContext {
  /** Chapter title / subtitle for openers (defaults to placeholders). */
  heading?: string;
  subtitle?: string;
  label?: string;
  /** Date range for each chapter (itinerary). */
  chapterDates?: (chapterId: string) => string;
}

/** The add-on's elements on one page of the book. */
export function addonElements(doc: BookDocument, addon: PageAddon, side: PageSide, ctx: AddonContext = {}): Element[] {
  const c = pageContentRect(side, doc.settings, doc.style);
  const box = (i: { x: number; y: number; w: number; h: number }): Rect => ({ x: c.x + i.x * c.w, y: c.y + i.y * c.h, w: i.w * c.w, h: i.h * c.h });
  const tone = (t: Tone = 'muted') => (t === 'text' ? doc.style.textColor : t === 'accent' ? '#c0574f' : mixColor(doc.style.textColor, doc.style.background, 0.55));
  const fill = (s: string) =>
    s
      .replace(/\{title\}/g, doc.title)
      .replace(/\{subtitle\}/g, doc.subtitle || '')
      .replace(/\{year\}/g, bookYear(doc))
      .replace(/\{itinerary\}/g, itinerary(doc, ctx.chapterDates ?? (() => '')));
  const out: Element[] = [];
  for (const item of addon.items) {
    if (item.kind === 'frame') {
      out.push(makeImageElement(doc, null, box(item)));
      continue;
    }
    if (item.kind === 'shape') {
      let r = box(item);
      const def = shapeDef(item.shape);
      if (item.keepAspect) {
        const w = Math.min(r.w, r.h * def.aspect);
        const h = w / def.aspect;
        r = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
      }
      // Thin rules: at least a hairline.
      if (def.category === 'line' && def.id === 'line') r = { ...r, h: Math.max(0.25, r.h) };
      out.push({ ...makeShapeElement(r, tone(item.tone)), shape: item.shape });
      continue;
    }
    // Openers take the chapter's own words.
    let text = item.text;
    if (addon.category === 'chapter' && item.role === 'heading' && ctx.heading) text = ctx.heading;
    if (addon.category === 'chapter' && item.role === 'subtitle') text = ctx.subtitle ?? text;
    if (addon.category === 'chapter' && item.role === 'label' && ctx.label) text = ctx.label;
    text = fill(text);
    if (!text && !item.auto) continue;
    const r = box(item);
    const el = makeTextElement(doc, item.role, text, r, { align: item.align ?? 'center' });
    const t: TextElement = { ...el, auto: item.auto };
    if (item.scale && item.scale !== 1) {
      t.fontSizePt = Math.round(roleSizePt(doc, item.role) * item.scale * 2) / 2;
      t.styleLinked = false;
    }
    if (item.italic) {
      t.italic = true;
      t.styleLinked = false;
    }
    if (item.lineHeight) {
      t.lineHeight = item.lineHeight;
      t.styleLinked = false;
    }
    // Room for at least one line at this size.
    t.heightMm = Math.max(t.heightMm, t.fontSizePt * MM_PER_PT * t.lineHeight + 1);
    out.push(t);
  }
  return out;
}

const addonLayoutId = (id: string) => `addon:${id}`;

/** The chapter's title, number and dates for an opener placed on this spread. */
function openerContext(doc: BookDocument, spread: Spread, chapterDates?: (id: string) => string): AddonContext {
  const ch = doc.chapters.find((c) => c.id === spread.chapterId);
  if (!ch) return {};
  return { heading: ch.title, label: `Chapter ${doc.chapters.indexOf(ch) + 1}`, subtitle: chapterDates?.(ch.id) || undefined };
}

/**
 * Put an add-on on one page: what was on that page is replaced (locked elements stay), except for
 * the caption band, which goes on top of what is there.
 */
export function applyPageAddon(doc: BookDocument, spreadIndex: number, side: PageSide, addonId: string, ctx: AddonContext = {}): BookDocument {
  const addon = pageAddon(addonId);
  if (!addon) throw new CommandError(`Unknown page design “${addonId}”`);
  const spread = doc.spreads[spreadIndex];
  if (!spread) throw new CommandError('Spread not found');
  if (spread.locked) throw new CommandError('Spread is locked');
  if (!isPrintable(spreadIndex, side, doc.spreads.length)) throw new CommandError('That page is the inside of the cover and is not printed');
  const overlay = addon.id === 'caption-band';
  const context = addon.category === 'chapter' ? { ...openerContext(doc, spread, ctx.chapterDates), ...ctx } : ctx;
  const fresh = addonElements(doc, addon, side, context);
  const next = produce(doc, (d) => {
    const s = d.spreads[spreadIndex];
    const replaced = overlay ? new Set<string>() : new Set(s.elements.filter((e) => pageOfElement(e as Element, doc) === side && !e.locked).map((e) => e.id));
    s.elements = [...s.elements.filter((e) => !replaced.has(e.id)), ...(fresh as Draft<Element>[])];
    if (!overlay) s.layout = { ...(s.layout?.spread ? {} : s.layout), [side]: addonLayoutId(addon.id) };
  });
  return refreshContents(next);
}

/** Insert a new spread after `afterIndex` with add-ons on its pages (left and/or right). */
export function insertAddonSpread(doc: BookDocument, afterIndex: number, pages: { left?: string; right?: string }, ctx: AddonContext = {}): BookDocument {
  const at = Math.min(Math.max(afterIndex + 1, 1), doc.spreads.length - 1);
  const prev = doc.spreads[at - 1];
  let next: BookDocument = { ...doc, spreads: [...doc.spreads.slice(0, at), { ...blankSpread(), chapterId: prev?.chapterId }, ...doc.spreads.slice(at)] };
  if (pages.left) next = applyPageAddon(next, at, 'left', pages.left, ctx);
  if (pages.right) next = applyPageAddon(next, at, 'right', pages.right, ctx);
  return refreshContents(next);
}

