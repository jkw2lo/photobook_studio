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
