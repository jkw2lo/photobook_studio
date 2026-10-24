import { beforeEach, describe, expect, it } from 'vitest';
import {
  TYPE_PACKS, addTextAt, applyStylePreset, applyTypePack, createBook, createPoster, generateDraft, generatePoster, migrateDocument,
  pageScale, resetTextToStyle, roleStyle, saveTextAsRoleStyle, setRoleStyle, setTextRole, textElementsOf, updateElement, updateStyle,
  type BookDocument, type TextElement,
} from '../src/core';
import { fakeAsset, resetFakeAssets } from './helpers';

beforeEach(() => resetFakeAssets());

const draft = (): BookDocument => {
  const assets = Array.from({ length: 40 }, () => fakeAsset({ day: 1 + (Math.random() > 0.5 ? 1 : 0) }));
  return generateDraft(createBook({ title: 'Lisbon', pages: 20 }), assets, { targetPages: 20, stylePresetId: 'editorial', ordering: 'chronological', includeCaptions: true, seed: 1 }).doc;
};
const firstText = (doc: BookDocument, role: string) => textElementsOf(doc).find((t) => t.role === role)!;
const surfaceOf = (doc: BookDocument, id: string) => [...doc.spreads, doc.cover!].find((s) => s.elements.some((e) => e.id === id))!;

describe('type packs', () => {
  it('switching pack restyles every linked text box, including the cover', () => {
    const doc = applyTypePack(draft(), 'journal');
    const journal = TYPE_PACKS.find((p) => p.id === 'journal')!;
    for (const t of textElementsOf(doc)) {
      expect(t.fontFamily, `${t.role}`).toBe(journal.roles[t.role].family);
      expect(t.styleLinked).toBe(true);
    }
    expect(doc.cover!.elements.some((e) => e.type === 'text' && e.fontFamily === journal.roles.title.family)).toBe(true);
  });

  it('keeps hand-styled text as it is', () => {
    let doc = draft();
    const t = firstText(doc, 'caption');
    doc = updateElement(doc, surfaceOf(doc, t.id).id, t.id, { fontFamily: 'Permanent Marker', styleLinked: false });
    doc = applyTypePack(doc, 'modern');
    expect(textElementsOf(doc).find((x) => x.id === t.id)!.fontFamily).toBe('Permanent Marker');
  });

  it('carries uppercase and letter spacing from the pack', () => {
    const doc = applyTypePack(draft(), 'gallery');
    const title = firstText(doc, 'title');
    expect(title.uppercase).toBe(true);
    expect(title.letterSpacingEm).toBeCloseTo(0.3, 6);
  });

  it('keeps a scaled-up title proportionally large (poster title bands)', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset());
    const { doc } = generatePoster(createPoster({ title: 'Big', sizeId: 'p24x36' }), assets, { style: 'mosaic', photoCount: 20, gapMm: 3, marginMm: 20, titlePosition: 'bottom', seed: 1 });
    const before = firstText(doc, 'title');
    const ratio = before.fontSizePt / (roleStyle(doc.style, 'title').sizePt * pageScale(doc));
    const after = firstText(applyTypePack(doc, 'magazine'), 'title');
    const newRatio = after.fontSizePt / (TYPE_PACKS.find((p) => p.id === 'magazine')!.roles.title.sizePt * pageScale(doc));
    expect(newRatio).toBeCloseTo(ratio, 1);
  });

  it('editing one role style updates only that role', () => {
    const doc0 = draft();
    const doc = setRoleStyle(doc0, 'caption', { family: 'Courier Prime', uppercase: true });
    for (const t of textElementsOf(doc)) {
      if (t.role === 'caption') expect(t.fontFamily).toBe('Courier Prime');
      else expect(t.fontFamily).toBe(textElementsOf(doc0).find((x) => x.id === t.id)!.fontFamily);
    }
    expect(doc.style.typePackId).toBe('custom');
  });

  it('a text box can switch role, be reset, or become the role style', () => {
    let doc = draft();
    const t = firstText(doc, 'caption');
    const sid = surfaceOf(doc, t.id).id;
    doc = setTextRole(doc, sid, t.id, 'label');
    let el = textElementsOf(doc).find((x) => x.id === t.id)!;
    expect(el.role).toBe('label');
    expect(el.fontFamily).toBe(roleStyle(doc.style, 'label').family);

    doc = updateElement(doc, sid, t.id, { fontFamily: 'Lora', fontSizePt: 15, styleLinked: false });
    doc = saveTextAsRoleStyle(doc, sid, t.id);
    expect(roleStyle(doc.style, 'label').family).toBe('Lora');
    el = textElementsOf(doc).find((x) => x.id === t.id)!;
    expect(el.styleLinked).toBe(true);

    doc = updateElement(doc, sid, t.id, { fontFamily: 'Caveat', styleLinked: false });
    doc = resetTextToStyle(doc, sid, t.id);
    expect(textElementsOf(doc).find((x) => x.id === t.id)!.fontFamily).toBe('Lora');
  });

  it('muted text follows the book colours', () => {
    const doc = updateStyle(applyTypePack(draft(), 'modern'), { textColor: '#000000', background: '#ffffff' });
    const caption = firstText(doc, 'caption');
    expect(caption.color).not.toBe('#000000');
    expect(firstText(doc, 'heading')?.color ?? '#000000').toBe('#000000');
  });

  it('switching style preset restyles linked text to the preset’s pack', () => {
    const doc = applyStylePreset(draft(), 'scrapbook');
    expect(firstText(doc, 'title').fontFamily).toBe(TYPE_PACKS.find((p) => p.id === 'scrapbook')!.roles.title.family);
  });

  it('adds text in any role, sized from the style', () => {
    const book = createBook({ title: 'T' });
    const { doc, newId } = addTextAt(book, book.spreads[1].id, 100, 100, undefined, 'quote');
    const el = doc.spreads[1].elements.find((e) => e.id === newId) as TextElement;
    expect(el.role).toBe('quote');
    expect(el.fontFamily).toBe(roleStyle(doc.style, 'quote').family);
    expect(el.styleLinked).toBe(true);
  });
});

describe('schema v2 → v3', () => {
  it('turns heading/body/caption fonts into role styles without moving anything', () => {
    const v3 = draft();
    const title = firstText(v3, 'title');
    // Build a v2-shaped document from it.
    const { typePackId, textStyles, ...style } = v3.style;
    const strip = (els: unknown[]) => (els as Record<string, unknown>[]).map(({ letterSpacingEm, uppercase, styleLinked, ...e }) => e);
    const v2 = {
      ...v3, schemaVersion: 2,
      style: { ...style, headingFont: { family: title.fontFamily, weight: title.fontWeight }, bodyFont: { family: 'Source Serif 4', weight: 400 }, captionFont: { family: 'Inter', weight: 400 } },
      spreads: v3.spreads.map((s) => ({ ...s, elements: strip(s.elements) })),
      cover: { ...v3.cover!, elements: strip(v3.cover!.elements) },
    };
    const m = migrateDocument(JSON.parse(JSON.stringify(v2)));
    expect(m.schemaVersion).toBe(3);
    expect(m.style.textStyles.title.family).toBe(title.fontFamily);
    const mt = textElementsOf(m).find((t) => t.id === title.id)!;
    expect([mt.xMm, mt.yMm, mt.fontSizePt, mt.fontFamily]).toEqual([title.xMm, title.yMm, title.fontSizePt, title.fontFamily]);
    expect(mt.styleLinked).toBe(true);
    expect(mt.letterSpacingEm).toBe(0);
  });
});
