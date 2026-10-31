import type { TextElement } from './model';

// Arched text: the baseline follows a circular arc across the text box. The editor draws it with an
// SVG <textPath> on `path`; the PDF exporter places each glyph along the same circle using the
// font's advances, so both agree.

export interface ArchGeometry {
  /** SVG path of the baseline arc, left end to right end (box-local mm). */
  path: string;
  cx: number;
  cy: number;
  r: number;
  /** Angle (radians, y down) of the left end of the arc, and +1 / −1 for left → right. */
  startAngle: number;
  dir: 1 | -1;
  length: number;
}

/**
 * `arch` −100…100: positive bends up like a rainbow (∩), negative like a smile (∪). The arc spans
 * the box width; at ±100 it is a half circle. The text block stays vertically centred.
 */
export function archGeometry(w: number, h: number, arch: number, fontSizeMm: number): ArchGeometry | null {
  if (!arch || Math.abs(arch) < 1 || w <= 0) return null;
  const up = arch > 0;
  const s = (Math.min(100, Math.abs(arch)) / 100) * (w / 2); // sagitta
  const r = (w * w) / 4 / (2 * s) + s / 2;
  const yEnd = up ? h / 2 + s / 2 + fontSizeMm * 0.35 : h / 2 - s / 2 + fontSizeMm * 0.35;
  const cx = w / 2;
  const cy = up ? yEnd - s + r : yEnd + s - r;
  const startAngle = Math.atan2(yEnd - cy, 0 - cx);
  const endAngle = Math.atan2(yEnd - cy, w - cx);
  const sweep = Math.abs(endAngle - startAngle);
  const f = (n: number) => Math.round(n * 1000) / 1000;
  return {
    path: `M0 ${f(yEnd)}A${f(r)} ${f(r)} 0 0 ${up ? 1 : 0} ${f(w)} ${f(yEnd)}`,
    cx,
    cy,
    r,
    startAngle,
    dir: up ? 1 : -1,
    length: sweep * r,
  };
}

/** Where a glyph sits on the arc: centre point and rotation (degrees) for arc-length `t` from the left end. */
export function pointOnArch(g: ArchGeometry, t: number): { x: number; y: number; rotDeg: number } {
  const a = g.startAngle + (g.dir * t) / g.r;
  let rot = ((a + (g.dir * Math.PI) / 2) * 180) / Math.PI;
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  return { x: g.cx + g.r * Math.cos(a), y: g.cy + g.r * Math.sin(a), rotDeg: rot };
}

// ---- letters as drawn ------------------------------------------------------------------------

type TextLook = Pick<TextElement, 'text' | 'uppercase' | 'vertical'>;

/** The text as it's drawn: upper-cased if set, and for vertical text one letter per line (each
 * line of the original becomes a column, separated by a blank line). Editor and PDF both use it. */
export function displayText(el: TextLook): string {
  const t = el.uppercase ? el.text.toUpperCase() : el.text;
  if (!el.vertical) return t;
  return t.split('\n').map((line) => [...line.replace(/\s+/g, ' ').trim()].join('\n')).join('\n\n');
}

/** One copy of the letters drawn behind the text itself: offset, colour, outline width, softness. */
export interface TextLayer {
  dxMm: number;
  dyMm: number;
  color: string;
  opacity: number;
  /** Full outline width (half of it shows outside the letters); 0 = none. */
  strokeMm: number;
  /** Softness (glow); 0 = crisp. */
  blurMm: number;
}

/**
 * The copies drawn behind a text box's letters, back to front: glow, drop shadow, 3D extrusion,
 * second outline. The letters themselves (fill and first outline) go on top. Shared by the editor
 * and the PDF, so effects print as they look.
 */
export function textLayers(el: Pick<TextElement, 'glow' | 'shadow' | 'extrude' | 'outline2' | 'strokeWidthMm'>): TextLayer[] {
  const stroke = el.strokeWidthMm ?? 0;
  const out: TextLayer[] = [];
  if (el.glow && el.glow.sizeMm > 0) {
    out.push({ dxMm: 0, dyMm: 0, color: el.glow.color, opacity: 0.85, strokeMm: stroke + el.glow.sizeMm, blurMm: el.glow.sizeMm });
    out.push({ dxMm: 0, dyMm: 0, color: el.glow.color, opacity: 0.9, strokeMm: stroke + el.glow.sizeMm * 0.35, blurMm: el.glow.sizeMm * 0.35 });
  }
  if (el.shadow) out.push({ dxMm: el.shadow.dxMm, dyMm: el.shadow.dyMm, color: el.shadow.color, opacity: el.shadow.opacity, strokeMm: stroke + (el.outline2 ? 2 * el.outline2.widthMm : 0), blurMm: 0 });
  if (el.extrude && el.extrude.depthMm > 0) {
    const a = (el.extrude.angleDeg * Math.PI) / 180;
    const steps = Math.min(40, Math.max(2, Math.ceil(el.extrude.depthMm / 0.18)));
    for (let i = steps; i >= 1; i--) {
      const t = (el.extrude.depthMm * i) / steps;
      out.push({ dxMm: Math.cos(a) * t, dyMm: Math.sin(a) * t, color: el.extrude.color, opacity: 1, strokeMm: stroke + (el.outline2 ? 2 * el.outline2.widthMm : 0), blurMm: 0 });
    }
  }
  if (el.outline2 && el.outline2.widthMm > 0) out.push({ dxMm: 0, dyMm: 0, color: el.outline2.color, opacity: 1, strokeMm: stroke + 2 * el.outline2.widthMm, blurMm: 0 });
  return out;
}

/** A box's size for its text running the other way: vertical columns of letters, or back to lines. */
export function textBoxForDirection(el: Pick<TextElement, 'text' | 'fontSizePt' | 'lineHeight' | 'widthMm' | 'heightMm' | 'paddingMm' | 'uppercase'>, vertical: boolean): { widthMm: number; heightMm: number } {
  const size = el.fontSizePt * 0.3528;
  const pad = 2 * (el.paddingMm ?? 0);
  const lines = el.text.split('\n');
  if (vertical) {
    const longest = Math.max(1, ...lines.map((l) => [...l.trim()].length));
    return { widthMm: lines.length * size * 1.25 + (lines.length - 1) * size * 0.5 + pad + 1, heightMm: longest * size * el.lineHeight + pad + 1 };
  }
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { widthMm: Math.max(20, longest * size * 0.62 + pad + 2), heightMm: lines.length * size * el.lineHeight + pad + 1 };
}
