import type { ColorGrade } from './model';

// Colour grading for a whole poster (or book): presets plus sliders, reduced to one affine colour
// transform on sRGB values — rgb' = M · rgb + o. The editor applies it with an SVG feColorMatrix
// (in sRGB) and the PDF exporter with sharp's recomb + linear, so the print matches the preview.

export interface GradePreset {
  id: string;
  name: string;
  grade: Omit<ColorGrade, 'preset'>;
}

const g = (over: Partial<Omit<ColorGrade, 'preset'>>): Omit<ColorGrade, 'preset'> => ({ brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, ...over });

export const GRADE_PRESETS: GradePreset[] = [
  { id: 'none', name: 'Original', grade: g({}) },
  { id: 'warm', name: 'Warm', grade: g({ warmth: 40, saturation: 10 }) },
  { id: 'cool', name: 'Cool', grade: g({ warmth: -40, saturation: -5 }) },
  { id: 'vivid', name: 'Vivid', grade: g({ saturation: 40, contrast: 15 }) },
  { id: 'bright', name: 'Bright', grade: g({ brightness: 20, contrast: -5, fade: 5 }) },
  { id: 'matte', name: 'Matte', grade: g({ contrast: -20, fade: 30 }) },
  { id: 'film', name: 'Film', grade: g({ contrast: 20, saturation: -15, fade: 12, warmth: 10 }) },
  { id: 'vintage', name: 'Vintage', grade: g({ warmth: 25, saturation: -35, fade: 25, contrast: -10 }) },
  { id: 'bw', name: 'Black & white', grade: g({ mono: 'bw', contrast: 15 }) },
  { id: 'sepia', name: 'Sepia', grade: g({ mono: 'sepia', fade: 10 }) },
];

export const NO_GRADE: ColorGrade = { preset: 'none', ...GRADE_PRESETS[0].grade };

export function gradeFromPreset(id: string): ColorGrade {
  const p = GRADE_PRESETS.find((x) => x.id === id) ?? GRADE_PRESETS[0];
  return { preset: p.id, ...p.grade };
}

export const isNeutralGrade = (gr: ColorGrade | undefined) =>
  !gr || (!gr.mono && !gr.brightness && !gr.contrast && !gr.saturation && !gr.warmth && !gr.fade);

type M3 = [number, number, number, number, number, number, number, number, number];
interface Affine {
  m: M3;
  o: [number, number, number];
}

const I: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const scale = (r: number, gg: number, b: number): Affine => ({ m: [r, 0, 0, 0, gg, 0, 0, 0, b], o: [0, 0, 0] });

/** b after a: (b ∘ a)(x) = Mb (Ma x + oa) + ob. */
function then(a: Affine, b: Affine): Affine {
  const m = Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) m[i * 3 + j] += b.m[i * 3 + k] * a.m[k * 3 + j];
  const o = [0, 1, 2].map((i) => b.m[i * 3] * a.o[0] + b.m[i * 3 + 1] * a.o[1] + b.m[i * 3 + 2] * a.o[2] + b.o[i]) as [number, number, number];
  return { m, o };
}

// Rec. 709 luminance weights.
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

function saturation(s: number): Affine {
  const a = 1 - s;
  return {
    m: [a * LR + s, a * LG, a * LB, a * LR, a * LG + s, a * LB, a * LR, a * LG, a * LB + s],
    o: [0, 0, 0],
  };
}

const SEPIA: M3 = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

/** The grade as rgb' = M · rgb + o on sRGB values in 0…1. */
export function gradeMatrix(gr: ColorGrade): Affine {
  let t: Affine = { m: [...I] as M3, o: [0, 0, 0] };
  if (gr.mono === 'bw') t = then(t, saturation(0));
  else if (gr.mono === 'sepia') t = then(t, { m: SEPIA, o: [0, 0, 0] });
  if (gr.saturation) t = then(t, saturation(Math.max(0, 1 + gr.saturation / 100)));
  if (gr.warmth) {
    const w = gr.warmth / 100;
    t = then(t, scale(1 + 0.15 * w, 1 + 0.03 * w, 1 - 0.15 * w));
  }
  if (gr.contrast) {
    const k = 1 + (gr.contrast / 100) * 0.6;
    t = then(t, { m: [k, 0, 0, 0, k, 0, 0, 0, k], o: [0.5 * (1 - k), 0.5 * (1 - k), 0.5 * (1 - k)] });
  }
  if (gr.brightness) {
    const b = 1 + (gr.brightness / 100) * 0.4;
    t = then(t, scale(b, b, b));
  }
  if (gr.fade) {
    // Lift the blacks (and soften the whites a touch), like a faded print.
    const a = (gr.fade / 100) * 0.25;
    t = then(t, { m: [1 - a, 0, 0, 0, 1 - a, 0, 0, 0, 1 - a], o: [a, a, a] });
  }
  return t;
}

/** Apply a grade to one colour (0–255), clamped — for tests and colour swatches. */
export function gradeColor(gr: ColorGrade, rgb: [number, number, number]): [number, number, number] {
  const { m, o } = gradeMatrix(gr);
  const x = rgb.map((v) => v / 255);
  return [0, 1, 2].map((i) => Math.round(255 * Math.min(1, Math.max(0, m[i * 3] * x[0] + m[i * 3 + 1] * x[1] + m[i * 3 + 2] * x[2] + o[i])))) as [number, number, number];
}

/** Values for an SVG <feColorMatrix type="matrix"> (alpha untouched). */
export function gradeSvgMatrix(gr: ColorGrade): string {
  const { m, o } = gradeMatrix(gr);
  const f = (n: number) => String(Math.round(n * 10000) / 10000);
  return [0, 1, 2].map((i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2], 0, o[i]].map(f).join(' ')).concat('0 0 0 1 0').join(' ');
}

/** Stable key for caches (thumbnails, exported image crops). */
export const gradeKey = (gr: ColorGrade | undefined) => (isNeutralGrade(gr) ? '' : gradeSvgMatrix(gr!));
