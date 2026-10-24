import type { BookDocument, Element, ImageElement, PhotoAsset, Rect } from './model';
import { aspectOf } from './curation';
import { defaultCrop } from './geometry';
import { makeImageElement, makeTextElement } from './layout';
import { mulberry32 } from './random';
import { clamp, MM_PER_PT } from './units';

// Collage layouts: algorithms rather than fixed templates, so they work for any number of photos
// and any sheet — a 24 × 36 in poster or a single book page.
//
//  mosaic   rows that fill the box edge to edge while keeping each photo close to its shape
//  grid     uniform cells (photos cropped to the cell)
//  hero     one large photo, the rest as a mosaic beside or below it
//  scatter  overlapping, tilted prints with white borders, like a pinboard

export type CollageStyle = 'mosaic' | 'grid' | 'hero' | 'scatter';

export const COLLAGE_STYLES: { id: CollageStyle; name: string; description: string }[] = [
  { id: 'mosaic', name: 'Mosaic', description: 'Rows that fill the sheet, each photo kept close to its own shape. Fits any number of photos.' },
  { id: 'grid', name: 'Grid', description: 'Even rows and columns of identical cells. Clean and graphic.' },
  { id: 'hero', name: 'Hero + mosaic', description: 'One standout photo, with the rest as a mosaic around it.' },
  { id: 'scatter', name: 'Pinboard', description: 'Tilted, overlapping prints with white borders, like photos pinned to a board.' },
];

export interface CollageOptions {
  style: CollageStyle;
  gapMm: number;
  seed: number;
  /** Photo to feature in the hero style (defaults to the first landscape photo). */
  hero?: PhotoAsset;
  /** White print border for the pinboard style, as a fraction of the print's short side. */
  printBorder?: number;
  /** Keep the given photo order (pinboard otherwise scatters them randomly). */
  keepOrder?: boolean;
}

// ---- ordering ---------------------------------------------------------------------------------

export type PhotoOrder = 'time' | 'similar' | 'color';

export const PHOTO_ORDERS: { id: PhotoOrder; label: string; description: string }[] = [
  { id: 'time', label: 'Time', description: 'In the order they were taken' },
  { id: 'similar', label: 'Similar look', description: 'Photos with similar colours and composition next to each other' },
  { id: 'color', label: 'Colour', description: 'A rainbow, with black-and-white and muted photos at the end' },
];

/** RGB → [hue 0–360, saturation 0–1, lightness 0–1]. */
export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

/**
 * Order photos for a collage. 'similar' chains each photo to its nearest neighbour by colour grid
 * (palette + rough composition), so look-alikes sit together and the sheet flows from one mood to
 * the next. Photos without colour data keep time order at the end.
 */
export function orderPhotos(photos: PhotoAsset[], order: PhotoOrder): PhotoAsset[] {
  const timeOrdered = [...photos].sort((a, b) => (a.capturedAt ?? '').localeCompare(b.capturedAt ?? '') || a.fileName.localeCompare(b.fileName));
  if (order === 'time') return timeOrdered;
  const withColor = timeOrdered.filter((p) => p.analysis?.avgColor);
  const without = timeOrdered.filter((p) => !p.analysis?.avgColor);
  if (order === 'color') {
    const hsl = new Map(withColor.map((p) => [p, rgbToHsl(p.analysis!.avgColor!)]));
    const vivid = withColor.filter((p) => hsl.get(p)![1] >= 0.12).sort((a, b) => hsl.get(a)![0] - hsl.get(b)![0]);
    const muted = withColor.filter((p) => hsl.get(p)![1] < 0.12).sort((a, b) => hsl.get(b)![2] - hsl.get(a)![2]);
    return [...vivid, ...muted, ...without];
  }
  const vec = (p: PhotoAsset) => p.analysis!.colorGrid ?? [...p.analysis!.avgColor!, ...p.analysis!.avgColor!, ...p.analysis!.avgColor!];
  const dist = (a: number[], b: number[]) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d += (a[i] - b[i]) ** 2;
    return d;
  };
  const remaining = new Set(withColor);
  // Start from the darkest photo so the chain runs dark → light.
  let current = withColor.reduce<PhotoAsset | undefined>((best, p) => (!best || rgbToHsl(p.analysis!.avgColor!)[2] < rgbToHsl(best.analysis!.avgColor!)[2] ? p : best), undefined);
  const chain: PhotoAsset[] = [];
  while (current) {
    chain.push(current);
    remaining.delete(current);
    let next: PhotoAsset | undefined;
    let bestD = Infinity;
    const v = vec(current);
    for (const p of remaining) {
      const d = dist(v, vec(p));
      if (d < bestD) {
        bestD = d;
        next = p;
      }
    }
    current = next;
  }
  return [...chain, ...without];
}

