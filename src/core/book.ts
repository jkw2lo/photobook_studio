import type { BindingId, BookDocument, BookSettings, BookStyle, PrinterId, Rect, Spread } from './model';
import { PRINTERS, presetSettings, printer } from './printers';
import { SCHEMA_VERSION } from './model';
import { newId } from './random';
import { styleFromPreset } from './styles';
import { inchToMm } from './units';

export type PageSide = 'left' | 'right';

export interface SizePreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'sq8', name: '8 × 8 in square', widthMm: inchToMm(8), heightMm: inchToMm(8) },
  { id: 'sq12', name: '12 × 12 in square', widthMm: inchToMm(12), heightMm: inchToMm(12) },
  { id: 'land10x8', name: '10 × 8 in landscape', widthMm: inchToMm(10), heightMm: inchToMm(8) },
  { id: 'port8x10', name: '8 × 10 in portrait', widthMm: inchToMm(8), heightMm: inchToMm(10) },
  { id: 'a4p', name: 'A4 portrait', widthMm: 210, heightMm: 297 },
  { id: 'a4l', name: 'A4 landscape', widthMm: 297, heightMm: 210 },
  { id: 'sq21', name: '21 × 21 cm square', widthMm: 210, heightMm: 210 },
];

export class UnknownSizeError extends Error {}

/** Look a size id up among the generic sizes and every printer's sizes. */
export function findSize(sizeId: string): { widthMm: number; heightMm: number } | undefined {
  return SIZE_PRESETS.find((s) => s.id === sizeId) ?? PRINTERS.flatMap((p) => p.sizes).find((s) => s.id === sizeId);
}

/** Defaults for a size. An unknown size id is an error — never a silent fallback to another size. */
export function defaultSettings(sizeId?: string): BookSettings {
  const size = sizeId === undefined ? SIZE_PRESETS[0] : findSize(sizeId);
  if (!size) throw new UnknownSizeError(`Unknown page size “${sizeId}”.`);
  return {
    trimWidthMm: size.widthMm,
    trimHeightMm: size.heightMm,
    bleedMm: 3.175, // 0.125 in — the common consumer photobook bleed
    safeMarginMm: 6.35, // 0.25 in
    bindingZoneMm: 10,
    pageNumbers: false,
    minDpiWarning: 200,
    minDpiError: 150,
    printerId: 'custom',
    bindingId: 'hardcover',
    bleedMode: 'all',
    coverOverrides: { spineMm: null, wrapMm: null, panelWidthMm: null, panelHeightMm: null },
    product: 'book',
  };
}

/** Printable pages for N spreads: the inside front and back covers are not printed. */
export const pagesForSpreadCount = (n: number) => Math.max(0, 2 * n - 2);
export const spreadsForPageCount = (pages: number) => evenPageCount(pages) / 2 + 1;
export const evenPageCount = (pages: number) => Math.max(2, Math.ceil(pages / 2) * 2);

export function isPrintable(spreadIndex: number, side: PageSide, spreadCount: number): boolean {
  if (spreadIndex === 0 && side === 'left') return false;
  if (spreadIndex === spreadCount - 1 && side === 'right') return false;
  return true;
}

/** 1-based printed page number, or null for an inside cover. */
export function pageNumberOf(spreadIndex: number, side: PageSide, spreadCount: number): number | null {
  if (!isPrintable(spreadIndex, side, spreadCount)) return null;
  return spreadIndex * 2 + (side === 'left' ? 0 : 1);
}

export interface PrintablePage {
  pageNumber: number;
  spreadIndex: number;
  side: PageSide;
}

export function printablePages(doc: BookDocument): PrintablePage[] {
  const n = doc.spreads.length;
  const pages: PrintablePage[] = [];
  for (let s = 0; s < n; s++) {
    for (const side of ['left', 'right'] as const) {
      const pageNumber = pageNumberOf(s, side, n);
      if (pageNumber !== null) pages.push({ pageNumber, spreadIndex: s, side });
    }
  }
  return pages;
}

