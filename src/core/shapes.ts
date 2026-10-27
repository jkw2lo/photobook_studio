// Shape library: shapes, banners, lines and icons, drawn as vector paths in a 100 × 100 box. The
// same path data is used for colour shapes, for cutting photos to a shape, by the editor (SVG) and
// by the PDF exporter, so what you see is what prints. Paths use absolute M / L / C / Q / Z only,
// which keeps scaling to any frame (scalePath) a matter of scaling numbers.

export type ShapeCategory = 'shape' | 'banner' | 'line' | 'icon';

export interface ShapeDef {
  id: string;
  name: string;
  category: ShapeCategory;
  d: string;
  /** Natural width / height, for sizing a newly added element. */
  aspect: number;
  /** Holes are cut by overlapping sub-paths (even-odd fill). */
  evenOdd?: boolean;
  /** Can photos be cut to it? (Thin lines and dotted rows make poor photo shapes.) */
  photoMask?: boolean;
}

// ---- path helpers --------------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (x: number, y: number) => `${r2(x)} ${r2(y)}`;
const K = 0.5523; // cubic Bézier circle constant

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K;
  const ky = ry * K;
  return [
    `M${pt(cx, cy - ry)}`,
    `C${pt(cx + kx, cy - ry)} ${pt(cx + rx, cy - ky)} ${pt(cx + rx, cy)}`,
    `C${pt(cx + rx, cy + ky)} ${pt(cx + kx, cy + ry)} ${pt(cx, cy + ry)}`,
    `C${pt(cx - kx, cy + ry)} ${pt(cx - rx, cy + ky)} ${pt(cx - rx, cy)}`,
    `C${pt(cx - rx, cy - ky)} ${pt(cx - kx, cy - ry)} ${pt(cx, cy - ry)}Z`,
  ].join('');
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = r * (1 - K);
  return [
    `M${pt(x + r, y)}L${pt(x + w - r, y)}C${pt(x + w - k, y)} ${pt(x + w, y + k)} ${pt(x + w, y + r)}`,
    `L${pt(x + w, y + h - r)}C${pt(x + w, y + h - k)} ${pt(x + w - k, y + h)} ${pt(x + w - r, y + h)}`,
    `L${pt(x + r, y + h)}C${pt(x + k, y + h)} ${pt(x, y + h - k)} ${pt(x, y + h - r)}`,
    `L${pt(x, y + r)}C${pt(x, y + k)} ${pt(x + k, y)} ${pt(x + r, y)}Z`,
  ].join('');
}

