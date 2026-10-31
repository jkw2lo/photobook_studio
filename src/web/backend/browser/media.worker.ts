import exifr from 'exifr';
import type { PhotoAnalysis } from '../../../core';
import { analyzeGrey, colorFeatures, dHash, exifDate, flattenOnWhite, greyscale, hasTransparentPixels } from './analysis';
import { canEncodeWebp, decode, fitted, pixels, resized } from './canvas';
import { serve } from './rpc';

// Import work for one photo, off the main thread: hash, EXIF, decode, thumbnails and analysis —
// the browser's version of src/server/media.ts.

export const THUMB_SIZES = { s: 400, m: 1600 } as const;
const ALPHA_FORMATS = new Set(['png', 'webp']);

export interface ProcessedPhoto {
  width: number;
  height: number;
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  analysis: PhotoAnalysis;
  thumbS: Blob;
  thumbM: Blob;
}

async function hash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function metadata(file: Blob) {
  let capturedAt: string | null = null;
  let gpsLat: number | null = null;
  let gpsLon: number | null = null;
  try {
    const tags = await exifr.parse(file, { reviveValues: false, pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate', 'DateTime'] });
    if (tags) capturedAt = exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate) ?? exifDate(tags.DateTimeDigitized) ?? exifDate(tags.ModifyDate) ?? exifDate(tags.DateTime);
  } catch {
    // no EXIF — fine
  }
  try {
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      gpsLat = gps.latitude;
      gpsLon = gps.longitude;
    }
  } catch {
    // no GPS — fine
  }
  return { capturedAt, gpsLat, gpsLon };
}

async function process(file: Blob, name: string, format: string): Promise<ProcessedPhoto> {
  const [bitmap, meta] = await Promise.all([decode(file, name), metadata(file)]);
  try {
    const { width, height } = bitmap;
    const probe = ALPHA_FORMATS.has(format) ? fitted(bitmap, 256) : null;
    const transparent = !!probe && hasTransparentPixels(pixels(probe), probe.width, probe.height);
    // Thumbnails: JPEG on white for photos; WebP (PNG where WebP can't be encoded) keeps cutouts see-through.
    const bg = transparent ? undefined : '#ffffff';
    const m = fitted(bitmap, THUMB_SIZES.m, { background: bg });
    const s = fitted(m, THUMB_SIZES.s, { background: bg });
    const type = transparent ? ((await canEncodeWebp()) ? 'image/webp' : 'image/png') : 'image/jpeg';
    const [thumbM, thumbS] = await Promise.all([m.convertToBlob({ type, quality: 0.84 }), s.convertToBlob({ type, quality: 0.78 })]);

    // Analysis on small renders, cutouts judged as they look on white paper (as media.ts).
    const small = fitted(m.width >= 256 || m.height >= 256 ? m : bitmap, 256, { enlarge: true });
    const rgba = pixels(small);
    flattenOnWhite(rgba);
    const grey = greyscale(rgba);
    const hashGrid = resized(m, 72, 64, { background: '#ffffff' });
    const g72 = greyscale(pixels(hashGrid));
    const g98 = new Uint8Array(72);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        let sum = 0;
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) sum += g72[(y * 8 + yy) * 72 + x * 8 + xx];
        g98[y * 9 + x] = Math.round(sum / 64);
      }
    }
    const analysis: PhotoAnalysis = {
      ...analyzeGrey(grey, small.width, small.height),
      dHash: dHash(g98),
      ...colorFeatures(rgba, small.width, small.height),
      transparent,
    };
    return { width, height, ...meta, analysis, thumbS, thumbM };
  } finally {
    bitmap.close();
  }
}

/** A small preview (for the Shelf), WebP where possible. */
async function preview(file: Blob, name: string, px: number): Promise<Blob> {
  const bitmap = await decode(file, name);
  try {
    const c = fitted(bitmap, px);
    return await c.convertToBlob({ type: (await canEncodeWebp()) ? 'image/webp' : 'image/png', quality: 0.72 });
  } finally {
    bitmap.close();
  }
}

serve({ hash, process, preview });