export const spreadWidth = (s: BookSettings) => s.trimWidthMm * 2;

/** Trim box of one page, in spread coordinates. */
export function pageTrimRect(side: PageSide, s: BookSettings): Rect {
  return { x: side === 'left' ? 0 : s.trimWidthMm, y: 0, w: s.trimWidthMm, h: s.trimHeightMm };
}

/**
 * Area a "full-bleed" element on this page should cover: out to the bleed on the three outer edges,
 * exactly to the spine on the fourth (so it never spills onto the facing page).
 */
export function pageBleedRect(side: PageSide, s: BookSettings): Rect {
  const b = s.bleedMm;
  return side === 'left'
    ? { x: -b, y: -b, w: s.trimWidthMm + b, h: s.trimHeightMm + 2 * b }
    : { x: s.trimWidthMm, y: -b, w: s.trimWidthMm + b, h: s.trimHeightMm + 2 * b };
}

export function spreadBleedRect(s: BookSettings): Rect {
  const b = s.bleedMm;
  return { x: -b, y: -b, w: spreadWidth(s) + 2 * b, h: s.trimHeightMm + 2 * b };
}

/** Page area inside the style margins. Inner margin is on the spine side. */
export function pageContentRect(side: PageSide, s: BookSettings, st: BookStyle): Rect {
  const w = s.trimWidthMm - st.marginInnerMm - st.marginOuterMm;
  const h = s.trimHeightMm - st.marginTopMm - st.marginBottomMm;
  const x = side === 'left' ? st.marginOuterMm : s.trimWidthMm + st.marginInnerMm;
  return { x, y: st.marginTopMm, w, h };
}

export function pageSafeRect(side: PageSide, s: BookSettings): Rect {
  const t = pageTrimRect(side, s);
  const m = s.safeMarginMm;
  return { x: t.x + m, y: t.y + m, w: t.w - 2 * m, h: t.h - 2 * m };
}

/** Which page an element mostly sits on, judged by its centre. */
export function sideOfX(xCenterMm: number, s: BookSettings): PageSide {
  return xCenterMm < s.trimWidthMm ? 'left' : 'right';
}

export function blankSpread(): Spread {
  return { id: newId(), locked: false, elements: [] };
}

export function createBook(opts: {
  title: string;
  sizeId?: string;
  stylePresetId?: string;
  pages?: number;
  printerId?: PrinterId;
  bindingId?: BindingId;
}): BookDocument {
  const pages = evenPageCount(opts.pages ?? 20);
  const spreads = spreadsForPageCount(pages);
  const base = defaultSettings(opts.sizeId);
  if (opts.printerId && opts.printerId !== 'custom' && opts.sizeId) {
    const offered = printer(opts.printerId).sizes;
    const ok = offered.some((z) => z.id === opts.sizeId || (Math.abs(z.widthMm - base.trimWidthMm) < 0.5 && Math.abs(z.heightMm - base.trimHeightMm) < 0.5));
    if (!ok) throw new UnknownSizeError(`${printer(opts.printerId).name} doesn’t offer that page size.`);
  }
  const settings = opts.printerId && opts.printerId !== 'custom'
    ? { ...base, ...presetSettings(base, opts.printerId, opts.bindingId ?? 'hardcover', opts.sizeId, pages) }
    : { ...base, bindingId: opts.bindingId ?? base.bindingId };
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title: opts.title,
    subtitle: '',
    settings,
    style: styleFromPreset(opts.stylePresetId ?? 'editorial'),
    chapters: [],
    spreads: Array.from({ length: spreads }, blankSpread),
  };
}

/** Where the printed page number sits: bottom outer corner, inside the safe area. */
export function pageNumberRect(side: PageSide, s: BookSettings): Rect {
  const w = 20;
  const h = 6;
  const t = pageTrimRect(side, s);
  const y = t.h - s.safeMarginMm - h + 2;
  return side === 'left' ? { x: t.x + s.safeMarginMm, y, w, h } : { x: t.x + t.w - s.safeMarginMm - w, y, w, h };
}
