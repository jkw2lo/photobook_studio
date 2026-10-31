import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import type { PhotoAnalysis } from '../core';

// Media pipeline: everything runs locally. Originals are only ever read.

const run = promisify(execFile);

export const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']);
const HEIC = new Set(['.heic', '.heif']);

export const THUMB_SIZES = { s: 400, m: 1600 } as const;
export type ThumbSize = keyof typeof THUMB_SIZES;

/** Opaque photos get JPEG thumbnails; photos with transparency (cutouts) get WebP, which keeps it. */
export const thumbPath = (dataDir: string, assetId: string, size: ThumbSize, ext: 'jpg' | 'webp' = 'jpg') => join(dataDir, 'thumbs', `${assetId}_${size}.${ext}`);

/** The thumbnail file that exists for an asset (WebP for cutouts, else JPEG), or null. */
export function existingThumb(dataDir: string, assetId: string, size: ThumbSize): string | null {
  for (const ext of ['webp', 'jpg'] as const) {
    const p = thumbPath(dataDir, assetId, size, ext);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Formats that can carry an alpha channel. */
export const ALPHA_FORMATS = new Set(['png', 'webp']);

/**
 * True when the image actually has see-through pixels (not just an unused alpha channel, which
 * many exported PNGs carry). Checked on a small render so large files stay cheap.
 */
export async function hasTransparency(path: string): Promise<boolean> {
  const meta = await sharp(path, { failOn: 'none' }).metadata();
  if (!meta.hasAlpha) return false;
  const { data, info } = await sharp(path, { failOn: 'none' }).resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (let i = info.channels - 1; i < data.length; i += info.channels) if (data[i] < 250) clear++;
  // A few soft edge pixels don't make a cutout; ~0.5% of the image does.
  return clear > (info.width * info.height) / 200;
}

export function isSupported(path: string) {
  return SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase()) && !basename(path).startsWith('._');
}

export async function hashFile(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/**
 * The file sharp should decode. HEIC (HEVC) is not decodable by the bundled libvips, so it is
 * converted once with macOS `sips` into the data directory. The original is untouched.
 */
export async function workingFile(originalPath: string, dataDir: string, contentHash: string): Promise<{ path: string; derived: string | null }> {
  if (!HEIC.has(extname(originalPath).toLowerCase())) return { path: originalPath, derived: null };
  const out = join(dataDir, 'derived', `${contentHash}.jpg`);
  if (!existsSync(out)) {
    if (process.platform !== 'darwin') throw new Error('HEIC import needs macOS (sips) in this version');
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', originalPath, '--out', out]);
  }
  return { path: out, derived: out };
}

/** Exif wall-clock "2026:03:14 09:12:05" → "2026-03-14T09:12:05" (no zone: EXIF has none). */
function exifDate(v: unknown): string | null {
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

export interface ExtractedMetadata {
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

export async function readMetadata(originalPath: string): Promise<ExtractedMetadata> {
  let capturedAt: string | null = null;
  let gpsLat: number | null = null;
  let gpsLon: number | null = null;
  // exifr is given the bytes, not the path: with a path it leaves file handles for the garbage
  // collector to close, which newer Node versions (26.13+) treat as an error.
  let data: Buffer;
  try {
    data = await readFile(originalPath);
  } catch {
    return { capturedAt, gpsLat, gpsLon };
  }
  try {
    const tags = await exifr.parse(data, { reviveValues: false, pick: ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate', 'DateTime'] });
    if (tags) capturedAt = exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate) ?? exifDate(tags.DateTimeDigitized) ?? exifDate(tags.ModifyDate) ?? exifDate(tags.DateTime);
  } catch {
    // no EXIF — fine
  }
  try {
    const gps = await exifr.gps(data);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      gpsLat = gps.latitude;
      gpsLon = gps.longitude;
    }
  } catch {
    // no GPS — fine
  }
  return { capturedAt, gpsLat, gpsLon };
}

/** Dimensions after applying EXIF orientation. */
export async function orientedSize(path: string): Promise<{ width: number; height: number; format: string }> {
  const m = await sharp(path, { failOn: 'none' }).metadata();
  if (!m.width || !m.height) throw new Error('Could not read image dimensions');
  const swap = (m.orientation ?? 1) >= 5;
  return { width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format ?? 'unknown' };
}

export async function makeThumbnails(workPath: string, dataDir: string, assetId: string, transparent = false) {
  const base = sharp(workPath, { failOn: 'none' }).rotate();
  await Promise.all(
    (Object.keys(THUMB_SIZES) as ThumbSize[]).map(async (size) => {
      const img = base.clone().resize(THUMB_SIZES[size], THUMB_SIZES[size], { fit: 'inside', withoutEnlargement: true });
      // Remove the other format's file so the route never serves a stale one.
      await rm(thumbPath(dataDir, assetId, size, transparent ? 'jpg' : 'webp'), { force: true });
      if (transparent) return img.webp({ quality: size === 's' ? 80 : 86, alphaQuality: 90 }).toFile(thumbPath(dataDir, assetId, size, 'webp'));
      return img.flatten({ background: '#ffffff' }).jpeg({ quality: size === 's' ? 78 : 84, mozjpeg: true }).toFile(thumbPath(dataDir, assetId, size));
    }),
  );
}

/**
 * Cheap, deterministic image analysis on small greyscale renders:
 *  - sharpness: variance of the Laplacian
 *  - exposure: mean luminance and clipped fractions
 *  - dHash: 64-bit difference hash for near-duplicate detection
 *  - saliency: edge-energy centre of mass with a mild centre prior
 */
export async function analyze(workPath: string): Promise<PhotoAnalysis> {
  const { data, info } = await sharp(workPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' }) // cutouts are judged as they look on white paper
    .resize(256, 256, { fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
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

  const small = await sharp(workPath, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] < small[y * 9 + x + 1] ? '1' : '0';
  let dHash = '';
  for (let i = 0; i < 64; i += 4) dHash += parseInt(bits.slice(i, i + 4), 2).toString(16);

  return {
    sharpness: Math.round((lapSq / n - mean * mean) * 100) / 100,
    meanLuma: Math.round((sum / data.length / 255) * 1000) / 1000,
    clippedShadows: Math.round((dark / data.length) * 1000) / 1000,
    clippedHighlights: Math.round((bright / data.length) * 1000) / 1000,
    dHash,
    saliencyX: et > 0 ? Math.round((ex / et) * 1000) / 1000 : 0.5,
    saliencyY: et > 0 ? Math.round((ey / et) * 1000) / 1000 : 0.5,
    ...(await colorFeatures(workPath, true)),
    transparent: await hasTransparency(workPath),
  };
}

/**
 * Colour features for grouping similar-looking photos: mean colour and a 3 × 3 grid of mean
 * colours. `orient` applies EXIF rotation (originals); thumbnails are already upright.
 */
export async function colorFeatures(path: string, orient: boolean): Promise<{ avgColor: [number, number, number]; colorGrid: number[] }> {
  const base = sharp(path, { failOn: 'none' });
  const img = orient ? base.rotate() : base;
  const grid = await img.clone().flatten({ background: '#ffffff' }).resize(3, 3, { fit: 'fill' }).raw().toBuffer();
  const avg = await img.clone().flatten({ background: '#ffffff' }).resize(1, 1, { fit: 'fill' }).raw().toBuffer();
  return { avgColor: [avg[0], avg[1], avg[2]], colorGrid: Array.from(grid.subarray(0, 27)) };
}

export async function fileStat(path: string) {
  const s = await stat(path);
  return { size: s.size, mtimeMs: Math.round(s.mtimeMs) };
}
