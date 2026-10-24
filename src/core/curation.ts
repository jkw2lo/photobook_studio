import type { PhotoAsset } from './model';
import { clamp } from './units';

// Rules-based curation: similarity grouping, scoring, sequencing.
// Scores rank photos; they never delete them. A blurry candid can still be chosen.

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      d += x & 1;
      x >>>= 1;
    }
  }
  return d;
}

export const timeOf = (a: Pick<PhotoAsset, 'capturedAt'>) => (a.capturedAt ? Date.parse(a.capturedAt) : NaN);

export interface SimilarityOptions {
  /** Max dHash Hamming distance when both photos have capture times close together. */
  maxDistance: number;
  /** Stricter threshold when either photo lacks a capture time. */
  maxDistanceUndated: number;
  /** Photos further apart than this are never grouped, however alike. */
  maxMinutesApart: number;
}

export const DEFAULT_SIMILARITY: SimilarityOptions = { maxDistance: 12, maxDistanceUndated: 6, maxMinutesApart: 120 };

/** Mean colours far apart (when both are known): not the same scene, whatever the shapes say. */
function colorsDiffer(a: PhotoAsset, b: PhotoAsset): boolean {
  const ca = a.analysis?.avgColor;
  const cb = b.analysis?.avgColor;
  if (!ca || !cb) return false;
  return Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) > 70;
}

/** Group near-duplicate photos (burst shots, re-takes). Returns assetId → groupId (the group's first member). */
export function groupSimilar(assets: PhotoAsset[], opts = DEFAULT_SIMILARITY): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let p = parent.get(id)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(id, p);
    return p;
  };
  for (const a of assets) parent.set(a.id, a.id);
  const hashed = assets.filter((a) => a.analysis?.dHash);
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const a = hashed[i];
      const b = hashed[j];
      const ta = timeOf(a);
      const tb = timeOf(b);
      const dated = !Number.isNaN(ta) && !Number.isNaN(tb);
      if (dated && Math.abs(ta - tb) > opts.maxMinutesApart * 60_000) continue;
      const limit = dated ? opts.maxDistance : opts.maxDistanceUndated;
      // dHash only sees shape and light; shots of one moment share their colours too. Without this,
      // same-shaped cutouts in different colours (stickers) would count as one burst.
      if (colorsDiffer(a, b)) continue;
      if (hamming(a.analysis!.dHash, b.analysis!.dHash) <= limit) parent.set(find(a.id), find(b.id));
    }
  }
  const out = new Map<string, string>();
  for (const a of assets) out.set(a.id, find(a.id));
  return out;
}

export interface PhotoScore {
  /** 0..1 technical quality: sharpness (relative to this collection), exposure, resolution. */
  quality: number;
  /** quality plus user signals (rating, favourite). Used for ranking. */
  total: number;
}

export function scorePhotos(assets: PhotoAsset[]): Map<string, PhotoScore> {
  // Sharpness is judged relative to the collection: a percentile rank is robust to camera differences.
  const sharp = assets.map((a) => a.analysis?.sharpness ?? 0).sort((x, y) => x - y);
  const pct = (v: number) => {
    if (sharp.length <= 1) return 0.5;
    let lo = 0;
    while (lo < sharp.length && sharp[lo] < v) lo++;
    return lo / (sharp.length - 1);
  };
  const out = new Map<string, PhotoScore>();
  for (const a of assets) {
    const an = a.analysis;
    const sharpness = an ? pct(an.sharpness) : 0.5;
    const exposure = an ? clamp(1 - Math.abs(an.meanLuma - 0.48) * 1.6 - an.clippedHighlights * 2 - an.clippedShadows * 1.5, 0, 1) : 0.5;
    const megapixels = (a.widthPx * a.heightPx) / 1e6;
    const resolution = clamp(megapixels / 8, 0, 1);
    // Small images measure deceptively sharp at thumbnail scale, so low pixel counts are discounted.
    const quality = (0.55 * sharpness + 0.3 * exposure + 0.15 * resolution) * (megapixels < 2 ? 0.6 : 1);
    const total = quality + clamp(a.rating, 0, 5) * 0.12 + (a.favorite ? 1 : 0);
    out.set(a.id, { quality, total });
  }
  return out;
}

/**
 * Chronological order. Photos without a capture date keep their file-name order and go last,
 * so a few undated scans never scramble an otherwise dated trip.
 */
export function chronological(assets: PhotoAsset[]): PhotoAsset[] {
  const byName = (a: PhotoAsset, b: PhotoAsset) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
  const dated = assets.filter((a) => !Number.isNaN(timeOf(a))).sort((a, b) => timeOf(a) - timeOf(b) || byName(a, b));
  const undated = assets.filter((a) => Number.isNaN(timeOf(a))).sort(byName);
  return [...dated, ...undated];
}

/** Split a chronological sequence wherever the time gap exceeds `gapHours`. */
export function segmentMoments(seq: PhotoAsset[], gapHours = 3): PhotoAsset[][] {
  const out: PhotoAsset[][] = [];
  let cur: PhotoAsset[] = [];
  let last = NaN;
  for (const a of seq) {
    const t = timeOf(a);
    if (cur.length && (Number.isNaN(t) !== Number.isNaN(last) || (!Number.isNaN(t) && t - last > gapHours * 3_600_000))) {
      out.push(cur);
      cur = [];
    }
    cur.push(a);
    last = t;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Local calendar day key, e.g. "2026-03-14"; null for undated. */
export function dayKey(a: Pick<PhotoAsset, 'capturedAt'>): string | null {
  if (!a.capturedAt) return null;
  // capturedAt is stored as local wall-clock time without zone (EXIF has no zone), so slice is exact.
  return a.capturedAt.slice(0, 10);
}

export const aspectOf = (a: Pick<PhotoAsset, 'widthPx' | 'heightPx'>) => a.widthPx / a.heightPx;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "14 – 19 March 2026", "30 March – 2 April 2026", or "14 March 2026". */
export function formatDayRange(first: string, last: string): string {
  if (first === last) return formatDay(first);
  const [y1, m1, d1] = first.split('-').map(Number);
  const [y2, m2, d2] = last.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${formatDay(first)} – ${formatDay(last)}`;
}

export function dateRangeOf(assets: PhotoAsset[]): string {
  const days = assets.map(dayKey).filter((d): d is string => !!d).sort();
  return days.length ? formatDayRange(days[0], days[days.length - 1]) : '';
}
