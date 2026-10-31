import type { BookDocument, CollageSettings, Element, Gradient, PhotoAsset, Rect, ShapeElement, TextElement } from './model';
import { dateRangeOf } from './curation';
import { gradeFromPreset } from './grade';
import { makeImageElement, makeShapeElement, makeTextElement } from './layout';
import { MONTHS, makeCalendar, photoDays } from './calendar';
import { scorePhotos } from './curation';
import { curatePool, type CuratedPool } from './generator';
import { generatePoster, relayoutPoster, type PosterReport } from './poster';
import { estimateTextHeightMm, quickStyle, quickStyleFields } from './quickStyles';
import { shapeDef } from './shapes';
import { pageScale } from './typography';
import { MM_PER_PT } from './units';
import { newId } from './random';

// Poster templates: a finished design — background, type, banners and icons — with an area for the
// photos, which Auto collage then fills. Text and decorations are ordinary elements afterwards: edit,
// move or delete them; Arrange and Shuffle leave them alone and keep the photos inside the area.
// Positions are fractions of the sheet, so a template fits any poster size.

interface TextItem {
  kind: 'text';
  /** {title}, {TITLE}, {subtitle}, {year} are filled in from the poster and its photos. */
  text: string;
  quick: string;
  rect: Rect;
  sizePt: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  arch?: number;
  gradient?: Gradient;
  background?: { color: string; opacity: number; radius?: number };
  shadow?: boolean;
  letterSpacingEm?: number;
  /** Items sharing a key become one group (a banner and its words). */
  group?: string;
}

interface ShapeItem {
  kind: 'shape';
  shape: string;
  rect: Rect;
  fill: string;
  opacity?: number;
  behind?: boolean;
  gradient?: Gradient;
  group?: string;
}

/** Twelve tiles: each month's best photo above that month's calendar (photo days marked). */
interface MonthsItem {
  kind: 'months';
  rect: Rect;
}

