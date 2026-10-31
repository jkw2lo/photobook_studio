import type { PhotoAnalysis } from '../../../core';

// The photo analysis of src/server/media.ts (`analyze`), as pure functions over pixel buffers so
// the browser computes the same numbers from its own decode. Only the decode and resampling
// differ (canvas instead of libvips); tests/browser-analysis.test.ts feeds these functions sharp's
// buffers and checks they reproduce the server's values exactly.

/** sRGB → greyscale as libvips does it (luminance in linear light, encoded back to sRGB). */
const TO_LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function toSrgb(y: number): number {
  const v = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** RGBA pixels (already composited on white) → one grey byte per pixel. */
export function greyscale(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = toSrgb(0.2126 * TO_LINEAR[rgba[i]] + 0.7152 * TO_LINEAR[rgba[i + 1]] + 0.0722 * TO_LINEAR[rgba[i + 2]]);
  }
  return out;
}

/** Composite RGBA onto white in place (sharp's `.flatten({ background: '#ffffff' })`). */
export function flattenOnWhite(rgba: Uint8ClampedArray | Uint8Array) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) continue;
    const k = a / 255;
    rgba[i] = Math.round(rgba[i] * k + 255 * (1 - k));
    rgba[i + 1] = Math.round(rgba[i + 1] * k + 255 * (1 - k));
    rgba[i + 2] = Math.round(rgba[i + 2] * k + 255 * (1 - k));
    rgba[i + 3] = 255;
  }
}

/** Sharpness, exposure and the saliency centre from a ≤256 px greyscale render. */
export function analyzeGrey(data: ArrayLike<number>, w: number, h: number): Pick<PhotoAnalysis, 'sharpness' | 'meanLuma' | 'clippedShadows' | 'clippedHighlights' | 'saliencyX' | 'saliencyY'> {
  const px = (x: number, y: number) => data[y * w + x];
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (data[i] <= 8) dark++;
    if (data[i] >= 247) bright++;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  let ex = 0;
  let ey = 0;
  let et = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = px(x, y);
      const lap = 4 * c - px(x - 1, y) - px(x + 1, y) - px(x, y - 1) - px(x, y + 1);
      lapSum += lap;
      lapSq += lap * lap;
      n++;
      const g = Math.abs(px(x + 1, y) - px(x - 1, y)) + Math.abs(px(x, y + 1) - px(x, y - 1));
      const nx = x / w - 0.5;
      const ny = y / h - 0.5;
      const prior = Math.exp(-(nx * nx + ny * ny) / (2 * 0.3 * 0.3));
      const e = g * g * prior;
      ex += e * (x / w);
      ey += e * (y / h);
      et += e;
    }
  }
  const mean = lapSum / n;
  return {
    sharpness: Math.round((lapSq / n - mean * mean) * 100) / 100,
    meanLuma: Math.round((sum / data.length / 255) * 1000) / 1000,
    clippedShadows: Math.round((dark / data.length) * 1000) / 1000,
    clippedHighlights: Math.round((bright / data.length) * 1000) / 1000,
    saliencyX: et > 0 ? Math.round((ex / et) * 1000) / 1000 : 0.5,
    saliencyY: et > 0 ? Math.round((ey / et) * 1000) / 1000 : 0.5,
  };
}

/** 64-bit difference hash from a 9 × 8 greyscale render. */
export function dHash(small: ArrayLike<number>): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] < small[y * 9 + x + 1] ? '1' : '0';
  let out = '';
  for (let i = 0; i < 64; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return out;
}

/** Mean colour of each cell when an RGBA image is cut into cols × rows (box filter). */
export function cellMeans(rgba: ArrayLike<number>, w: number, h: number, cols: number, rows: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      const y0 = Math.floor((r * h) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
      let R = 0;
      let G = 0;
      let B = 0;
      let k = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          R += rgba[i];
          G += rgba[i + 1];
          B += rgba[i + 2];
          k++;
        }
      }
      out.push(Math.round(R / k), Math.round(G / k), Math.round(B / k));
    }
  }
  return out;
}

/** Colour features (media.ts `colorFeatures`): mean colour and a 3 × 3 grid of mean colours. */
export function colorFeatures(rgba: ArrayLike<number>, w: number, h: number): { avgColor: [number, number, number]; colorGrid: number[] } {
  const [r, g, b] = cellMeans(rgba, w, h, 1, 1);
  return { avgColor: [r, g, b], colorGrid: cellMeans(rgba, w, h, 3, 3) };
}

/** True when a small RGBA render has see-through pixels (≈0.5% of the image), as media.ts decides. */
export function hasTransparentPixels(rgba: ArrayLike<number>, w: number, h: number): boolean {
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) clear++;
  return clear > (w * h) / 200;
}

/** Size that fits inside a box without enlarging (sharp: fit 'inside', withoutEnlargement). */
export function fitInside(w: number, h: number, box: number, enlarge = false): { w: number; h: number } {
  const k = Math.min(box / w, box / h, enlarge ? Infinity : 1);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** EXIF date ("2026:03:14 09:12:05" or a Date) → "2026-03-14T09:12:05" (no zone, like media.ts). */
export function exifDate(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m && m[1] !== '0000') return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return null;
}
