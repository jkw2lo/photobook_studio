import type { BookDocument, CollageSettings, Element, ImageElement, PhotoAsset, Rect } from './model';
import { SCHEMA_VERSION } from './model';
import { blankSpread, defaultSettings } from './book';
import { layoutCollage, titleBand, type CollageStyle } from './collage';
import { aspectOf, chronological, dateRangeOf } from './curation';
import { curatePool, selectWithCoverage } from './generator';
import { coverDpi } from './layout';
import { newId } from './random';
import { styleFromPreset } from './styles';
import { inchToMm } from './units';

// Posters: a single printed sheet filled with a collage. Same document model as a book (one
// surface in `spreads[0]`), so the editor, preflight and export work unchanged.

export interface PosterSize {
  id: string;
  name: string;
  /** Portrait dimensions; landscape swaps them. */
  widthMm: number;
  heightMm: number;
}

export const POSTER_SIZES: PosterSize[] = [
  { id: 'p11x14', name: '11 × 14 in', widthMm: inchToMm(11), heightMm: inchToMm(14) },
  { id: 'p12x18', name: '12 × 18 in', widthMm: inchToMm(12), heightMm: inchToMm(18) },
  { id: 'p16x20', name: '16 × 20 in', widthMm: inchToMm(16), heightMm: inchToMm(20) },
  { id: 'p18x24', name: '18 × 24 in', widthMm: inchToMm(18), heightMm: inchToMm(24) },
  { id: 'p24x36', name: '24 × 36 in', widthMm: inchToMm(24), heightMm: inchToMm(36) },
  { id: 'pA3', name: 'A3 (29.7 × 42 cm)', widthMm: 297, heightMm: 420 },
  { id: 'pA2', name: 'A2 (42 × 59.4 cm)', widthMm: 420, heightMm: 594 },
  { id: 'pA1', name: 'A1 (59.4 × 84.1 cm)', widthMm: 594, heightMm: 841 },
  { id: 'p50x70', name: '50 × 70 cm', widthMm: 500, heightMm: 700 },
];

export function posterSize(id: string): PosterSize | undefined {
  return POSTER_SIZES.find((s) => s.id === id);
}

export const DEFAULT_COLLAGE: CollageSettings = { style: 'mosaic', photoCount: 40, gapMm: 3, marginMm: 15, titlePosition: 'none', seed: 1 };

export function createPoster(opts: { title: string; sizeId: string; landscape?: boolean }): BookDocument {
  const size = posterSize(opts.sizeId);
  if (!size) throw new Error(`Unknown poster size “${opts.sizeId}”.`);
  const [w, h] = opts.landscape ? [size.heightMm, size.widthMm] : [size.widthMm, size.heightMm];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    title: opts.title,
    subtitle: '',
    settings: {
      ...defaultSettings(),
      product: 'poster',
      trimWidthMm: w,
      trimHeightMm: h,
      bindingZoneMm: 0,
      // Posters are seen from further away than book pages: 150 DPI prints well.
      minDpiWarning: 150,
      minDpiError: 100,
    },
    style: { ...styleFromPreset('minimalist'), background: '#ffffff' },
    chapters: [],
    spreads: [blankSpread()],
    collage: { ...DEFAULT_COLLAGE },
  };
}

export const isPoster = (doc: Pick<BookDocument, 'settings'>) => doc.settings.product === 'poster';

/** Where photos go: inside the margin, or out to the bleed for edge-to-edge collages. */
export function posterPhotoBox(doc: BookDocument, marginMm: number): Rect {
  const s = doc.settings;
  if (marginMm <= 0) return { x: -s.bleedMm, y: -s.bleedMm, w: s.trimWidthMm + 2 * s.bleedMm, h: s.trimHeightMm + 2 * s.bleedMm };
  const m = Math.max(marginMm, s.safeMarginMm);
  return { x: m, y: m, w: s.trimWidthMm - 2 * m, h: s.trimHeightMm - 2 * m };
}

export interface PosterReport {
  available: number;
  placed: number;
  nearDuplicatesSet: number;
  exactDuplicates: number;
  excluded: number;
  notes: string[];
}

/**
 * Choose the featured photo for the hero style: it is printed far larger than the rest, so it must
 * hold up at that size. Prefers photos that reach the poster's DPI threshold at hero size, then
 * quality (when scores are known), then landscape shapes.
 */