export interface PosterTemplate {
  id: string;
  name: string;
  description: string;
  background: string;
  collage: Partial<CollageSettings> & { area: Rect };
  photoCount: number;
  grade?: string;
  items: (TextItem | ShapeItem | MonthsItem)[];
  /** Photos are placed by the template itself (pinned), not by Auto collage. */
  placesPhotos?: boolean;
}

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const POSTER_TEMPLATES: PosterTemplate[] = [
  {
    id: 'postcard',
    name: 'Greetings from',
    description: 'Vintage travel postcard: script and a big arched headline, a ribbon with the year.',
    background: '#f4ecdf',
    collage: { style: 'mosaic', area: R(0.06, 0.25, 0.88, 0.6), gapMm: 4 },
    photoCount: 14,
    grade: 'warm',
    items: [
      { kind: 'text', text: 'Greetings from', quick: 'script', rect: R(0.1, 0.035, 0.8, 0.07), sizePt: 30, color: '#c0392b' },
      { kind: 'text', text: '{TITLE}', quick: 'headline', rect: R(0.04, 0.09, 0.92, 0.15), sizePt: 64, color: '#1d3557', arch: 22, shadow: true },
      { kind: 'shape', shape: 'ribbon', rect: R(0.22, 0.875, 0.56, 0.085), fill: '#c0392b', group: 'ribbon' },
      { kind: 'text', text: '{year}', quick: 'caps', rect: R(0.33, 0.888, 0.34, 0.045), sizePt: 16, color: '#f4ecdf', letterSpacingEm: 0.35, group: 'ribbon' },
    ],
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'A quiet grid with wide white margins and a museum-style caption.',
    background: '#ffffff',
    collage: { style: 'grid', area: R(0.1, 0.08, 0.8, 0.7), gapMm: 4 },
    photoCount: 12,
    items: [
      { kind: 'text', text: '{TITLE}', quick: 'caps', rect: R(0.1, 0.81, 0.8, 0.035), sizePt: 15, color: '#222222', letterSpacingEm: 0.4 },
      { kind: 'shape', shape: 'line', rect: R(0.42, 0.856, 0.16, 0.002), fill: '#222222' },
      { kind: 'text', text: '{subtitle}', quick: 'soft', rect: R(0.1, 0.868, 0.8, 0.03), sizePt: 11, color: '#777777' },
    ],
  },
  {
    id: 'magazine',
    name: 'Magazine cover',
    description: 'Edge-to-edge photos, a bold masthead and a starburst — like a glossy cover.',
    background: '#111111',
    collage: { style: 'hero', area: R(0, 0, 1, 1), gapMm: 0, marginMm: 0 },
    photoCount: 7,
    grade: 'vivid',
    items: [
      { kind: 'text', text: '{TITLE}', quick: 'magazine', rect: R(0.04, 0.025, 0.92, 0.13), sizePt: 70, color: '#ffffff', shadow: true },
      { kind: 'shape', shape: 'burst', rect: R(0.72, 0.17, 0.22, 0.165), fill: '#e63946', group: 'burst' },
      { kind: 'text', text: 'BEST OF\n{year}', quick: 'modern', rect: R(0.745, 0.21, 0.17, 0.09), sizePt: 15, color: '#ffffff', group: 'burst' },
      { kind: 'text', text: '{subtitle}', quick: 'band', rect: R(0.05, 0.9, 0.5, 0.045), sizePt: 13, color: '#111111', align: 'left', background: { color: '#ffffff', opacity: 0.9 } },
    ],
  },
  {
    id: 'party',
    name: 'Pinboard party',
    description: 'Tilted prints on pink with a handwritten title, hearts and sparkles.',
    background: '#fbe3e8',
    collage: { style: 'scatter', area: R(0.06, 0.2, 0.88, 0.74), gapMm: 3 },
    photoCount: 12,
    items: [
      { kind: 'text', text: '{title}', quick: 'note', rect: R(0.1, 0.035, 0.8, 0.13), sizePt: 54, color: '#c2185b', arch: 14 },
      { kind: 'shape', shape: 'i-sparkle', rect: R(0.06, 0.05, 0.07, 0.052), fill: '#f4a261' },
      { kind: 'shape', shape: 'i-heart', rect: R(0.87, 0.06, 0.07, 0.05), fill: '#e63946' },
      { kind: 'shape', shape: 'i-sparkle', rect: R(0.85, 0.15, 0.045, 0.034), fill: '#f4a261' },
      { kind: 'shape', shape: 'i-heart', rect: R(0.05, 0.94, 0.05, 0.036), fill: '#e63946' },
    ],
  },
  {
    id: 'circles',
    name: 'Night circles',
    description: 'Round photos on deep navy with an elegant title and little gold stars.',
    background: '#1d2a44',
    collage: { style: 'grid', area: R(0.08, 0.22, 0.84, 0.72), gapMm: 5, frameShape: 'circle' },
    photoCount: 12,
    items: [
      { kind: 'text', text: '{title}', quick: 'elegant', rect: R(0.05, 0.045, 0.9, 0.1), sizePt: 50, color: '#f7f1e3' },
      { kind: 'text', text: '{year}', quick: 'caps', rect: R(0.3, 0.155, 0.4, 0.03), sizePt: 11, color: '#e9c46a', letterSpacingEm: 0.5 },
      { kind: 'shape', shape: 'i-star', rect: R(0.12, 0.08, 0.035, 0.026), fill: '#e9c46a' },
      { kind: 'shape', shape: 'i-star', rect: R(0.85, 0.07, 0.025, 0.019), fill: '#e9c46a' },
      { kind: 'shape', shape: 'i-sparkle', rect: R(0.88, 0.13, 0.03, 0.022), fill: '#e9c46a' },
    ],
  },
  {
    id: 'year',
    name: 'Year in review',
    description: 'A huge gradient year over rounded photos on black.',
    background: '#0f0f12',
    collage: { style: 'grid', area: R(0.06, 0.31, 0.88, 0.63), gapMm: 4, frameShape: 'rounded' },
    photoCount: 12,
    items: [
      { kind: 'text', text: '{year}', quick: 'modern', rect: R(0.04, 0.02, 0.92, 0.2), sizePt: 130, color: '#ff9a8b', gradient: { from: '#ff9a8b', to: '#a18cd1', angleDeg: 90 } },
      { kind: 'text', text: '{TITLE}', quick: 'band', rect: R(0.25, 0.235, 0.5, 0.045), sizePt: 13, color: '#0f0f12', background: { color: '#f5f5f5', opacity: 1, radius: 30 } },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal hero',
    description: 'One standout photo, a few more beside it, and a calm serif title.',
    background: '#f7f5f0',
    collage: { style: 'hero', area: R(0.06, 0.05, 0.88, 0.76), gapMm: 3 },
    photoCount: 6,
    items: [
      { kind: 'text', text: '{title}', quick: 'elegant', rect: R(0.06, 0.83, 0.88, 0.075), sizePt: 42, color: '#2f2f2f' },
      { kind: 'text', text: '{subtitle}', quick: 'caps', rect: R(0.06, 0.915, 0.88, 0.03), sizePt: 10, color: '#8a8a8a', letterSpacingEm: 0.35 },
    ],
  },
  {
    id: 'months',
    name: '12 months',
    description: 'A year on one sheet: each month’s best photo above its calendar, with the days you took photos marked.',
    background: '#faf7f2',
    collage: { style: 'grid', area: R(0.05, 0.12, 0.9, 0.85), gapMm: 4 },
    photoCount: 12,
    placesPhotos: true,
    items: [
      { kind: 'text', text: '{year}', quick: 'modern', rect: R(0.05, 0.025, 0.9, 0.08), sizePt: 54, color: '#2b2b2b' },
      { kind: 'months', rect: R(0.05, 0.12, 0.9, 0.85) },
    ],
  },
  {
    id: 'film',
    name: 'Film strip',
    description: 'Black with sprocket dots, a tight grid and a typewriter caption.',
    background: '#121212',
    collage: { style: 'mosaic', area: R(0.07, 0.09, 0.86, 0.79), gapMm: 2 },
    photoCount: 16,
    grade: 'film',
    items: [
      { kind: 'shape', shape: 'dots', rect: R(0.04, 0.035, 0.92, 0.018), fill: '#f2f2f2' },
      { kind: 'shape', shape: 'dots', rect: R(0.04, 0.947, 0.92, 0.018), fill: '#f2f2f2' },
      { kind: 'text', text: '{title} · {year}', quick: 'typewriter', rect: R(0.1, 0.895, 0.8, 0.035), sizePt: 13, color: '#f2f2f2' },
    ],
  },
];

export function posterTemplate(id: string): PosterTemplate | undefined {
  return POSTER_TEMPLATES.find((t) => t.id === id);
}

/** The year most of the photos were taken (or this year). */
function photoYear(assets: PhotoAsset[]): string {
  const counts = new Map<string, number>();
  for (const a of assets) if (a.capturedAt && !a.excluded) counts.set(a.capturedAt.slice(0, 4), (counts.get(a.capturedAt.slice(0, 4)) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? String(new Date().getFullYear());
}

export function fillPlaceholders(text: string, doc: Pick<BookDocument, 'title' | 'subtitle'>, assets: PhotoAsset[]): string {
  const title = doc.title || 'Our summer';
  const subtitle = doc.subtitle || dateRangeOf(assets.filter((a) => !a.excluded)) || photoYear(assets);
  return text.replace(/\{TITLE\}/g, title.toUpperCase()).replace(/\{title\}/g, title).replace(/\{subtitle\}/g, subtitle).replace(/\{year\}/g, photoYear(assets));
}

/** The template's text and decorations as elements for this sheet. */
export function templateElements(doc: BookDocument, t: PosterTemplate, assets: PhotoAsset[]): Element[] {
  const W = doc.settings.trimWidthMm;
  const H = doc.settings.trimHeightMm;
  const scale = pageScale(doc);
  const box = (r: Rect) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });
  const groups = new Map<string, string>();
  const groupOf = (key?: string) => {
    if (!key) return undefined;
    if (!groups.has(key)) groups.set(key, newId());
    return groups.get(key);
  };
  return t.items.flatMap((item): Element[] => {
    if (item.kind === 'months') return monthTiles(doc, box(item.rect), assets);
    return [templateItem(item)];
  });

  function templateItem(item: TextItem | ShapeItem): Element {
    if (item.kind === 'shape') {
      const b = box(item.rect);
      // Icons keep their proportions: fit them into the box.
      const def = shapeDef(item.shape);
      let r = b;
      if (def.category === 'icon' || def.id === 'burst' || def.id === 'seal') {
        const w = Math.min(b.w, b.h * def.aspect);
        const h = w / def.aspect;
        r = { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
      }
      const el: ShapeElement = { ...makeShapeElement(r, item.fill, item.opacity ?? 1), shape: item.shape, gradient: item.gradient, behind: item.behind, groupId: groupOf(item.group) };
      return el;
    }
    const b = box(item.rect);
    const text = fillPlaceholders(item.text, doc, assets);
    const el = makeTextElement(doc, 'body', text, b, { align: item.align ?? 'center' });
    const q = quickStyle(item.quick)!;
    const f = quickStyleFields(doc, q);
    const sizePt = Math.round(item.sizePt * scale * 2) / 2;
    const out: TextElement = {
      ...el,
      ...f,
      fontSizePt: sizePt,
      color: item.color,
      letterSpacingEm: item.letterSpacingEm ?? f.letterSpacingEm ?? 0,
      backgroundColor: item.background?.color,
      backgroundOpacity: item.background?.opacity,
      backgroundRadiusMm: item.background?.radius,
      paddingMm: item.background ? Math.round(sizePt * MM_PER_PT * 0.4 * 10) / 10 : 0,
      gradient: item.gradient,
      arch: item.arch,
      shadow: item.shadow ? { color: '#000000', dxMm: sizePt * 0.012, dyMm: sizePt * 0.012, opacity: 0.3 } : undefined,
      styleLinked: false,
      groupId: groupOf(item.group),
    };
    // Grow the box if the text needs more room than the template allowed for (long titles).
    const need = estimateTextHeightMm(text, out.widthMm, sizePt, out.lineHeight, out.letterSpacingEm, out.paddingMm ?? 0);
    if (!out.arch && need > out.heightMm) out.heightMm = need;
    return out;
  }
}

/**
 * The year with the most photos as twelve tiles (4 × 3, or 3 × 4 on a portrait sheet): the best
 * photo of each month — pinned, so Arrange leaves it — over that month's calendar.
 */
export function monthTiles(doc: BookDocument, r: Rect, assets: PhotoAsset[]): Element[] {
  const usable = assets.filter((a) => !a.excluded && !a.missing && a.capturedAt);
  const year = photoYear(usable);
  const scores = scorePhotos(usable);
  const gap = Math.min(r.w, r.h) * 0.025;
  const PHOTO = 0.42;
  // A month's calendar is about 1.2× as tall as it is wide: choose the grid (3, 4 or 6 across)
  // that lets the calendars come out largest under their photos.
  const fit = (c: number) => {
    const rw = 12 / c;
    const w = (r.w - gap * (c - 1)) / c;
    const h = (r.h - gap * (rw - 1)) / rw;
    return Math.min(w, (h * (1 - PHOTO) - gap * 0.5) / 1.2);
  };
  const cols = [3, 4, 6].sort((a, b) => fit(b) - fit(a))[0];
  const rows = 12 / cols;
  const cw = (r.w - gap * (cols - 1)) / cols;
  const ch = (r.h - gap * (rows - 1)) / rows;
  const out: Element[] = [];
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`;
    const inMonth = usable.filter((a) => a.capturedAt!.startsWith(key));
    const best = [...inMonth].sort((a, b) => Number(b.favorite) - Number(a.favorite) || (scores.get(b.id)?.total ?? 0) - (scores.get(a.id)?.total ?? 0))[0] ?? null;
    const x = r.x + (m % cols) * (cw + gap);
    const y = r.y + Math.floor(m / cols) * (ch + gap);
    const photoH = ch * PHOTO;
    const img = { ...makeImageElement(doc, best, { x, y, w: cw, h: photoH }), pinned: true };
    out.push(img);
    const cal = makeCalendar(doc, { x, y: 0, w: cw }, photoDays(inMonth), { mode: 'month', start: `${key}-01` });
    const room = ch - photoH - gap * 0.5;
    const k = Math.min(1, room / cal.heightMm);
    const w = cw * k;
    out.push({ ...cal, title: MONTHS[m], widthMm: w, heightMm: cal.heightMm * k, xMm: x + (cw - w) / 2, yMm: y + photoH + gap * 0.5 });
  }
  return out;
}

/**
 * Start a poster from a template: new background, type and decorations, then Auto collage fills
 * the photo area. Replaces what was on the sheet (one undo step brings it back).
 */
export function applyPosterTemplate(
  doc: BookDocument,
  assets: PhotoAsset[],
  templateId: string,
  curated: CuratedPool = curatePool(assets),
): { doc: BookDocument; report: PosterReport } {
  const t = posterTemplate(templateId);
  if (!t) throw new Error(`Unknown poster template “${templateId}”`);
  const sheet = doc.spreads[0];
  const base: BookDocument = {
    ...doc,
    grade: t.grade ? gradeFromPreset(t.grade) : undefined,
    spreads: [{ ...sheet, background: t.background, backgroundImage: undefined, provenance: undefined, elements: [] }],
  };
  const items = templateElements(base, t, assets);
  const withItems: BookDocument = { ...base, templateElementIds: items.map((e) => e.id), spreads: [{ ...base.spreads[0], elements: items }] };
  const prev = doc.collage;
  const settings: CollageSettings = {
    style: 'mosaic', gapMm: 3, marginMm: 0, titlePosition: 'none', ...t.collage,
    photoCount: t.photoCount, seed: 1, source: 'best', order: prev?.order,
  };
  if (t.placesPhotos) {
    const placed = withItems.spreads[0].elements.filter((e) => e.type === 'image' && e.assetId).length;
    return {
      doc: { ...withItems, collage: settings, template: t.id },
      report: { available: placed, placed, nearDuplicatesSet: curated.alternates.length, exactDuplicates: curated.exactDuplicates, excluded: curated.excluded, notes: ['Each month shows its best photo; drag another photo onto a frame to change it.'] },
    };
  }
  const res = generatePoster(withItems, assets, settings, curated);
  return { doc: { ...res.doc, template: t.id }, report: res.report };
}

/**
 * Take a poster template off again: its type, banners and icons, its background colour and grade,
 * and its photo area. Photos on the sheet stay and re-flow over the whole sheet. Posters started
 * from a template before its elements were recorded lose every text, shape and calendar instead
 * (one undo step brings them back).
 */
export function removePosterTemplate(doc: BookDocument, assets: Map<string, PhotoAsset>): BookDocument {
  const sheet = doc.spreads[0];
  if (!sheet || !doc.template) return doc;
  const t = posterTemplate(doc.template);
  const recorded = doc.templateElementIds ? new Set(doc.templateElementIds) : null;
  const fromTemplate = (e: Element) => (recorded ? recorded.has(e.id) && !(e.type === 'image' && e.assetId && !t?.placesPhotos) : e.type !== 'image');
  const { area: _area, ...collage } = doc.collage ?? ({} as CollageSettings);
  const next: BookDocument = {
    ...doc,
    template: undefined,
    templateElementIds: undefined,
    grade: t?.grade ? undefined : doc.grade,
    collage: doc.collage ? (collage as CollageSettings) : undefined,
    spreads: [{ ...sheet, background: t && sheet.background === t.background ? undefined : sheet.background, elements: sheet.elements.filter((e) => !fromTemplate(e)) }, ...doc.spreads.slice(1)],
  };
  const photos = next.spreads[0].elements.some((e) => e.type === 'image' && e.assetId);
  return photos && next.collage ? relayoutPoster(next, assets, next.collage) : next;
}
