import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILIES, STYLE_PRESETS, fontFilePath } from '../src/core';

const all = FONT_FAMILIES.flatMap((f) => f.weights.map((w) => [f.family, w] as const));

describe('bundled fonts', () => {
  it.each(all)('%s %i embeds in a PDF (PDFKit subsetting)', async (family, weight) => {
    const file = fontFilePath(family, weight);
    expect(existsSync(file), file).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'font-'));
    const pdf = new PDFDocument({ autoFirstPage: false });
    const out = createWriteStream(join(dir, 'f.pdf'));
    pdf.pipe(out);
    pdf.addPage({ size: [400, 120], margin: 0 });
    pdf.registerFont('F', file);
    pdf.font('F').fontSize(20).text('Café Été — “Spring” fi fl 2026 ÀÖü', 10, 10);
    pdf.end();
    await new Promise((r) => out.on('finish', r));
  });

  it('the editor stylesheet loads exactly the fonts the exporter embeds', () => {
    const css = readFileSync('src/web/fonts.css', 'utf8');
    const imported = [...css.matchAll(/@import '@fontsource\/([\w-]+)\/(\d+)\.css'/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    const expected = FONT_FAMILIES.flatMap((f) => f.weights.map((w) => `${f.pkg}/${w}`)).sort();
    expect(imported, 'run: npx tsx scripts/gen-fonts-css.ts').toEqual(expected);
  });

  it('every style preset uses bundled fonts and weights', () => {
    for (const p of STYLE_PRESETS) {
      for (const f of [p.style.headingFont, p.style.bodyFont, p.style.captionFont]) {
        const def = FONT_FAMILIES.find((x) => x.family === f.family);
        expect(def, `${p.id}: ${f.family}`).toBeDefined();
        expect(def!.weights, `${p.id}: ${f.family} ${f.weight}`).toContain(f.weight);
      }
    }
  });
});