const rect = (x: number, y: number, w: number, h: number) => `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + h)}L${pt(x, y + h)}Z`;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => pt(x, y)).join('L')}Z`;

/** Regular star / starburst / polygon centred in the box. */
function star(points: number, outer: number, inner: number, cx = 50, cy = 50, rot = -90): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts);
}

function polygon(sides: number, r: number, rot = -90): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rot + (i * 360) / sides) * Math.PI) / 180;
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return poly(pts);
}

const HEART = 'M50 92C46 88 6 62 6 34C6 18 18 8 31 8C40 8 46 13 50 20C54 13 60 8 69 8C82 8 94 18 94 34C94 62 54 88 50 92Z';

function sun(): string {
  let d = ellipse(50, 50, 22, 22);
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    const w = (8 * Math.PI) / 180;
    d += poly([
      [50 + 28 * Math.cos(a - w), 50 + 28 * Math.sin(a - w)],
      [50 + 46 * Math.cos(a), 50 + 46 * Math.sin(a)],
      [50 + 28 * Math.cos(a + w), 50 + 28 * Math.sin(a + w)],
    ]);
  }
  return d;
}

function flower(): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * 60 * Math.PI) / 180;
    const cx = 50 + 24 * Math.cos(a);
    const cy = 50 + 24 * Math.sin(a);
    d += ellipse(cx, cy, 17, 17);
  }
  return d + ellipse(50, 50, 14, 14);
}

function dots(n: number): string {
  let d = '';
  const step = 100 / n;
  // Drawn in a box n times wider than tall, so stretch each dot's height by n to keep it round.
  for (let i = 0; i < n; i++) d += ellipse(step * (i + 0.5), 50, step * 0.3, step * 0.3 * n);
  return d;
}

function wavyLine(): string {
  // A band that undulates: top edge forward, bottom edge back.
  let top = 'M0 40';
  let bottom = '';
  const waves = 4;
  for (let i = 0; i < waves; i++) {
    const x0 = (i * 100) / waves;
    const x1 = ((i + 1) * 100) / waves;
    top += `Q${pt((x0 + x1) / 2, i % 2 ? 80 : 0)} ${pt(x1, 40)}`;
  }
  bottom = 'L100 60';
  for (let i = waves - 1; i >= 0; i--) {
    const x0 = (i * 100) / waves;
    const x1 = ((i + 1) * 100) / waves;
    bottom += `Q${pt((x0 + x1) / 2, i % 2 ? 100 : 20)} ${pt(x0, 60)}`;
  }
  return `${top}${bottom}Z`;
}

// ---- the library -------------------------------------------------------------------------------

export const SHAPES: ShapeDef[] = [
  // Shapes (all work as photo shapes too)
  { id: 'rect', name: 'Rectangle', category: 'shape', d: rect(0, 0, 100, 100), aspect: 1.5, photoMask: true },
  { id: 'rounded', name: 'Rounded', category: 'shape', d: roundRect(0, 0, 100, 100, 14), aspect: 1.5, photoMask: true },
  { id: 'circle', name: 'Circle', category: 'shape', d: ellipse(50, 50, 50, 50), aspect: 1, photoMask: true },
  { id: 'arch', name: 'Arch', category: 'shape', d: 'M0 100L0 50C0 22 22 0 50 0C78 0 100 22 100 50L100 100Z', aspect: 0.75, photoMask: true },
  { id: 'heart', name: 'Heart', category: 'shape', d: HEART, aspect: 1.05, photoMask: true },
  { id: 'star', name: 'Star', category: 'shape', d: star(5, 50, 21, 50, 53), aspect: 1, photoMask: true },
  { id: 'hexagon', name: 'Hexagon', category: 'shape', d: polygon(6, 50, 0), aspect: 1.15, photoMask: true },
  { id: 'diamond', name: 'Diamond', category: 'shape', d: poly([[50, 0], [100, 50], [50, 100], [0, 50]]), aspect: 1, photoMask: true },
  { id: 'triangle', name: 'Triangle', category: 'shape', d: poly([[50, 0], [100, 100], [0, 100]]), aspect: 1.15, photoMask: true },
  { id: 'blob', name: 'Blob', category: 'shape', d: 'M52 2C74 0 96 14 98 38C100 60 88 70 82 84C74 98 52 100 34 96C14 92 2 78 2 58C2 40 10 32 18 20C26 8 36 3 52 2Z', aspect: 1.1, photoMask: true },
  { id: 'scallop', name: 'Scallop', category: 'shape', d: scallop(), aspect: 1, photoMask: true },
  { id: 'bubble', name: 'Speech bubble', category: 'shape', d: 'M12 4L88 4C94 4 98 8 98 14L98 62C98 68 94 72 88 72L44 72L22 96L26 72L12 72C6 72 2 68 2 62L2 14C2 8 6 4 12 4Z', aspect: 1.3 },
  { id: 'frame', name: 'Frame', category: 'shape', d: rect(0, 0, 100, 100) + rect(6, 6, 88, 88), aspect: 0.8, evenOdd: true },
  { id: 'ring', name: 'Ring', category: 'shape', d: ellipse(50, 50, 50, 50) + ellipse(50, 50, 42, 42), aspect: 1, evenOdd: true },

  // Banners (text goes on top)
  { id: 'ribbon', name: 'Ribbon', category: 'banner', d: poly([[14, 22], [86, 22], [86, 78], [14, 78]]) + poly([[0, 34], [18, 34], [18, 90], [0, 90], [8, 62]]) + poly([[82, 34], [100, 34], [92, 62], [100, 90], [82, 90]]), aspect: 4.5 },
  { id: 'pennant', name: 'Pennant', category: 'banner', d: poly([[0, 0], [100, 50], [0, 100]]), aspect: 2.2 },
  { id: 'flag', name: 'Flag', category: 'banner', d: poly([[0, 0], [100, 0], [86, 50], [100, 100], [0, 100]]), aspect: 3 },
  { id: 'tag', name: 'Tag', category: 'banner', d: poly([[22, 0], [100, 0], [100, 100], [22, 100], [0, 50]]) + ellipse(16, 50, 5, 5 * 2.8), aspect: 2.8, evenOdd: true },
  { id: 'pill', name: 'Pill', category: 'banner', d: roundRect(0, 0, 100, 100, 50), aspect: 3.5 },
  { id: 'ticket', name: 'Ticket', category: 'banner', d: 'M0 0L100 0L100 36C94 36 90 42 90 50C90 58 94 64 100 64L100 100L0 100L0 64C6 64 10 58 10 50C10 42 6 36 0 36Z', aspect: 2.6 },
  { id: 'chevron', name: 'Arrow banner', category: 'banner', d: poly([[0, 0], [88, 0], [100, 50], [88, 100], [0, 100], [12, 50]]), aspect: 4 },
  { id: 'seal', name: 'Seal', category: 'banner', d: star(24, 50, 43), aspect: 1, photoMask: true },
  { id: 'burst', name: 'Starburst', category: 'banner', d: star(14, 50, 32), aspect: 1, photoMask: true },

  // Lines and dividers
  { id: 'line', name: 'Line', category: 'line', d: rect(0, 0, 100, 100), aspect: 60 },
  { id: 'double', name: 'Double line', category: 'line', d: rect(0, 0, 100, 30) + rect(0, 70, 100, 30), aspect: 40 },
  { id: 'dots', name: 'Dotted', category: 'line', d: dots(12), aspect: 12 },
  { id: 'wave', name: 'Wavy', category: 'line', d: wavyLine(), aspect: 10 },
  { id: 'corners', name: 'Corners', category: 'line', d: poly([[0, 0], [30, 0], [30, 4], [4, 4], [4, 30], [0, 30]]) + poly([[100, 100], [70, 100], [70, 96], [96, 96], [96, 70], [100, 70]]), aspect: 1.4 },

  // Icons
  { id: 'i-heart', name: 'Heart', category: 'icon', d: HEART, aspect: 1.05 },
  { id: 'i-star', name: 'Star', category: 'icon', d: star(5, 50, 21, 50, 53), aspect: 1 },
  { id: 'i-sparkle', name: 'Sparkle', category: 'icon', d: 'M50 0Q55 45 100 50Q55 55 50 100Q45 55 0 50Q45 45 50 0Z', aspect: 1 },
  { id: 'i-sun', name: 'Sun', category: 'icon', d: sun(), aspect: 1 },
  { id: 'i-moon', name: 'Moon', category: 'icon', d: 'M62 4C40 8 24 27 24 50C24 73 40 92 62 96C56 98 50 99 44 98C20 94 2 74 2 50C2 26 20 6 44 2C50 1 56 2 62 4Z', aspect: 0.65 },
  { id: 'i-cloud', name: 'Cloud', category: 'icon', d: ellipse(32, 62, 24, 22) + ellipse(56, 44, 28, 28) + ellipse(76, 64, 22, 20) + rect(30, 62, 48, 22), aspect: 1.5 },
  { id: 'i-flower', name: 'Flower', category: 'icon', d: flower(), aspect: 1 },
  { id: 'i-leaf', name: 'Leaf', category: 'icon', d: 'M10 92Q8 30 60 10Q86 2 96 4Q98 14 90 40Q70 92 10 92Z', aspect: 1 },
  { id: 'i-pin', name: 'Map pin', category: 'icon', d: 'M50 100C44 90 14 60 14 36C14 16 30 0 50 0C70 0 86 16 86 36C86 60 56 90 50 100Z' + ellipse(50, 36, 14, 14), aspect: 0.72, evenOdd: true },
  { id: 'i-plane', name: 'Plane', category: 'icon', d: poly([[46, 4], [54, 4], [56, 38], [96, 60], [96, 68], [56, 56], [55, 82], [68, 92], [68, 98], [50, 93], [32, 98], [32, 92], [45, 82], [44, 56], [4, 68], [4, 60], [44, 38]]), aspect: 1 },
  { id: 'i-camera', name: 'Camera', category: 'icon', d: roundRect(0, 22, 100, 72, 10) + ellipse(50, 58, 22, 22) + ellipse(50, 58, 14, 14) + poly([[32, 22], [38, 8], [62, 8], [68, 22]]), aspect: 1.3, evenOdd: true },
  { id: 'i-music', name: 'Music', category: 'icon', d: ellipse(26, 80, 18, 14) + rect(36, 10, 8, 70) + poly([[36, 10], [90, 0], [90, 24], [44, 32]]) + ellipse(78, 70, 18, 14) + rect(88, 2, 8, 66), aspect: 1 },
  { id: 'i-mountain', name: 'Mountains', category: 'icon', d: poly([[0, 100], [36, 24], [56, 64], [70, 44], [100, 100]]), aspect: 1.4 },
  { id: 'i-wave', name: 'Wave', category: 'icon', d: 'M0 60Q12 40 25 60Q37 80 50 60Q62 40 75 60Q87 80 100 60L100 100L0 100Z', aspect: 2 },
  { id: 'i-house', name: 'Home', category: 'icon', d: poly([[50, 0], [100, 44], [88, 44], [88, 100], [12, 100], [12, 44], [0, 44]]) + rect(40, 62, 20, 38), aspect: 1, evenOdd: true },
  { id: 'i-cup', name: 'Coffee', category: 'icon', d: 'M6 20L74 20L68 92C68 96 64 100 60 100L20 100C16 100 12 96 12 92Z' + 'M74 32C90 32 98 40 98 52C98 66 88 74 72 74L72 64C82 64 88 60 88 52C88 46 84 42 74 42Z', aspect: 1.1 },
  { id: 'i-gift', name: 'Gift', category: 'icon', d: rect(4, 30, 92, 20) + rect(10, 50, 80, 50) + poly([[50, 30], [30, 6], [22, 14], [42, 30]]) + poly([[50, 30], [70, 6], [78, 14], [58, 30]]), aspect: 1 },
  { id: 'i-check', name: 'Tick', category: 'icon', d: poly([[0, 54], [14, 40], [36, 62], [86, 10], [100, 24], [36, 88]]), aspect: 1.15 },
  { id: 'i-arrow', name: 'Arrow', category: 'icon', d: poly([[0, 38], [62, 38], [62, 10], [100, 50], [62, 90], [62, 62], [0, 62]]), aspect: 1.6 },
  { id: 'i-palm', name: 'Palm', category: 'icon', d: 'M48 100L54 100Q58 70 54 42L50 42Q52 70 48 100Z' + 'M52 42Q30 18 4 30Q28 26 52 42Z' + 'M52 42Q70 14 98 24Q74 24 52 42Z' + 'M52 42Q46 10 64 0Q56 18 52 42Z' + 'M52 42Q20 40 10 62Q30 44 52 42Z' + 'M52 42Q84 40 94 64Q74 46 52 42Z', aspect: 1 },
];

function scallop(): string {
  // Circle with a scalloped edge: 16 bumps.
  const n = 16;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = ((i + 1) / n) * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    // Control points stay inside the box, so the shape fills its frame without overhang.
    const p0 = [50 + 40 * Math.cos(a0), 50 + 40 * Math.sin(a0)];
    const p1 = [50 + 40 * Math.cos(a1), 50 + 40 * Math.sin(a1)];
    const c = [50 + 50 * Math.cos(am), 50 + 50 * Math.sin(am)];
    d += (i === 0 ? `M${pt(p0[0], p0[1])}` : '') + `Q${pt(c[0], c[1])} ${pt(p1[0], p1[1])}`;
  }
  return `${d}Z`;
}

export const SHAPE_CATEGORIES: { id: ShapeCategory; label: string }[] = [
  { id: 'shape', label: 'Shapes' },
  { id: 'banner', label: 'Banners' },
  { id: 'line', label: 'Lines' },
  { id: 'icon', label: 'Icons' },
];

export const PHOTO_SHAPES = SHAPES.filter((s) => s.photoMask);

export function shapeDef(id: string | undefined): ShapeDef {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0];
}

// ---- scaling -------------------------------------------------------------------------------------

/** Every coordinate pair in a path made of absolute M/L/C/Q/Z commands, mapped through `f`. */
export function mapPath(d: string, f: (x: number, y: number) => [number, number]): string {
  const out: string[] = [];
  const re = /([MLCQZ])([^MLCQZ]*)/gi;
  for (const m of d.matchAll(re)) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const pairs: string[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const [x, y] = f(nums[i], nums[i + 1]);
      pairs.push(`${r2(x)} ${r2(y)}`);
    }
    out.push(cmd + pairs.join(' '));
  }
  return out.join('');
}

/** A library path (100 × 100 box) stretched to a w × h box. */
export function scalePath(d: string, w: number, h: number): string {
  return mapPath(d, (x, y) => [(x / 100) * w, (y / 100) * h]);
}

/**
 * A path drawn in a srcW × srcH box, scaled uniformly to fit inside w × h and centred (text
 * outlines keep their proportions).
 */
export function fitPath(d: string, srcW: number, srcH: number, w: number, h: number): string {
  const s = Math.min(w / srcW, h / srcH);
  const ox = (w - srcW * s) / 2;
  const oy = (h - srcH * s) / 2;
  return mapPath(d, (x, y) => [ox + x * s, oy + y * s]);
}

/** The outline of a photo mask in a w × h frame (frame-local units). */
export function maskPath(mask: { kind: 'shape'; shape: string } | { kind: 'text' | 'outline'; d: string; aspect: number }, w: number, h: number): { d: string; evenOdd: boolean } {
  if (mask.kind !== 'shape') return { d: fitPath(mask.d, 100 * mask.aspect, 100, w, h), evenOdd: false };
  const def = shapeDef(mask.shape);
  return { d: scalePath(def.d, w, h), evenOdd: !!def.evenOdd };
}

/** The path of a shape element in a w × h box: its place outline (fitted) or its library shape (stretched). */
export function shapePath(el: { shape?: string; outline?: { d: string; aspect: number } }, w: number, h: number): { d: string; evenOdd: boolean } {
  if (el.outline) return { d: fitPath(el.outline.d, 100 * el.outline.aspect, 100, w, h), evenOdd: false };
  const def = shapeDef(el.shape);
  return { d: scalePath(def.d, w, h), evenOdd: !!def.evenOdd };
}

/** Endpoints of a CSS-style linear gradient across a w × h box (y down). */
export function gradientLine(angleDeg: number, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return { x1: w / 2 - dx * half, y1: h / 2 - dy * half, x2: w / 2 + dx * half, y2: h / 2 + dy * half };
}