export interface CollageResult {
  elements: Element[];
  /** Photos actually placed (grid may leave out a few to keep the grid complete). */
  used: PhotoAsset[];
}

export function layoutCollage(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], opts: CollageOptions): CollageResult {
  if (!photos.length || box.w <= 0 || box.h <= 0) return { elements: [], used: [] };
  switch (opts.style) {
    case 'grid':
      return grid(doc, box, photos, opts.gapMm);
    case 'hero':
      return hero(doc, box, photos, opts);
    case 'scatter':
      return scatter(doc, box, photos, opts);
    default:
      return { elements: mosaic(doc, box, photos, opts.gapMm), used: photos };
  }
}

// ---- flowing around pinned photos -------------------------------------------------------------

/**
 * The free space left in `box` once `obstacles` (pinned frames) are taken out, `gap` away from
 * them. Each obstacle splits the space into two full bands (above/below, or left/right — whichever
 * keeps the bigger pieces for its shape) plus the pieces either side of it. Pieces thinner than
 * `minSize` are dropped and simply stay as space around the pinned photo.
 */
export function freeRects(box: Rect, obstacles: Rect[], gap: number, minSize: number): Rect[] {
  let free: Rect[] = [box];
  for (const o of obstacles) {
    // A tall pin splits into left/right columns; a wide one into top/bottom rows.
    const columns = o.h / box.h > o.w / box.w;
    const next: Rect[] = [];
    for (const r of free) {
      const hit = o.x - gap < r.x + r.w && o.x + o.w + gap > r.x && o.y - gap < r.y + r.h && o.y + o.h + gap > r.y;
      if (!hit) {
        next.push(r);
        continue;
      }
      const top = o.y - gap - r.y;
      const bottom = r.y + r.h - (o.y + o.h + gap);
      const left = o.x - gap - r.x;
      const right = r.x + r.w - (o.x + o.w + gap);
      if (columns) {
        if (left > 0) next.push({ x: r.x, y: r.y, w: left, h: r.h });
        if (right > 0) next.push({ x: o.x + o.w + gap, y: r.y, w: right, h: r.h });
        const x0 = Math.max(r.x, o.x);
        const x1 = Math.min(r.x + r.w, o.x + o.w);
        if (top > 0 && x1 > x0) next.push({ x: x0, y: r.y, w: x1 - x0, h: top });
        if (bottom > 0 && x1 > x0) next.push({ x: x0, y: o.y + o.h + gap, w: x1 - x0, h: bottom });
      } else {
        if (top > 0) next.push({ x: r.x, y: r.y, w: r.w, h: top });
        if (bottom > 0) next.push({ x: r.x, y: o.y + o.h + gap, w: r.w, h: bottom });
        const y0 = Math.max(r.y, o.y);
        const y1 = Math.min(r.y + r.h, o.y + o.h);
        if (left > 0 && y1 > y0) next.push({ x: r.x, y: y0, w: left, h: y1 - y0 });
        if (right > 0 && y1 > y0) next.push({ x: o.x + o.w + gap, y: y0, w: right, h: y1 - y0 });
      }
    }
    free = next;
  }
  return free.filter((r) => r.w >= minSize && r.h >= minSize).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Like layoutCollage, but leaves `obstacles` (pinned photos) where they are: the photos are shared
 * out over the free pieces in proportion to their area, in reading order. The hero style features
 * its photo in the largest piece; the other pieces become mosaics.
 */
export function layoutCollageAround(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], opts: CollageOptions, obstacles: Rect[]): CollageResult {
  if (!obstacles.length) return layoutCollage(doc, box, photos, opts);
  const minSize = Math.max(12, Math.min(box.w, box.h) * 0.08);
  const rects = freeRects(box, obstacles, opts.gapMm, minSize);
  if (!rects.length || !photos.length) return { elements: [], used: [] };
  const isHero = opts.style === 'hero';
  const featured = isHero ? (opts.hero && photos.includes(opts.hero) ? opts.hero : photos[0]) : undefined;
  const rest = featured ? photos.filter((p) => p !== featured) : photos;
  const areas = rects.map((r) => r.w * r.h);
  const heroIdx = isHero ? areas.indexOf(Math.max(...areas)) : -1;
  // Largest-remainder split of the photos by area (the hero piece counts its featured photo).
  const total = areas.reduce((a, b) => a + b, 0);
  const n = photos.length;
  const exact = areas.map((a) => (n * a) / total);
  const counts = exact.map(Math.floor);
  const order = exact.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f);
  for (let k = 0, left = n - counts.reduce((a, b) => a + b, 0); left > 0; k++, left--) counts[order[k % order.length].i]++;
  if (heroIdx >= 0 && counts[heroIdx] === 0) {
    const donor = counts.indexOf(Math.max(...counts));
    counts[donor]--;
    counts[heroIdx]++;
  }
  const elements: Element[] = [];
  const used: PhotoAsset[] = [];
  let at = 0;
  rects.forEach((r, k) => {
    const take = k === heroIdx ? counts[k] - 1 : counts[k];
    const chunk = rest.slice(at, at + take);
    at += take;
    const group = k === heroIdx && featured ? [featured, ...chunk] : chunk;
    if (!group.length) return;
    const style: CollageStyle = k === heroIdx ? 'hero' : isHero ? 'mosaic' : opts.style;
    const res = layoutCollage(doc, r, group, { ...opts, style, hero: featured, seed: opts.seed + k });
    elements.push(...res.elements);
    used.push(...res.used);
  });
  return { elements, used };
}

