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
  const order = photos.map((p) => ({ p, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.p);
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
