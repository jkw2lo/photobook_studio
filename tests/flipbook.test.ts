// The shareable web flipbook: every page and both cover boards cut from the print PDF and embedded
// in one HTML file with the viewer.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyCoverTemplate, createBook, generateDraft, printablePages, type PhotoAsset } from '../src/core';
import { exportFlipbook } from '../src/server/flipbook';
import { flipbookHtml, type FlipbookData } from '../src/server/flipbookViewer';
import { fakeAsset } from './helpers';

const dataOf = (html: string): FlipbookData => JSON.parse(html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)![1]);

describe('web flipbook', () => {
  it('escapes the title and keeps the data from closing its script tag', () => {
    const data: FlipbookData = { title: 'Tom & Mia </script><b>', pageW: 200, pageH: 250, coverW: 200, coverH: 250, front: null, back: null, pages: [], spreads: [] };
    const html = flipbookHtml(data);
    expect(html).toContain('<title>Tom &amp; Mia &lt;/script&gt;&lt;b&gt;</title>');
    expect(html.match(/<\/script>/g)).toHaveLength(2); // the data block and the viewer, nothing injected
    expect(dataOf(html).title).toBe(data.title);
    // Self-contained: nothing loaded from elsewhere.
    expect(html).not.toMatch(/\b(src|href)=["']https?:/);
  });

  it.runIf(process.platform === 'darwin')('embeds every printed page and both cover boards, trimmed, in spread order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flip-'));
    const colours = [[200, 60, 50], [40, 120, 200], [60, 160, 90], [220, 180, 40]];
    const assets: PhotoAsset[] = [];
    const files = new Map<string, string>();
    for (let i = 0; i < 12; i++) {
      const a = fakeAsset({ widthPx: 1500, heightPx: 1000, day: 1 + (i >> 2) });
      const f = join(dir, `${a.id}.jpg`);
      const [r, g, b] = colours[i % colours.length];
      await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r, g, b } } }).jpeg().toFile(f);
      assets.push(a);
      files.set(a.id, f);
    }
    let doc = generateDraft(createBook({ title: 'Lisbon', pages: 24 }), assets, { targetPages: 24, stylePresetId: 'editorial', ordering: 'chronological', includeCaptions: true, seed: 1 }).doc;
    doc = applyCoverTemplate(doc, 'cover-band', new Map(assets.map((a) => [a.id, a])), assets);
    const map = new Map(assets.map((a) => [a.id, { asset: a, workPath: files.get(a.id)! }]));
    const out = join(dir, 'book.html');

    const r = await exportFlipbook(doc, map, out, { size: 'standard' });
    const printed = printablePages(doc);
    expect(r.pages).toBe(printed.length);
    expect(r.hasCover).toBe(true);
    // Pages 1400 px on the long edge, at the trim's shape (no bleed).
    expect(Math.max(r.widthPx, r.heightPx)).toBeCloseTo(1400, -1);
    expect(r.widthPx / r.heightPx).toBeCloseTo(doc.settings.trimWidthMm / doc.settings.trimHeightMm, 2);

    const data = dataOf(readFileSync(out, 'utf8'));
    expect(data.pages.map((p) => p.pageNumber)).toEqual(printed.map((p) => p.pageNumber));
    expect(data.spreads).toHaveLength(doc.spreads.length);
    // The first spread's left and the last spread's right are the insides of the cover.
    expect(data.spreads[0][0]).toBeNull();
    expect(data.spreads.at(-1)![1]).toBeNull();
    expect(data.spreads.flat().filter((p) => p !== null)).toEqual(data.pages.map((_, i) => i));
    for (const src of [data.front!, data.back!, data.pages[0].src]) {
      const meta = await sharp(Buffer.from(src.split(',')[1], 'base64')).metadata();
      expect(meta.format).toBe('webp');
    }
    // Pages with photos aren't blank: the cut is from the rendered page, not the paper margin.
    const stats = await Promise.all(data.pages.map((p) => sharp(Buffer.from(p.src.split(',')[1], 'base64')).stats()));
    expect(stats.some((s) => s.channels[0].stdev > 20)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
