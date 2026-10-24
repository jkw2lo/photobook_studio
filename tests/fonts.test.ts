import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILIES, STYLE_PRESETS, TYPE_PACKS, fontFilePath } from '../src/core';

const all = FONT_FAMILIES.flatMap((f) => f.weights.flatMap((w) => [[f.family, w, false] as const, ...(f.italic ? [[f.family, w, true] as const] : [])]));

describe('bundled fonts', () => {
  it.each(all)('%s %i (italic: %s) embeds in a PDF (PDFKit subsetting)', async (family, weight, italic) => {
    const file = fontFilePath(family, weight, italic);
    if (italic) expect(file).toContain('-italic.');
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
    const imported = [...css.matchAll(/@import '@fontsource\/([\w-]+)\/(\d+(?:-italic)?)\.css'/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    const expected = FONT_FAMILIES.flatMap((f) => f.weights.flatMap((w) => [`${f.pkg}/${w}`, ...(f.italic ? [`${f.pkg}/${w}-italic`] : [])])).sort();
    expect(imported, 'run: npx tsx scripts/gen-fonts-css.ts').toEqual(expected);
  });

  it('every type pack uses bundled fonts and weights, and every style preset names a real pack', () => {
    for (const pack of TYPE_PACKS) {
      for (const [role, f] of Object.entries(pack.roles)) {
        const def = FONT_FAMILIES.find((x) => x.family === f.family);
        expect(def, `${pack.id}.${role}: ${f.family}`).toBeDefined();
        expect(def!.weights, `${pack.id}.${role}: ${f.family} ${f.weight}`).toContain(f.weight);
      }
    }
    for (const p of STYLE_PRESETS) expect(TYPE_PACKS.map((t) => t.id)).toContain(p.typePack);
  });
});
