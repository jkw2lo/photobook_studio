import type { Rect, SurfacePattern } from './model';
import { mapPath } from './shapes';

// Background patterns: a tile repeated across a page — dots, stripes, checks, waves, stars,
// halftone… — in one colour or a gradient, at any size and angle, over the background colour and
// photo and under everything else. The editor and the PDF draw the same vector shapes (one path,
// built here), so the pattern prints exactly as it shows.

export interface PatternDef {
  id: string;
  name: string;
  /** Tile size in pattern units, and the shape(s) inside it (M / L / C / Q / Z only). */
  w: number;
  h: number;
  d: string;
  /** Each tile's shape shrinks across the page (a halftone fade). */
  fade?: boolean;
}

const K = 0.5523;
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}C${cx - r} ${cy - r * K} ${cx - r * K} ${cy - r} ${cx} ${cy - r}C${cx + r * K} ${cy - r} ${cx + r} ${cy - r * K} ${cx + r} ${cy}C${cx + r} ${cy + r * K} ${cx + r * K} ${cy + r} ${cx} ${cy + r}C${cx - r * K} ${cy + r} ${cx - r} ${cy + r * K} ${cx - r} ${cy}Z`;
const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * 2 * Math.PI - Math.PI / 2;
    pts.push([Math.round((cx + r * Math.cos(a)) * 1000) / 1000, Math.round((cy + r * Math.sin(a)) * 1000) / 1000]);
  }
  return poly(pts);
}
const heart = (cx: number, cy: number, s: number) =>
  mapPath('M50 92C46 88 6 62 6 34C6 18 18 8 31 8C40 8 46 13 50 20C54 13 60 8 69 8C82 8 94 18 94 34C94 62 54 88 50 92Z', (x, y) => [cx + ((x - 50) / 100) * s, cy + ((y - 50) / 100) * s]);

export const PATTERNS: PatternDef[] = [
  { id: 'dots', name: 'Dots', w: 1, h: 1, d: circle(0.5, 0.5, 0.17) },
  { id: 'polka', name: 'Polka', w: 1, h: 1, d: circle(0.25, 0.25, 0.13) + circle(0.75, 0.75, 0.13) },
  { id: 'halftone', name: 'Halftone', w: 1, h: 1, d: circle(0.5, 0.5, 0.42), fade: true },
  { id: 'stripes', name: 'Stripes', w: 1, h: 1, d: rect(0, 0, 1, 0.5) },
  { id: 'pinstripe', name: 'Pinstripe', w: 1, h: 1, d: rect(0, 0, 1, 0.1) },
  { id: 'grid', name: 'Grid', w: 1, h: 1, d: rect(0, 0, 1, 0.06) + rect(0, 0.06, 0.06, 0.94) },
  { id: 'checks', name: 'Checks', w: 1, h: 1, d: rect(0, 0, 0.5, 0.5) + rect(0.5, 0.5, 0.5, 0.5) },
  { id: 'gingham', name: 'Gingham', w: 1, h: 1, d: rect(0, 0, 1, 0.33) + rect(0, 0.33, 0.33, 0.67) },
  { id: 'waves', name: 'Waves', w: 1, h: 0.5, d: 'M0 0.2C0.25 0 0.25 0 0.5 0.2C0.75 0.4 0.75 0.4 1 0.2L1 0.32C0.75 0.52 0.75 0.52 0.5 0.32C0.25 0.12 0.25 0.12 0 0.32Z' },
  { id: 'zigzag', name: 'Zigzag', w: 1, h: 0.6, d: poly([[0, 0.4], [0.5, 0], [1, 0.4], [1, 0.58], [0.5, 0.18], [0, 0.58]]) },
  { id: 'scales', name: 'Scales', w: 1, h: 0.5, d: 'M0 0.5C0 0.22 0.22 0 0.5 0C0.78 0 1 0.22 1 0.5L0.9 0.5C0.9 0.28 0.72 0.1 0.5 0.1C0.28 0.1 0.1 0.28 0.1 0.5Z' },
  { id: 'triangles', name: 'Triangles', w: 1, h: 1, d: poly([[0.1, 0.9], [0.5, 0.15], [0.9, 0.9]]) },
  { id: 'diamonds', name: 'Diamonds', w: 1, h: 1, d: poly([[0.5, 0.08], [0.92, 0.5], [0.5, 0.92], [0.08, 0.5]]) },
  { id: 'crosses', name: 'Crosses', w: 1, h: 1, d: poly([[0.42, 0.25], [0.58, 0.25], [0.58, 0.42], [0.75, 0.42], [0.75, 0.58], [0.58, 0.58], [0.58, 0.75], [0.42, 0.75], [0.42, 0.58], [0.25, 0.58], [0.25, 0.42], [0.42, 0.42]]) },
  { id: 'stars', name: 'Stars', w: 1, h: 1, d: starPath(0.5, 0.52, 0.3, 0.13) },
  { id: 'hearts', name: 'Hearts', w: 1, h: 1, d: heart(0.5, 0.5, 0.62) },
  { id: 'sparkles', name: 'Sparkles', w: 1, h: 1, d: 'M0.5 0.18Q0.53 0.47 0.82 0.5Q0.53 0.53 0.5 0.82Q0.47 0.53 0.18 0.5Q0.47 0.47 0.5 0.18Z' + 'M0.12 0.1Q0.13 0.17 0.2 0.18Q0.13 0.19 0.12 0.26Q0.11 0.19 0.04 0.18Q0.11 0.17 0.12 0.1Z' },
  { id: 'rays', name: 'Sun rays', w: 1, h: 1, d: poly([[0, 0], [0.5, 0], [0.5, 1], [0, 1]]) },
  { id: 'terrazzo', name: 'Terrazzo', w: 1, h: 1, d: poly([[0.1, 0.15], [0.24, 0.1], [0.28, 0.24], [0.14, 0.27]]) + poly([[0.62, 0.2], [0.78, 0.26], [0.7, 0.36]]) + poly([[0.3, 0.62], [0.42, 0.58], [0.46, 0.74], [0.32, 0.78]]) + poly([[0.72, 0.66], [0.88, 0.7], [0.84, 0.84], [0.7, 0.8]]) + circle(0.5, 0.42, 0.04) + circle(0.12, 0.6, 0.03) },
];

export const patternDef = (id: string) => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];

/** The most tiles drawn: big pages with tiny patterns get slightly bigger tiles instead. */
const MAX_TILES = 4500;

/**
 * The pattern as one path covering `area` (surface mm), drawn in `space` coordinates (a rect in
 * surface mm whose top-left becomes 0,0). Tiles are laid out in the pattern's own grid — rotated by
 * its angle about the surface centre — and only those touching the area are kept.
 */
export function patternPath(p: SurfacePattern, surface: Rect, area: Rect = surface): string {
  const def = patternDef(p.id);
  // Sun rays aren't a tiled grid: they fan out from the centre.
  if (def.id === 'rays') return raysPath(p, surface, area);
  let size = Math.max(1, p.sizeMm);
  // Tiles are kept a little way past the area's edges too (for rotation), so count those as well;
  // the margin grows with the tile, so settle the size over a few rounds.
  for (let k = 0; k < 6; k++) {
    const est = ((area.w + 3 * size) * (area.h + 3 * size)) / (size * size * def.h);
    if (est <= MAX_TILES) break;
    size *= Math.sqrt(est / MAX_TILES) * 1.02;
  }
  const tw = size;
  const th = size * def.h;
  const cx = surface.x + surface.w / 2;
  const cy = surface.y + surface.h / 2;
  const a = ((p.angleDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Pattern space → surface: rotate about the surface centre.
  const toSurface = (u: number, v: number): [number, number] => [cx + u * cos - v * sin, cy + u * sin + v * cos];
  const R = Math.hypot(surface.w, surface.h) / 2 + Math.max(tw, th);
  const reach = Math.hypot(tw, th);
  const out: string[] = [];
  const f = (n: number) => Math.round(n * 100) / 100;
  for (let j = Math.floor(-R / th); j * th <= R; j++) {
    for (let i = Math.floor(-R / tw); i * tw <= R; i++) {
      const u0 = i * tw;
      const v0 = j * th;
      const [mx, my] = toSurface(u0 + tw / 2, v0 + th / 2);
      if (mx < area.x - reach || mx > area.x + area.w + reach || my < area.y - reach || my > area.y + area.h + reach) continue;
      // Halftone: dots shrink across the page, along the pattern's own x axis.
      const t = def.fade ? Math.min(1, Math.max(0, (u0 + tw / 2 + R) / (2 * R))) : 0;
      const k = def.fade ? 1 - 0.88 * t : 1;
      out.push(mapPath(def.d, (x, y) => {
        const u = u0 + (0.5 + (x / def.w - 0.5) * k) * tw;
        const v = v0 + (0.5 * def.h + (y - 0.5 * def.h) * k) / def.h * th;
        const [sx, sy] = toSurface(u, v);
        return [f(sx - surface.x), f(sy - surface.y)];
      }));
    }
  }
  return out.join('');
}

/** Rays fanning out from the surface centre: alternate wedges, `sizeMm` sets how many (wider = fewer). */
function raysPath(p: SurfacePattern, surface: Rect, _area: Rect): string {
  const cx = surface.w / 2;
  const cy = surface.h / 2;
  const R = Math.hypot(surface.w, surface.h);
  const n = Math.max(6, Math.min(72, Math.round((2 * Math.PI * Math.min(surface.w, surface.h) * 0.25) / Math.max(1, p.sizeMm)))) * 2;
  const a0 = ((p.angleDeg ?? 0) * Math.PI) / 180;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = '';
  for (let i = 0; i < n; i += 2) {
    const a1 = a0 + (i / n) * 2 * Math.PI;
    const a2 = a0 + ((i + 1) / n) * 2 * Math.PI;
    d += `M${f(cx)} ${f(cy)}L${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))}L${f(cx + R * Math.cos(a2))} ${f(cy + R * Math.sin(a2))}Z`;
  }
  return d;
}

/** A new pattern for a page: sized to the page, in its text colour, faint. */
export function defaultPattern(id: string, surfaceW: number, color: string): SurfacePattern {
  return { id, color, opacity: 0.18, sizeMm: Math.max(4, Math.round(surfaceW / 24)), angleDeg: id === 'stripes' || id === 'pinstripe' ? 45 : 0 };
}
