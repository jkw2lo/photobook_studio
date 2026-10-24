import type { PhotoAsset } from '../src/core';

let counter = 0;

/** Synthetic catalog entry for core tests (no files involved). */
export function fakeAsset(over: Partial<PhotoAsset> & { minute?: number; day?: number; hash?: string } = {}): PhotoAsset {
  counter++;
  const landscape = over.widthPx === undefined ? counter % 3 !== 0 : over.widthPx > (over.heightPx ?? 0);
  const day = over.day ?? 1;
  const minute = over.minute ?? counter * 17;
  const date = new Date(Date.UTC(2026, 2, 13 + day, 8, 0, 0) + minute * 60_000).toISOString().slice(0, 19);
  const { minute: _m, day: _d, hash, ...rest } = over;
  return {
    id: `a${counter}`,
    fileName: `IMG_${String(counter).padStart(4, '0')}.jpg`,
    format: 'jpeg',
    fileSizeBytes: 3_000_000,
    widthPx: landscape ? 4032 : 3024,
    heightPx: landscape ? 3024 : 4032,
    capturedAt: date,
    gpsLat: null,
    gpsLon: null,
    rating: 0,
    favorite: false,
    tags: [],
    contentHash: `hash${counter}`,
    exactDuplicateOf: null,
    analysis: {
      sharpness: 100 + ((counter * 37) % 400),
      meanLuma: 0.45,
      clippedShadows: 0.01,
      clippedHighlights: 0.01,
      // Distinct hashes by default (far apart in Hamming distance).
      dHash: hash ?? distinctHash(counter),
      saliencyX: 0.5,
      saliencyY: 0.45,
    },
    excluded: false,
    missing: false,
    ...rest,
  };
}

function distinctHash(n: number): string {
  // Pseudo-random 64-bit pattern per n.
  let x = (n * 2654435761) >>> 0;
  let out = '';
  for (let i = 0; i < 16; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += ((x >>> 16) & 0xf).toString(16);
  }
  return out;
}

export function resetFakeAssets() {
  counter = 0;
}
