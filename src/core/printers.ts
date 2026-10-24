import type { BindingId, BleedMode, BookDocument, BookSettings, PrinterId } from './model';
import { inchToMm } from './units';

// Printer presets. Every number below is either taken from the printer's published documentation
// (source noted) or explicitly marked as an estimate the user should replace with the value from
// the printer's own calculator/template. Printers revise specs; the printer's generated template
// is always authoritative.
//
// Sources (checked October 2026):
//  Lulu spine table + paperback formula: https://help.api.lulu.com/en/support/solutions/articles/64000254616
//  Lulu bleed, gutter table, spine text rule, trim sizes: https://assets.lulu.com/media/guides/en/lulu-book-creation-guide.pdf
//  Lulu casewrap wrap (printed 0.75 in larger than trim): https://help.lulu.com/en/support/solutions/articles/64000308572
//  Lulu safety margin (0.25 in min): https://help.lulu.com/en/support/solutions/articles/64000255519
//  Blurb interior bleed/safe and PDF-to-Book: https://www.blurb.com/downloads/pdf_to_book/UnderstandTemplates.pdf
//  Blurb spine/cover: only via Blurb's Specification Calculator (not published as a formula).

export interface PrinterSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export type SpineSource = 'table' | 'formula' | 'manual' | 'estimate' | 'none';

export interface BindingSpec {
  id: BindingId;
  name: string;
  /** Bleed + wrap beyond the cover trim on each outer edge. */
  coverWrapMm: number;
  coverWrapVerified: boolean;
  /** Distance inside the cover trim that text and key content should stay within. */
  coverSafeMm: number;
  minPages?: number;
  maxPages?: number;
  /** Spine width in mm for a page count, or null when the printer publishes no rule. */
  spine: (pages: number) => { mm: number; source: Exclude<SpineSource, 'manual' | 'none'> } | null;
}

export interface PrinterPreset {
  id: PrinterId;
  name: string;
  notes: string;
  sizes: PrinterSize[];
  interior: { bleedMm: number; bleedMode: BleedMode; safeMarginMm: number };
  /** Recommended no-go zone either side of the spine for a page count. */
  bindingZoneMm: (pages: number) => number;
  /** Books this short should not have spine text. */
  spineTextMinPages: number;
  bindings: BindingSpec[];
  /** Where the user gets exact cover numbers. */
  coverHelp: string;
}

const inch = inchToMm;

/** Lulu casewrap spine table (inches), from Lulu's published page-count ranges. */
const LULU_CASEWRAP: [maxPages: number, inches: number][] = [
  [84, 0.25], [140, 0.5], [168, 0.625], [194, 0.6875], [222, 0.75], [250, 0.8125], [278, 0.875], [306, 0.9375],
  [334, 1], [360, 1.0625], [388, 1.125], [416, 1.1875], [444, 1.25], [472, 1.3125], [500, 1.375], [528, 1.4375],
  [556, 1.5], [582, 1.5625], [610, 1.625], [638, 1.6875], [666, 1.75], [694, 1.8125], [722, 1.875], [750, 1.9375],
  [778, 2], [800, 2.0625],
];

/** Generic perfect-bound estimate (Lulu's standard-paper formula); used where no rule is published. */
const estimateSpine = (pages: number) => inch(pages / 444 + 0.06);

