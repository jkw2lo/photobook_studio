import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { analyzeGrey, colorFeatures, dHash, flattenOnWhite, greyscale, hasTransparentPixels } from '../src/web/backend/browser/analysis';
import { analyze } from '../src/server/media';

// The web version analyses photos with these pure functions on canvas pixels. Given the same
// pixels as sharp, they must give the server's numbers, so curation behaves the same.

const FIXTURES = 'fixtures/generated/trip';
const files = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /\.(jpe?g|png)$/i.test(f)).slice(0, 8).map((f) => join(FIXTURES, f)) : [];

describe.skipIf(!files.length)('browser photo analysis', () => {
  it('reproduces the server analysis from the same greyscale pixels', async () => {
    for (const f of files) {
      const server = await analyze(f);
      const { data, info } = await sharp(f, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).resize(256, 256, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
      const ours = analyzeGrey(data, info.width, info.height);
      expect(ours, f).toEqual({
        sharpness: server.sharpness, meanLuma: server.meanLuma, clippedShadows: server.clippedShadows,
        clippedHighlights: server.clippedHighlights, saliencyX: server.saliencyX, saliencyY: server.saliencyY,
      });
      const small = await sharp(f, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' }).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
      expect(dHash(small), f).toBe(server.dHash);
    }
  });

  it('converts to grey like libvips', async () => {
    for (const f of files) {
      const rgb = await sharp(f).rotate().flatten({ background: '#ffffff' }).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer();
      const grey = await sharp(f).rotate().flatten({ background: '#ffffff' }).resize(64, 64, { fit: 'inside' }).greyscale().raw().toBuffer();
      const ours = greyscale(rgb);
      let worst = 0;
      let total = 0;
      for (let i = 0; i < grey.length; i++) {
        worst = Math.max(worst, Math.abs(ours[i] - grey[i]));
        total += Math.abs(ours[i] - grey[i]);
      }
      expect(total / grey.length, f).toBeLessThan(0.6);
      expect(worst, f).toBeLessThanOrEqual(10);
    }
  });

  it('colour features are close to sharp’s resize-based ones', async () => {
    for (const f of files) {
      const server = await analyze(f);
      const { data, info } = await sharp(f).rotate().resize(256, 256, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      flattenOnWhite(data);
      const ours = colorFeatures(data, info.width, info.height);
      ours.avgColor.forEach((v, i) => expect(Math.abs(v - server.avgColor![i]), f).toBeLessThanOrEqual(6));
      ours.colorGrid.forEach((v, i) => expect(Math.abs(v - server.colorGrid![i]), f).toBeLessThanOrEqual(24));
    }
  });

  it('finds transparency only when enough pixels are see-through', () => {
    const img = new Uint8Array(100 * 100 * 4).fill(255);
    expect(hasTransparentPixels(img, 100, 100)).toBe(false);
    for (let i = 0; i < 40; i++) img[i * 4 + 3] = 0;
    expect(hasTransparentPixels(img, 100, 100)).toBe(false);
    for (let i = 0; i < 100; i++) img[i * 4 + 3] = 0;
    expect(hasTransparentPixels(img, 100, 100)).toBe(true);
  });
});
