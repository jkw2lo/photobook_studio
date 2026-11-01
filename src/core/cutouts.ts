import polygonClipping, { type MultiPolygon, type Pair, type Polygon, type Ring } from 'polygon-clipping';

// Photos cut by hand in the desktop editor: an outline to keep minus erased areas, stored in
// fractions of the frame. This draws them (the editing tools live in the desktop version).

export interface Pt {
  x: number;
  y: number;
}

/**
 * The outline left by a hand cut, in a w × h frame: the area kept (or the whole frame) minus every
 * erased area, as one path (even-odd, so islands and holes come out right).
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