export function pickHero(doc: BookDocument, photos: PhotoAsset[], marginMm: number, score?: (a: PhotoAsset) => number): PhotoAsset | undefined {
  if (!photos.length) return undefined;
  const box = posterPhotoBox(doc, marginMm);
  const warn = doc.settings.minDpiWarning;
  const rank = (p: PhotoAsset) => {
    const a = aspectOf(p);
    const rect = box.h >= box.w ? { w: box.w, h: Math.min(Math.max(box.w / a, box.h * 0.32), box.h * 0.55) } : { w: Math.min(Math.max(box.h * a, box.w * 0.35), box.w * 0.58), h: box.h };
    const dpi = coverDpi(rect, p);
    return 3 * Math.min(1, dpi / warn) + (score ? score(p) : 0) + (a >= 1.2 ? 0.3 : 0);
  };
  return [...photos].sort((x, y) => rank(y) - rank(x))[0];
}

/** Lay out the sheet with the given photos (in the order given). */
export function layoutPoster(doc: BookDocument, photos: PhotoAsset[], settings: CollageSettings, heroPick?: PhotoAsset): { elements: Element[]; used: PhotoAsset[] } {
  const s = doc.settings;
  const safe: Rect = { x: s.safeMarginMm, y: s.safeMarginMm, w: s.trimWidthMm - 2 * s.safeMarginMm, h: s.trimHeightMm - 2 * s.safeMarginMm };
  const range = dateRangeOf(photos);
  const { elements: titleEls, rest } = titleBand(doc, posterPhotoBox(doc, settings.marginMm), safe, settings.titlePosition, doc.title, doc.subtitle || range, settings.gapMm);
  const { elements, used } = layoutCollage(doc, rest, photos, { style: settings.style as CollageStyle, gapMm: settings.gapMm, seed: settings.seed, hero: heroPick });
  return { elements: [...elements, ...titleEls], used };
}

/** Automatic poster: curate, pick `photoCount` photos for coverage and quality, lay out. */
export function generatePoster(doc: BookDocument, assets: PhotoAsset[], settings: CollageSettings): { doc: BookDocument; report: PosterReport } {
  const { reps, alternates, scores, excluded, exactDuplicates } = curatePool(assets);
  const score = (a: PhotoAsset) => scores.get(a.id)?.total ?? 0;
  const notes: string[] = [];
  let candidates = reps;
  if (candidates.length < settings.photoCount && alternates.length) {
    const extra = alternates.slice(0, settings.photoCount - candidates.length);
    notes.push(`Used ${extra.length} similar shot${extra.length > 1 ? 's' : ''} to reach ${settings.photoCount} photos.`);
    candidates = [...candidates, ...extra];
  }
  const count = Math.min(settings.photoCount, candidates.length);
  if (count < settings.photoCount) notes.push(`Only ${count} usable photos — the collage uses all of them.`);
  let chosen = chronological(selectWithCoverage(candidates, count, scores));
  // The hero is printed much larger than the rest: choose it from every candidate, not just the
  // selection, and swap it in for the weakest non-favourite if needed.
  let heroPick = pickHero(doc, chosen, settings.marginMm, score);
  if (settings.style === 'hero') {
    const best = pickHero(doc, candidates, settings.marginMm, score);
    if (best && !chosen.includes(best)) {
      const weakest = [...chosen].filter((a) => !a.favorite).sort((a, b) => score(a) - score(b))[0];
      chosen = chronological([...chosen.filter((a) => a !== weakest), best]);
    }
    heroPick = best ?? heroPick;
  }
  const { elements, used } = layoutPoster(doc, chosen, settings, heroPick);
  if (used.length < chosen.length) notes.push(`The grid uses ${used.length} of ${chosen.length} photos to keep every row complete.`);
  const sheet = doc.spreads[0];
  const next: BookDocument = {
    ...doc,
    collage: settings,
    spreads: [{ ...sheet, locked: false, layout: { spread: `collage-${settings.style}` }, provenance: { generatedAt: new Date().toISOString(), seed: settings.seed, assetIds: used.map((a) => a.id) }, elements }],
  };
  return {
    doc: next,
    report: { available: candidates.length, placed: used.length, nearDuplicatesSet: alternates.length, exactDuplicates, excluded, notes },
  };
}

/** Change style, spacing or margins but keep the photos currently on the sheet. */
export function relayoutPoster(doc: BookDocument, assets: Map<string, PhotoAsset>, settings: CollageSettings): BookDocument {
  const sheet = doc.spreads[0];
  const current = sheet.elements
    .filter((e): e is ImageElement => e.type === 'image' && !!e.assetId)
    .map((e) => assets.get(e.assetId!))
    .filter((a): a is PhotoAsset => !!a);
  // Original order (chronological) rather than the shuffled pinboard order.
  const photos = chronological([...new Set(current)]);
  const { elements } = layoutPoster(doc, photos, settings, pickHero(doc, photos, settings.marginMm));
  return { ...doc, collage: settings, spreads: [{ ...sheet, layout: { spread: `collage-${settings.style}` }, elements }] };
}
