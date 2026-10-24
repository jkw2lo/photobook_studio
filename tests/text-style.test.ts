import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FONT_FAMILIES, TEXT_QUICK_STYLES, addTextAt, applyQuickStyle, createPoster, quickStyleFields, resetTextToStyle, updateElement,
  type TextElement,
} from '../src/core';
import { exportPosterPdf } from '../src/server/pdf';

const text = (doc: ReturnType<typeof createPoster>, id: string) => doc.spreads[0].elements.find((e) => e.id === id) as TextElement;

describe('quick text styles', () => {
  it('only use bundled fonts, weights and italics', () => {
    for (const q of TEXT_QUICK_STYLES) {
      const def = FONT_FAMILIES.find((f) => f.family === q.family);
      expect(def, q.id).toBeDefined();
      expect(def!.weights, `${q.id} weight`).toContain(q.weight);
      if (q.italic) expect(def!.italic, `${q.id} italic`).toBe(true);
    }
  });

  it('restyle a box, scale with the sheet, and grow the box to fit', () => {
    let doc = createPoster({ title: 'X', sizeId: 'p18x24' });
    const sheet = doc.spreads[0].id;
    const r = addTextAt(doc, sheet, 200, 300, 'Summer', 'body');
    doc = applyQuickStyle(r.doc, sheet, r.newId, 'headline');
    const el = text(doc, r.newId);
    expect(el.fontFamily).toBe('Abril Fatface');
    expect(el.styleLinked).toBe(false);
    // 18 × 24 in is 2.25× the reference 8 in page.
    expect(el.fontSizePt).toBeCloseTo(44 * (457.2 / 203.2), 0);
    expect(el.heightMm).toBeGreaterThan(el.fontSizePt * 0.3528);

    doc = applyQuickStyle(doc, sheet, r.newId, 'band');
    const band = text(doc, r.newId);
    expect(band.backgroundColor).toBe(doc.style.textColor);
    expect(band.color).toBe(doc.style.background);
    expect(band.backgroundOpacity).toBeCloseTo(0.85);
    expect(band.paddingMm).toBeGreaterThan(0);
  });

  it('resetting to the role style clears italics (and the box follows its style again)', () => {
    let doc = createPoster({ title: 'X', sizeId: 'p16x20' });
    const sheet = doc.spreads[0].id;
    const r = addTextAt(doc, sheet, 100, 100, 'Hi', 'title');
    doc = updateElement(r.doc, sheet, r.newId, { italic: true, styleLinked: false });
    doc = resetTextToStyle(doc, sheet, r.newId);
    expect(text(doc, r.newId).italic).toBe(false);
    expect(text(doc, r.newId).styleLinked).toBe(true);
  });
});

describe('PDF export of styled text', () => {
  it('embeds italic fonts and draws backgrounds, with padding inside the box', async () => {
    let doc = createPoster({ title: 'X', sizeId: 'p11x14' });
    const sheet = doc.spreads[0].id;
    const a = addTextAt(doc, sheet, 140, 60, 'Elegant italic', 'title');
    doc = applyQuickStyle(a.doc, sheet, a.newId, 'elegant');
    const b = addTextAt(doc, sheet, 140, 200, 'Chapter one', 'label');
    doc = applyQuickStyle(b.doc, sheet, b.newId, 'band');
    expect(quickStyleFields(doc, TEXT_QUICK_STYLES.find((q) => q.id === 'band')!).backgroundColor).toBeDefined();
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'poster.pdf');
    const res = await exportPosterPdf(doc, new Map(), out);
    expect(res.verification.ok).toBe(true);
    expect(res.textOverflow).toEqual([]);
    const raw = readFileSync(out).toString('latin1');
    expect(raw).toMatch(/CormorantGaramond-\w*Italic/);
    // The band's fill is drawn semi-transparent.
    expect(raw).toMatch(/\/ca 0\.85/);
  });
});
