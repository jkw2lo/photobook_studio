import polygonClipping, { type MultiPolygon, type Pair, type Polygon, type Ring } from 'polygon-clipping';
import type { ImageElement, PhotoMask, Rect } from './model';

// Freeform photo areas: a collage that fills an outline drawn on the sheet. The photos are laid out
// in bands that follow the outline's width, then the frames along the edge are cut to the outline,
// so the collage takes its shape exactly.

export interface Pt {
  x: number;
  y: number;
}

/** Signed area (positive or negative depending on winding); use Math.abs. */
export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
}

export function polygonBounds(poly: Pt[]): Rect {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Where a horizontal line crosses the outline: [from, to] runs inside it, left to right. */
function scanline(poly: Pt[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  xs.sort((p, q) => p - q);
  const runs: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) runs.push([xs[i], xs[i + 1]]);
  return runs;
}

/**
 * Rectangles that follow the outline: `count` horizontal bands across `box`, `gap` apart, each cut
 * to where the outline is across that band (two lobes give two pieces). Pieces reach the outline's
 * widest point in their band, so cutting them to the outline leaves no gaps.
 */
export function outlineBands(poly: Pt[], box: Rect, count: number, gap: number, minSize: number): Rect[] {
  const n = Math.max(1, Math.round(count));
  const bandH = (box.h - gap * (n - 1)) / n;
  if (bandH <= 0) return [];
  const out: Rect[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = box.y + k * (bandH + gap);
    const y1 = y0 + bandH;
    const samples = [0.02, 0.25, 0.5, 0.75, 0.98].map((t) => scanline(poly, y0 + t * bandH));
    // Pieces are the runs at the band's middle, widened by the runs they overlap above and below.
    for (const [a0, a1] of samples[2].length ? samples[2] : samples.flat()) {
      let lo = a0;
      let hi = a1;
      for (const runs of samples) for (const [b0, b1] of runs) if (b0 < hi && b1 > lo) [lo, hi] = [Math.min(lo, b0), Math.max(hi, b1)];
      lo = Math.max(lo, box.x);
      hi = Math.min(hi, box.x + box.w);
      if (hi - lo >= minSize && !out.some((r) => r.y === y0 && r.x < hi && r.x + r.w > lo)) out.push({ x: lo, y: y0, w: hi - lo, h: bandH });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The part of the outline inside a rectangle (Sutherland–Hodgman). */
export function clipToRect(poly: Pt[], r: Rect): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p.x >= r.x, (a, b) => ({ x: r.x, y: a.y + ((r.x - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.x <= r.x + r.w, (a, b) => ({ x: r.x + r.w, y: a.y + ((r.x + r.w - a.x) / (b.x - a.x)) * (b.y - a.y) })],
    [(p) => p.y >= r.y, (a, b) => ({ x: a.x + ((r.y - a.y) / (b.y - a.y)) * (b.x - a.x), y: r.y })],
    [(p) => p.y <= r.y + r.h, (a, b) => ({ x: a.x + ((r.y + r.h - a.y) / (b.y - a.y)) * (b.x - a.x), y: r.y + r.h })],
  ];
  let out = poly;
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/**
 * Cut a collage frame to the outline. Returns the frame unchanged when it's (all but) inside, null
 * when hardly any of it is (it's left out), or the frame with an outline mask in its own units.
 */
export function cutToOutline(el: ImageElement, poly: Pt[]): ImageElement | null {
  const r = { x: el.xMm, y: el.yMm, w: el.widthMm, h: el.heightMm };
  const part = clipToRect(poly, r);
  const area = part.length >= 3 ? Math.abs(polygonArea(part)) : 0;
  const share = area / (r.w * r.h);
  if (share < 0.2) return null;
  if (share > 0.995 || el.rotationDeg || el.mask) return el;
  // Mask outlines are 100 units tall and `aspect` × 100 wide: the frame's own shape, so nothing stretches.
  const k = 100 / r.h;
  const d = part.map((p, i) => `${i ? 'L' : 'M'}${((p.x - r.x) * k).toFixed(2)} ${((p.y - r.y) * k).toFixed(2)}`).join(' ') + ' Z';
  const mask: PhotoMask = { kind: 'outline', name: 'Photo area', d, aspect: r.w / r.h };
  return { ...el, mask, borderMm: 0 };
}

/**
 * A drawn outline made tidy: points closer than `minStep` to the last kept one are dropped, then
 * nearly-straight runs are thinned (Douglas–Peucker, `tolerance`), up to `max` points.
 */
export function simplifyOutline(points: Pt[], minStep: number, tolerance: number, max = 160): Pt[] {
  const spaced: Pt[] = [];
  for (const p of points) if (!spaced.length || Math.hypot(p.x - spaced[spaced.length - 1].x, p.y - spaced[spaced.length - 1].y) >= minStep) spaced.push(p);
  if (spaced.length < 4) return spaced;
  const keep = new Array(spaced.length).fill(false);
  keep[0] = keep[spaced.length - 1] = true;
  const dp = (i: number, j: number) => {
    let best = -1;
    let at = -1;
    const a = spaced[i];
    const b = spaced[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    for (let k = i + 1; k < j; k++) {
      const p = spaced[k];
      const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
      if (d > best) [best, at] = [d, k];
    }
    if (best > tolerance && at > 0) {
      keep[at] = true;
      dp(i, at);
      dp(at, j);
    }
  };
  dp(0, spaced.length - 1);
  let out = spaced.filter((_, i) => keep[i]);
  while (out.length > max) out = out.filter((_, i) => i % 2 === 0);
  return out;
}

/**
 * The outline left by a hand cut, in a w × h frame: the area kept (or the whole frame) minus every
 * erased area, as one path (even-odd, so islands and holes come out right). Self-crossing lassos
 * and overlapping erasers are merged first.
 */
export function cutPath(mask: { keep?: Pt[]; erase: Pt[][] }, w: number, h: number): string {
  const ring = (pts: Pt[]): Ring => pts.map((p) => [p.x * w, p.y * h] as Pair);
  const frame: Ring = [[0, 0], [w, 0], [w, h], [0, h]];
  let kept: MultiPolygon = mask.keep && mask.keep.length >= 3 ? polygonClipping.intersection([ring(mask.keep)], [frame]) : [[frame]];
  const erase = mask.erase.filter((e) => e.length >= 3).map((e) => [ring(e)] as Polygon);
  if (erase.length && kept.length) kept = polygonClipping.difference(kept, ...erase);
  const f = (n: number) => Math.round(n * 100) / 100;
  const d = kept.flatMap((poly) => poly.map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z')).join(' ');
  return d || 'M0 0 Z';
}

/** A circle (centre and radius in mm) as an outline in frame fractions, for the eraser. */
export function circleOutline(cx: number, cy: number, r: number, frameW: number, frameH: number, steps = 40): Pt[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return { x: (cx + r * Math.cos(a)) / frameW, y: (cy + r * Math.sin(a)) / frameH };
  });
}