const frame = (doc: Pick<BookDocument, 'style'>, asset: PhotoAsset, r: Rect, rotationDeg = 0, borderMm = 0): ImageElement => ({
  ...makeImageElement(doc, asset, r, rotationDeg, true),
  borderMm,
  borderColor: '#ffffff',
  crop: defaultCrop(asset),
});

// ---- mosaic ---------------------------------------------------------------------------------

/**
 * Split the photos (in order) into rows so that, scaled to the box width, the rows stack to the
 * box height. Picks the row count and break points minimising how far each row's height strays
 * from even, then fills exactly — frames differ from photo shapes by only a small crop.
 */
export function mosaicRows(aspects: number[], W: number, H: number, gap: number): number[][] {
  const n = aspects.length;
  if (n === 0) return [];
  const prefix = [0];
  for (const a of aspects) prefix.push(prefix[prefix.length - 1] + a);
  const sumA = (i: number, j: number) => prefix[j] - prefix[i]; // photos i..j-1
  const meanA = prefix[n] / n;
  const k0 = Math.max(1, Math.round(Math.sqrt((n * meanA * H) / W)));
  let best: { cost: number; rows: number[][] } | null = null;
  for (let k = Math.max(1, k0 - 2); k <= Math.min(n, k0 + 3); k++) {
    const target = (H - gap * (k - 1)) / k;
    if (target <= 0) continue;
    const rowCost = (i: number, j: number) => {
      const h = (W - gap * (j - i - 1)) / sumA(i, j);
      return ((h - target) / target) ** 2;
    };
    // dp[r][j]: best cost putting photos 0..j-1 into r rows.
    const dp = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
    const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
    dp[0][0] = 0;
    for (let r = 1; r <= k; r++) {
      for (let j = r; j <= n - (k - r); j++) {
        for (let i = r - 1; i < j; i++) {
          if (dp[r - 1][i] === Infinity) continue;
          const c = dp[r - 1][i] + rowCost(i, j);
          if (c < dp[r][j]) {
            dp[r][j] = c;
            from[r][j] = i;
          }
        }
      }
    }
    if (dp[k][n] === Infinity) continue;
    const rows: number[][] = [];
    for (let r = k, j = n; r > 0; r--) {
      const i = from[r][j];
      rows.unshift(Array.from({ length: j - i }, (_, t) => i + t));
      j = i;
    }
    // How much the final exact fit has to distort photo shapes.
    const natural = rows.reduce((acc, row) => acc + (W - gap * (row.length - 1)) / row.reduce((s, i) => s + aspects[i], 0), 0);
    const stretch = (H - gap * (k - 1)) / natural;
    const cost = dp[k][n] / k + 2 * Math.log(stretch) ** 2;
    if (!best || cost < best.cost) best = { cost, rows };
  }
  return best?.rows ?? [aspects.map((_, i) => i)];
}