export const PRINTERS: PrinterPreset[] = [
  {
    id: 'lulu',
    name: 'Lulu',
    notes: 'Bleed on all four sides of every page. Lulu generates an exact cover template after you upload the interior.',
    sizes: [
      { id: 'lulu-sq75', name: 'Small Square 7.5 × 7.5 in', widthMm: inch(7.5), heightMm: inch(7.5) },
      { id: 'lulu-sq85', name: 'Square 8.5 × 8.5 in', widthMm: inch(8.5), heightMm: inch(8.5) },
      { id: 'lulu-land', name: 'US Letter Landscape 11 × 8.5 in', widthMm: inch(11), heightMm: inch(8.5) },
      { id: 'lulu-port', name: 'US Letter 8.5 × 11 in', widthMm: inch(8.5), heightMm: inch(11) },
      { id: 'lulu-a4l', name: 'A4 Landscape', widthMm: 297, heightMm: 210 },
      { id: 'lulu-a4p', name: 'A4', widthMm: 210, heightMm: 297 },
    ],
    interior: { bleedMm: inch(0.125), bleedMode: 'all', safeMarginMm: inch(0.25) },
    // Lulu's recommended total inside margin by page count.
    bindingZoneMm: (p) => (p <= 60 ? inch(0.5) : p <= 150 ? inch(0.625) : p <= 400 ? inch(1) : p <= 600 ? inch(1.125) : inch(1.25)),
    spineTextMinPages: 81,
    bindings: [
      {
        id: 'hardcover', name: 'Hardcover casewrap', coverWrapMm: inch(0.75), coverWrapVerified: true, coverSafeMm: inch(0.75),
        minPages: 24, maxPages: 800,
        spine: (p) => {
          if (p < 24) return null;
          const row = LULU_CASEWRAP.find(([max]) => p <= max) ?? LULU_CASEWRAP[LULU_CASEWRAP.length - 1];
          return { mm: inch(row[1]), source: 'table' };
        },
      },
      {
        id: 'softcover', name: 'Paperback (perfect bound)', coverWrapMm: inch(0.125), coverWrapVerified: true, coverSafeMm: inch(0.25),
        spine: (p) => ({ mm: inch(p / 444 + 0.06), source: 'formula' }),
      },
    ],
    coverHelp: 'Lulu shows exact cover dimensions in the cover template it generates after you upload your interior PDF.',
  },
  {
    id: 'blurb',
    name: 'Blurb (PDF to Book)',
    notes: 'Bleed on the top, bottom and outside edges only — none at the spine. Spine width comes from Blurb’s Specification Calculator.',
    sizes: [
      { id: 'blurb-sq7', name: 'Small Square 7 × 7 in', widthMm: inch(7), heightMm: inch(7) },
      { id: 'blurb-port', name: 'Standard Portrait 8 × 10 in', widthMm: inch(8), heightMm: inch(10) },
      { id: 'blurb-land', name: 'Standard Landscape 10 × 8 in', widthMm: inch(10), heightMm: inch(8) },
      { id: 'blurb-sq12', name: 'Large Square 12 × 12 in', widthMm: inch(12), heightMm: inch(12) },
      { id: 'blurb-lland', name: 'Large Landscape 13 × 11 in', widthMm: inch(13), heightMm: inch(11) },
    ],
    interior: { bleedMm: inch(0.125), bleedMode: 'outer', safeMarginMm: inch(0.25) },
    bindingZoneMm: () => inch(0.5),
    spineTextMinPages: 81,
    bindings: [
      // Blurb does not publish ImageWrap wrap or spine values; these are starting estimates only.
      { id: 'hardcover', name: 'Hardcover ImageWrap', coverWrapMm: inch(0.75), coverWrapVerified: false, coverSafeMm: inch(0.5), minPages: 24, maxPages: 480, spine: (p) => ({ mm: estimateSpine(p), source: 'estimate' }) },
      { id: 'softcover', name: 'Softcover', coverWrapMm: inch(0.125), coverWrapVerified: false, coverSafeMm: inch(0.25), minPages: 24, maxPages: 480, spine: (p) => ({ mm: estimateSpine(p), source: 'estimate' }) },
    ],
    coverHelp: 'Use Blurb’s Specification Calculator (or the cover template from your Blurb dashboard) for the exact spine width and cover size, and enter them here.',
  },
  {
    id: 'custom',
    name: 'Custom / other printer',
    notes: 'Enter your printer’s numbers. The spine starts as an estimate.',
    sizes: [],
    interior: { bleedMm: inch(0.125), bleedMode: 'all', safeMarginMm: inch(0.25) },
    bindingZoneMm: () => 10,
    spineTextMinPages: 81,
    bindings: [
      { id: 'hardcover', name: 'Hardcover', coverWrapMm: inch(0.75), coverWrapVerified: false, coverSafeMm: inch(0.5), spine: (p) => ({ mm: estimateSpine(p), source: 'estimate' }) },
      { id: 'softcover', name: 'Softcover', coverWrapMm: inch(0.125), coverWrapVerified: false, coverSafeMm: inch(0.25), spine: (p) => ({ mm: estimateSpine(p), source: 'estimate' }) },
    ],
    coverHelp: 'Your printer’s cover template or calculator gives the spine width and wrap.',
  },
];

export function printer(id: string | undefined): PrinterPreset {
  return PRINTERS.find((p) => p.id === id) ?? PRINTERS[PRINTERS.length - 1];
}

export function binding(s: Pick<BookSettings, 'printerId' | 'bindingId'>): BindingSpec {
  const p = printer(s.printerId);
  return p.bindings.find((b) => b.id === s.bindingId) ?? p.bindings[0];
}

export const pageCountOf = (doc: Pick<BookDocument, 'spreads'>) => Math.max(0, doc.spreads.length * 2 - 2);

export interface SpineInfo {
  mm: number;
  source: SpineSource;
}

export function spineWidth(doc: Pick<BookDocument, 'settings' | 'spreads'>): SpineInfo {
  const manual = doc.settings.coverOverrides?.spineMm;
  if (manual != null && manual >= 0) return { mm: manual, source: 'manual' };
  const r = binding(doc.settings).spine(pageCountOf(doc));
  return r ?? { mm: 0, source: 'none' };
}

/** Values a preset applies to a book (size kept if the printer offers it, else its first size). */
export function presetSettings(current: BookSettings, printerId: PrinterId, bindingId: BindingId, sizeId?: string, pages = 20): Partial<BookSettings> {
  const p = printer(printerId);
  const size = p.sizes.find((s) => s.id === sizeId) ??
    p.sizes.find((s) => Math.abs(s.widthMm - current.trimWidthMm) < 0.5 && Math.abs(s.heightMm - current.trimHeightMm) < 0.5) ??
    p.sizes[0];
  return {
    printerId,
    bindingId,
    ...(size ? { trimWidthMm: size.widthMm, trimHeightMm: size.heightMm } : {}),
    bleedMm: p.interior.bleedMm,
    bleedMode: p.interior.bleedMode,
    safeMarginMm: p.interior.safeMarginMm,
    bindingZoneMm: p.bindingZoneMm(pages),
    coverOverrides: { spineMm: null, wrapMm: null, panelWidthMm: null, panelHeightMm: null },
  };
}

/** Matching printer size for the current trim, if any. */
export function currentPrinterSize(s: BookSettings): PrinterSize | undefined {
  return printer(s.printerId).sizes.find((z) => Math.abs(z.widthMm - s.trimWidthMm) < 0.5 && Math.abs(z.heightMm - s.trimHeightMm) < 0.5);
}
