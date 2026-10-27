import type { Rect } from './model';

// Smart spacing while dragging: snap so the gap to a neighbour equals a gap that already exists
// between other items in the same row or column (or so an item sits exactly midway between two
// neighbours), and snap sizes to match another item's width or height while resizing.

export interface SpacingMark {
  axis: 'x' | 'y';
  /** The gap runs from `from` to `to` along the axis, drawn at `at` across it. */
  from: number;
  to: number;
  at: number;
}

const overlapY = (a: Rect, b: Rect) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
const overlapX = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0;

interface AxisOps {
  pos: (r: Rect) => number;
  size: (r: Rect) => number;
  overlap: (a: Rect, b: Rect) => boolean;
  cross: (a: Rect, b: Rect) => number;
}

const X: AxisOps = { pos: (r) => r.x, size: (r) => r.w, overlap: overlapY, cross: (a, b) => (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2 };
const Y: AxisOps = { pos: (r) => r.y, size: (r) => r.h, overlap: overlapX, cross: (a, b) => (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 };

function snapAxis(m: Rect, others: Rect[], threshold: number, ax: AxisOps, axis: 'x' | 'y'): { d: number; marks: SpacingMark[] } | null {
  const end = (r: Rect) => ax.pos(r) + ax.size(r);
  const row = others.filter((o) => ax.overlap(o, m));
  // Gaps that already exist between pairs of items in this row (neighbours only).
  const sorted = [...row].sort((a, b) => ax.pos(a) - ax.pos(b));
  const pairs: { a: Rect; b: Rect; gap: number }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gap = ax.pos(sorted[i + 1]) - end(sorted[i]);
    if (gap > 0.5 && ax.overlap(sorted[i], sorted[i + 1])) pairs.push({ a: sorted[i], b: sorted[i + 1], gap });
  }
  const before = row.filter((o) => end(o) <= ax.pos(m) + threshold).sort((a, b) => end(b) - end(a))[0];
  const after = row.filter((o) => ax.pos(o) >= end(m) - threshold).sort((a, b) => ax.pos(a) - ax.pos(b))[0];
  let best: { d: number; marks: SpacingMark[] } | null = null;
  const consider = (d: number, marks: SpacingMark[]) => {
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, marks };
  };
  const markFor = (a: Rect, b: Rect): SpacingMark => ({ axis, from: end(a), to: ax.pos(b), at: ax.cross(a, b) });
  // Midway between the two neighbours.
  if (before && after) {
    const space = ax.pos(after) - end(before) - ax.size(m);
    if (space > 0) {
      const want = end(before) + space / 2;
      const d = want - ax.pos(m);
      const moved = { ...m, [axis]: ax.pos(m) + d } as Rect;
      consider(d, [markFor(before, moved), markFor(moved, after)]);
    }
  }
  // Same gap as an existing pair, on either side.
  for (const p of pairs) {
    // Skip the gap the moving item sits in (between its own two neighbours).
    if (p.a === before && p.b === after) continue;
    if (before) {
      const d = end(before) + p.gap - ax.pos(m);
      const moved = { ...m, [axis]: ax.pos(m) + d } as Rect;
      consider(d, [markFor(before, moved), markFor(p.a, p.b)]);
    }
    if (after) {
      const d = ax.pos(after) - p.gap - end(m);
      const moved = { ...m, [axis]: ax.pos(m) + d } as Rect;
      consider(d, [markFor(moved, after), markFor(p.a, p.b)]);
    }
  }
  return best;
}

/** Spacing snap for a box being moved, per axis; null on an axis when nothing is close. */
export function spacingSnap(m: Rect, others: Rect[], threshold: number): { x: { d: number; marks: SpacingMark[] } | null; y: { d: number; marks: SpacingMark[] } | null } {
  return { x: snapAxis(m, others, threshold, X, 'x'), y: snapAxis(m, others, threshold, Y, 'y') };
}

/** Snap a size being dragged to another item's width or height. */
export function sizeSnap(w: number, h: number, others: Rect[], threshold: number): { w: number; h: number; matchW?: Rect; matchH?: Rect } {
  let out: { w: number; h: number; matchW?: Rect; matchH?: Rect } = { w, h };
  let bw = threshold;
  let bh = threshold;
  for (const o of others) {
    if (Math.abs(o.w - w) < bw) {
      bw = Math.abs(o.w - w);
      out = { ...out, w: o.w, matchW: o };
    }
    if (Math.abs(o.h - h) < bh) {
      bh = Math.abs(o.h - h);
      out = { ...out, h: o.h, matchH: o };
    }
  }
  return out;
}