function mosaic(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], gap: number): Element[] {
  const aspects = photos.map(aspectOf);
  const rows = mosaicRows(aspects, box.w, box.h, gap);
  const natural = rows.map((row) => (box.w - gap * (row.length - 1)) / row.reduce((s, i) => s + aspects[i], 0));
  const scale = (box.h - gap * (rows.length - 1)) / natural.reduce((a, b) => a + b, 0);
  const els: Element[] = [];
  let y = box.y;
  rows.forEach((row, r) => {
    const h = natural[r] * scale;
    const total = row.reduce((s, i) => s + aspects[i], 0);
    const usable = box.w - gap * (row.length - 1);
    let x = box.x;
    row.forEach((i, t) => {
      // Last frame takes the remainder so rounding never leaves a sliver.
      const w = t === row.length - 1 ? box.x + box.w - x : (aspects[i] / total) * usable;
      els.push(frame(doc, photos[i], { x, y, w, h }));
      x += w + gap;
    });
    y += h + gap;
  });
  return els;
}

// ---- grid -----------------------------------------------------------------------------------

function grid(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], gap: number): CollageResult {
  const n = photos.length;
  const target = median(photos.map(aspectOf));
  let best = { c: 1, r: n, score: Infinity };
  for (let c = 1; c <= n; c++) {
    const r = Math.max(1, Math.floor(n / c));
    const cellW = (box.w - gap * (c - 1)) / c;
    const cellH = (box.h - gap * (r - 1)) / r;
    if (cellW <= 0 || cellH <= 0) continue;
    // Prefer cells shaped like the photos, and using as many photos as possible.
    const score = Math.abs(Math.log(cellW / cellH / target)) + 1.2 * ((n - c * r) / n);
    if (score < best.score) best = { c, r, score };
  }
  const { c, r } = best;
  const used = photos.slice(0, c * r);
  const cellW = (box.w - gap * (c - 1)) / c;
  const cellH = (box.h - gap * (r - 1)) / r;
  const elements = used.map((p, i) => frame(doc, p, { x: box.x + (i % c) * (cellW + gap), y: box.y + Math.floor(i / c) * (cellH + gap), w: cellW, h: cellH }));
  return { elements, used };
}

// ---- hero -----------------------------------------------------------------------------------

function hero(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], opts: CollageOptions): CollageResult {
  const gap = opts.gapMm;
  const featured = opts.hero && photos.includes(opts.hero) ? opts.hero : photos.find((p) => aspectOf(p) >= 1.2) ?? photos[0];
  const rest = photos.filter((p) => p !== featured);
  const a = aspectOf(featured);
  const portraitBox = box.h >= box.w;
  let heroRect: Rect;
  let restRect: Rect;
  if (!rest.length) {
    heroRect = box;
    restRect = { ...box, w: 0, h: 0 };
  } else if (portraitBox) {
    const h = clamp(box.w / a, box.h * 0.32, box.h * 0.55);
    heroRect = { x: box.x, y: box.y, w: box.w, h };
    restRect = { x: box.x, y: box.y + h + gap, w: box.w, h: box.h - h - gap };
  } else {
    const w = clamp(box.h * a, box.w * 0.35, box.w * 0.58);
    heroRect = { x: box.x, y: box.y, w, h: box.h };
    restRect = { x: box.x + w + gap, y: box.y, w: box.w - w - gap, h: box.h };
  }
  const elements: Element[] = [frame(doc, featured, heroRect)];
  if (rest.length) elements.push(...mosaic(doc, restRect, rest, gap));
  return { elements, used: [featured, ...rest] };
}

