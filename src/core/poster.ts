import type { BookDocument, CollageSettings, CollageSource, Element, ImageElement, PhotoAsset, Rect } from './model';
import { SCHEMA_VERSION } from './model';
import { blankSpread, defaultSettings } from './book';
import { layoutCollageAround, orderPhotos, titleBand, type CollageStyle } from './collage';
import { aspectOf, chronological, dateRangeOf } from './curation';
import { curatePool, selectWithCoverage, type CuratedPool } from './generator';
import { mulberry32 } from './random';
import { coverDpi } from './layout';
import { elementBounds } from './geometry';
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

/**
 * The box photos are laid out in: a template's area (fractions of the sheet; edges at 0 or 1 run
 * into the bleed), or the sheet inside the margin.
 */
export function photoArea(doc: BookDocument, settings: CollageSettings): Rect {
  const a = settings.area;
  if (!a) return posterPhotoBox(doc, settings.marginMm);
  const s = doc.settings;
  const b = s.bleedMm;
  const W = s.trimWidthMm;
  const H = s.trimHeightMm;
  const x0 = a.x <= 0 ? -b : a.x * W;
  const y0 = a.y <= 0 ? -b : a.y * H;
  const x1 = a.x + a.w >= 1 ? W + b : (a.x + a.w) * W;
  const y1 = a.y + a.h >= 1 ? H + b : (a.y + a.h) * H;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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
 * Photos that can be featured in the hero style, best first. The hero is printed far larger than
 * the rest, so it must reach (close to) the poster's DPI threshold at hero size; among those, the
 * weakest quarter is left out. Ranked by sharpness at size, then score, then landscape shape.
 */
export function heroCandidates(doc: BookDocument, photos: PhotoAsset[], marginMm: number, score?: (a: PhotoAsset) => number): PhotoAsset[] {
  if (!photos.length) return [];
  const box = posterPhotoBox(doc, marginMm);
  const warn = doc.settings.minDpiWarning;
  const rated = photos.map((p) => {
    const a = aspectOf(p);
    const rect = box.h >= box.w ? { w: box.w, h: Math.min(Math.max(box.w / a, box.h * 0.32), box.h * 0.55) } : { w: Math.min(Math.max(box.h * a, box.w * 0.35), box.w * 0.58), h: box.h };
    const sharp = Math.min(1, coverDpi(rect, p) / warn);
    const sc = score ? score(p) : 0;
    return { p, sharp, sc, r: 3 * sharp + sc + (a >= 1.2 ? 0.3 : 0) };
  }).sort((x, y) => y.r - x.r);
  const scores = rated.map((x) => x.sc).sort((a, b) => a - b);
  const floor = score ? scores[Math.floor(scores.length * 0.25)] : -Infinity;
  const eligible = rated.filter((x) => x.sharp >= 0.85 && x.sc >= floor);
  return (eligible.length >= Math.min(3, rated.length) ? eligible : rated.slice(0, 8)).map((x) => x.p);
}

/**
 * Choose the featured photo for the hero style. Without `vary`, the best candidate. With it
 * (shuffles), seeds step through every candidate in a fixed scrambled order, so repeated shuffles
 * show each strong photo once before any repeats — and never the hero currently on the sheet.
 */
export function pickHero(
  doc: BookDocument,
  photos: PhotoAsset[],
  marginMm: number,
  score?: (a: PhotoAsset) => number,
  vary?: { seed: number; avoidId?: string | null },
): PhotoAsset | undefined {
  const list = heroCandidates(doc, photos, marginMm, score);
  if (!list.length) return undefined;
  if (!vary) return list[0];
  const cycle = [...list].sort((a, b) => hashId(a.id) - hashId(b.id) || a.id.localeCompare(b.id));
  const n = cycle.length;
  const at = (((vary.seed - 2) % n) + n) % n;
  const pick = cycle[at];
  return pick.id === vary.avoidId && n > 1 ? cycle[(at + 1) % n] : pick;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const sheetImages = (doc: BookDocument) => doc.spreads[0]?.elements.filter((e): e is ImageElement => e.type === 'image') ?? [];

/** Photos whose crop or tilt the user asked to keep: they always stay on the sheet. */
const isKept = (e: ImageElement) => !!(e.keepCrop || e.keepRotation);

/** Pinned (or locked) frames stay exactly where they are; layouts flow around them. */
export const isPinned = (e: Element) => e.type === 'image' && (!!e.pinned || e.locked);

/** The featured photo currently on a hero-style sheet (its largest frame that isn't pinned). */
function currentHeroId(doc: BookDocument): string | null {
  const imgs = sheetImages(doc).filter((e) => e.assetId && !isPinned(e));
  const biggest = imgs.sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm)[0];
  return biggest?.assetId ?? null;
}

/** Lay out the sheet with the given photos (in the order given), around any pinned photos. */
export function layoutPoster(
  doc: BookDocument,
  photos: PhotoAsset[],
  settings: CollageSettings,
  heroPick?: PhotoAsset,
): { elements: Element[]; used: PhotoAsset[]; generatedIds: string[] } {
  const s = doc.settings;
  const safe: Rect = { x: s.safeMarginMm, y: s.safeMarginMm, w: s.trimWidthMm - 2 * s.safeMarginMm, h: s.trimHeightMm - 2 * s.safeMarginMm };
  const range = dateRangeOf(photos);
  // Keep wording the user typed into the previous title band.
  const prev = previousTitleText(doc);
  const { elements: titleEls, rest } = titleBand(doc, photoArea(doc, settings), safe, settings.titlePosition, prev.title ?? doc.title, prev.subtitle ?? (doc.subtitle || range), settings.gapMm);
  const pinned = sheetImages(doc).filter(isPinned);
  const pinnedIds = new Set(pinned.map((e) => e.assetId));
  const free = photos.filter((p) => !pinnedIds.has(p.id));
  const { elements, used } = layoutCollageAround(
    doc, rest, free,
    { style: settings.style as CollageStyle, gapMm: settings.gapMm, seed: settings.seed, hero: heroPick, keepOrder: (settings.order ?? 'time') !== 'time' },
    pinned.map(elementBounds),
  );
  // Photos marked "keep crop" get their crop, fit, border and cut-out shape back in the new frame;
  // "keep rotation" keeps their tilt. Either way they keep their identity.
  const kept = new Map(sheetImages(doc).filter((e) => isKept(e) && !isPinned(e) && e.assetId).map((e) => [e.assetId!, e]));
  // A photo's own colour adjustments follow the photo into its new frame.
  const adjusted = new Map(sheetImages(doc).filter((e) => e.adjust && e.assetId).map((e) => [e.assetId!, e.adjust!]));
  const restored = elements.map((e) => {
    if (e.type !== 'image') return e;
    // Collage-wide photo shape (circles, hearts…) unless the photo keeps its own look.
    const base: ImageElement = e.assetId && adjusted.has(e.assetId) ? { ...e, adjust: adjusted.get(e.assetId) } : e;
    const shaped: ImageElement = settings.frameShape ? { ...base, mask: { kind: 'shape', shape: settings.frameShape }, borderMm: 0 } : base;
    const k = e.assetId ? kept.get(e.assetId) : undefined;
    if (!k) return shaped;
    kept.delete(e.assetId!);
    return {
      ...shaped,
      id: k.id,
      ...(k.keepCrop ? { crop: k.crop, fit: k.fit, borderMm: k.borderMm, borderColor: k.borderColor, mask: k.mask, keepCrop: true } : {}),
      ...(k.keepRotation ? { rotationDeg: k.rotationDeg, keepRotation: true } : {}),
    };
  });
  return { elements: [...restored, ...titleEls], used, generatedIds: titleEls.map((e) => e.id) };
}

/** Text and shapes the user added, and pinned photos: kept through every regenerate and re-flow. */
function userElements(doc: BookDocument): Element[] {
  const sheet = doc.spreads[0];
  const generated = new Set(sheet?.provenance?.generatedIds ?? []);
  return (sheet?.elements ?? []).filter((e) => (e.type === 'image' ? isPinned(e) : !generated.has(e.id)));
}

function previousTitleText(doc: BookDocument): { title?: string; subtitle?: string } {
  const sheet = doc.spreads[0];
  const generated = new Set(sheet?.provenance?.generatedIds ?? []);
  const out: { title?: string; subtitle?: string } = {};
  for (const e of sheet?.elements ?? []) {
    if (e.type !== 'text' || !generated.has(e.id)) continue;
    if (e.role === 'title') out.title = e.text;
    if (e.role === 'subtitle') out.subtitle = e.text;
  }
  return out;
}

function sheetWith(doc: BookDocument, settings: CollageSettings, laid: { elements: Element[]; used: PhotoAsset[]; generatedIds: string[] }): BookDocument {
  const sheet = doc.spreads[0];
  // Keep the user's layering: elements marked "behind" (or sent below the photos) stay under them.
  const firstPhoto = sheet.elements.findIndex((e) => e.type === 'image' && !isPinned(e));
  const user = userElements(doc);
  const below = (e: Element) => e.behind || (firstPhoto >= 0 && sheet.elements.indexOf(e) < firstPhoto);
  return {
    ...doc,
    collage: settings,
    spreads: [{
      ...sheet,
      locked: false,
      layout: { spread: `collage-${settings.style}` },
      provenance: { generatedAt: new Date().toISOString(), seed: settings.seed, assetIds: [...laid.used.map((a) => a.id), ...sheetImages(doc).filter(isPinned).flatMap((e) => (e.assetId ? [e.assetId] : []))], generatedIds: laid.generatedIds },
      elements: [...user.filter(below), ...laid.elements, ...user.filter((e) => !below(e))],
    }],
  };
}

/** Automatic poster: curate, pick photos for coverage and quality, lay out around pinned photos. */
export function generatePoster(
  doc: BookDocument,
  assets: PhotoAsset[],
  settings: CollageSettings,
  /** Pass a precomputed pool when regenerating repeatedly (e.g. while dragging the photo count). */
  curated: CuratedPool = curatePool(assets),
): { doc: BookDocument; report: PosterReport } {
  const { reps, alternates, excluded, exactDuplicates } = curated;
  const source: CollageSource = settings.source ?? 'best';
  // Seed 1 picks the strongest photos; other seeds nudge scores so "Shuffle photos" brings in a
  // different — still good — selection. Favourites are always kept regardless.
  const rng = mulberry32(settings.seed * 7919);
  const scores = new Map([...curated.scores].map(([id, sc]) => [id, settings.seed === 1 ? sc : { ...sc, total: sc.total + (rng() - 0.5) * 0.4 }]));
  const score = (a: PhotoAsset) => scores.get(a.id)?.total ?? 0;
  const baseScore = (a: PhotoAsset) => curated.scores.get(a.id)?.total ?? 0;
  const notes: string[] = [];
  // Pinned photos stay put and count towards the total; "keep crop" photos always stay in.
  const sheet = sheetImages(doc);
  const pinnedIds = new Set(sheet.filter(isPinned).flatMap((e) => (e.assetId ? [e.assetId] : [])));
  const keepIds = new Set(sheet.filter((e) => isKept(e) && !isPinned(e)).flatMap((e) => (e.assetId ? [e.assetId] : [])));
  // The background photo is already on the sheet, behind everything: don't repeat it in the collage.
  const bgId = doc.spreads[0]?.backgroundImage?.assetId;
  const usable = (list: PhotoAsset[]) => list.filter((a) => !pinnedIds.has(a.id) && a.id !== bgId);
  const allCount = Math.min(300, reps.length + alternates.length);
  const want = Math.max(0, (source === 'all' ? allCount : settings.photoCount) - pinnedIds.size);
  let candidates = usable(reps);
  if (candidates.length < want && alternates.length) {
    const extra = usable(alternates).slice(0, want - candidates.length);
    if (source !== 'all') notes.push(`Used ${extra.length} similar shot${extra.length > 1 ? 's' : ''} to reach ${settings.photoCount} photos.`);
    candidates = [...candidates, ...extra];
  }
  const count = Math.min(want, candidates.length);
  if (source !== 'all' && count < want) notes.push(`Only ${count + pinnedIds.size} usable photos — the collage uses all of them.`);
  const keep = candidates.filter((a) => keepIds.has(a.id)).slice(0, count);
  const pickFrom = candidates.filter((a) => !keepIds.has(a.id));
  let chosen = chronological([...keep, ...selectWithCoverage(pickFrom, count - keep.length, scores)]);
  // The hero is printed much larger than the rest: choose it from every candidate, not just the
  // selection, and swap it in for the weakest non-favourite if needed.
  let heroPick = pickHero(doc, chosen, settings.marginMm, score);
  if (settings.style === 'hero' && chosen.length) {
    // Shuffles step through all the strong candidates instead of featuring the same few photos.
    const vary = settings.seed === 1 ? undefined : { seed: settings.seed, avoidId: doc.collage?.style === 'hero' ? currentHeroId(doc) : null };
    const best = pickHero(doc, candidates, settings.marginMm, baseScore, vary);
    if (best && !chosen.includes(best)) {
      const weakest = [...chosen].filter((a) => !a.favorite && !keepIds.has(a.id)).sort((a, b) => score(a) - score(b))[0];
      chosen = chronological([...chosen.filter((a) => a !== weakest), best]);
    }
    heroPick = best ?? heroPick;
  }
  // Seed 1 tells the story in time order; shuffles also rearrange, so even when every photo is
  // already on the sheet a shuffle gives a visibly different collage.
  if ((settings.order ?? 'time') !== 'time') chosen = orderPhotos(chosen, settings.order!);
  else if (settings.seed !== 1) chosen = chosen.map((a) => ({ a, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.a);
  const laid = layoutPoster(doc, chosen, settings, heroPick);
  const { used } = laid;
  if (used.length < chosen.length) notes.push(`The grid uses ${used.length} of ${chosen.length} photos to keep every row complete.`);
  if (pinnedIds.size) notes.push(`${pinnedIds.size} pinned photo${pinnedIds.size > 1 ? 's' : ''} kept in place.`);
  return {
    doc: sheetWith(doc, settings, laid),
    report: { available: candidates.length + pinnedIds.size, placed: used.length + pinnedIds.size, nearDuplicatesSet: alternates.length, exactDuplicates, excluded, notes },
  };
}

/**
 * Keep the photos currently on the sheet and lay them out again — after a style or spacing change,
 * or after deleting some. With `shuffle`, the order (and the hero) change too, still using only
 * those photos. Pinned photos stay where they are.
 */
export function relayoutPoster(doc: BookDocument, assets: Map<string, PhotoAsset>, settings: CollageSettings, opts: { shuffle?: boolean } = {}): BookDocument {
  const current = sheetImages(doc)
    .filter((e) => e.assetId && !isPinned(e))
    .map((e) => assets.get(e.assetId!))
    .filter((a): a is PhotoAsset => !!a);
  const unique = [...new Set(current)];
  const order = settings.order ?? 'time';
  let photos: PhotoAsset[];
  if (order !== 'time') photos = orderPhotos(unique, order);
  else if (opts.shuffle) {
    const rng = mulberry32(settings.seed * 7919);
    photos = unique.map((a) => ({ a, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.a);
  } else photos = settings.seed === 1 ? chronological(unique) : unique; // after a shuffle, keep the shuffled order
  let heroPick: PhotoAsset | undefined;
  if (settings.style === 'hero') {
    const wasHero = doc.collage?.style === 'hero';
    if (opts.shuffle) heroPick = pickHero(doc, photos, settings.marginMm, undefined, { seed: settings.seed, avoidId: wasHero ? currentHeroId(doc) : null });
    // Keep the featured photo when re-flowing a hero layout (e.g. changing spacing after a shuffle).
    else heroPick = (wasHero ? photos.find((p) => p.id === currentHeroId(doc)) : undefined) ?? pickHero(doc, photos, settings.marginMm);
  }
  return sheetWith(doc, settings, layoutPoster(doc, photos, settings, heroPick));
}