// ---- scatter (pinboard) ---------------------------------------------------------------------

function scatter(doc: Pick<BookDocument, 'style'>, box: Rect, photos: PhotoAsset[], opts: CollageOptions): CollageResult {
  const rng = mulberry32(opts.seed);
  const n = photos.length;
  const order = opts.keepOrder ? photos : photos.map((p) => ({ p, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.p);
  const cols = Math.max(1, Math.round(Math.sqrt((n * box.w) / box.h)));
  const rows = Math.ceil(n / cols);
  const cellW = box.w / cols;
  const cellH = box.h / rows;
  // Prints overlap their neighbours a little: ~1.35× the cell area each.
  const area = cellW * cellH * 1.35;
  const borderFrac = opts.printBorder ?? 0.05;
  const elements: Element[] = order.map((p, i) => {
    const a = aspectOf(p);
    let w = Math.sqrt(area * a);
    let h = Math.sqrt(area / a);
    const fit = Math.min(1, (box.w * 0.9) / w, (box.h * 0.9) / h);
    w *= fit;
    h *= fit;
    const rot = (rng() - 0.5) * 14;
    const col = i % cols;
    const row = Math.floor(i / cols);
    let cx = box.x + (col + 0.5) * cellW + (rng() - 0.5) * cellW * 0.35;
    let cy = box.y + (row + 0.5) * cellH + (rng() - 0.5) * cellH * 0.35;
    // Keep the rotated print inside the box.
    const rad = (Math.abs(rot) * Math.PI) / 180;
    const bw = w * Math.cos(rad) + h * Math.sin(rad);
    const bh = w * Math.sin(rad) + h * Math.cos(rad);
    cx = clamp(cx, box.x + bw / 2, box.x + box.w - bw / 2);
    cy = clamp(cy, box.y + bh / 2, box.y + box.h - bh / 2);
    return frame(doc, p, { x: cx - w / 2, y: cy - h / 2, w, h }, Math.round(rot * 10) / 10, Math.min(w, h) * borderFrac);
  });
  return { elements, used: order };
}

// ---- titles ---------------------------------------------------------------------------------

export type TitlePosition = 'none' | 'top' | 'bottom';

/**
 * Title band for a collage. The text sits inside `safe` (so it is never trimmed); the photo box is
 * cut back to make room, which may extend into the bleed for edge-to-edge collages.
 */
export function titleBand(
  doc: Pick<BookDocument, 'style' | 'settings'>,
  photoBox: Rect,
  safe: Rect,
  position: TitlePosition,
  title: string,
  subtitle: string,
  gap: number,
): { elements: Element[]; rest: Rect } {
  if (position === 'none' || !title) return { elements: [], rest: photoBox };
  const band = Math.max(16, safe.h * (subtitle ? 0.1 : 0.075));
  const top = position === 'top' ? safe.y : safe.y + safe.h - band;
  const titleH = subtitle ? band * 0.64 : band;
  const t = makeTextElement(doc, 'title', title, { x: safe.x, y: top, w: safe.w, h: titleH });
  t.fontSizePt = Math.round(((titleH * 0.6) / MM_PER_PT) * 2) / 2;
  t.lineHeight = 1.1;
  const elements: Element[] = [t];
  if (subtitle) {
    const st = makeTextElement(doc, 'subtitle', subtitle, { x: safe.x, y: top + titleH, w: safe.w, h: band - titleH });
    st.fontSizePt = Math.round((((band - titleH) * 0.5) / MM_PER_PT) * 2) / 2;
    elements.push(st);
  }
  const rest =
    position === 'top'
      ? { x: photoBox.x, y: top + band + gap, w: photoBox.w, h: photoBox.y + photoBox.h - (top + band + gap) }
      : { x: photoBox.x, y: photoBox.y, w: photoBox.w, h: top - gap - photoBox.y };
  return { elements, rest };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}
