import type { BookDocument, ShapeElement } from './model';
import { addElement, addTextAt, updateElement } from './commands';
import { makeShapeElement } from './layout';
import { quickStyleFields, quickStyle, estimateTextHeightMm } from './quickStyles';
import { shapeDef } from './shapes';
import { findSurface } from './surface';
import { newId } from './random';
import { MM_PER_PT } from './units';

// Adding design elements (shapes, banners, lines, icons) to a page or poster.

/** Size a new element from its shape's natural proportions and the page size. */
function sizeFor(doc: Pick<BookDocument, 'settings'>, shapeId: string): { w: number; h: number } {
  const def = shapeDef(shapeId);
  const short = Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm);
  const round = def.id === 'seal' || def.id === 'burst';
  const width = (round ? 0.22 : { icon: 0.14, shape: 0.3, banner: 0.55, line: 0.5, sticker: 0.2 }[def.category]) * short;
  const w = def.category === 'line' || def.category === 'banner' ? width : Math.min(width, width * def.aspect);
  return { w, h: Math.max(def.category === 'line' ? 0.6 : 2, w / def.aspect) };
}

/** Add a shape, line or icon centred on a point. Banners also get a text box on top. */
export function addShapeAt(doc: BookDocument, surfaceId: string, shapeId: string, x: number, y: number): { doc: BookDocument; newId: string } {
  const def = shapeDef(shapeId);
  const { w, h } = sizeFor(doc, shapeId);
  // Colours that read on this surface: ink contrasts with the background; banners get an accent.
  const found = findSurface(doc, surfaceId)?.surface;
  const paper = found?.background ?? doc.style.background;
  const ink = luminance(paper) < 0.45 ? '#f5f2ea' : doc.style.textColor;
  const fill = def.category === 'banner' ? ACCENT : def.category === 'shape' ? mix(ink, paper, 0.75) : ink;
  // A banner and its text are grouped: they move and align as one (click again to edit the text).
  const groupId = def.category === 'banner' ? newId() : undefined;
  const el: ShapeElement = { ...makeShapeElement({ x: x - w / 2, y: y - h / 2, w, h }, fill), shape: def.id, groupId };
  let next = addElement(doc, surfaceId, el);
  if (def.category === 'banner') {
    // Text sits on the banner's middle, in the paper colour, sized to the banner.
    const t = addTextAt(next, surfaceId, x, y, def.id === 'seal' || def.id === 'burst' ? 'NEW' : 'Your text', 'label');
    const q = quickStyle('caps')!;
    const f = { ...quickStyleFields(next, q), color: '#ffffff', letterSpacingEm: 0.15 };
    const inner = def.id === 'ribbon' ? 0.62 : def.id === 'seal' || def.id === 'burst' ? 0.6 : 0.78;
    const tw = w * inner;
    const fontSizePt = Math.round((Math.min(h * 0.38, tw / 6) / MM_PER_PT) * 2) / 2;
    const th = estimateTextHeightMm('Your text', tw, fontSizePt, 1.1, 0.15, 0);
    next = updateElement(t.doc, surfaceId, t.newId, { ...f, groupId, fontSizePt, lineHeight: 1.1, widthMm: tw, heightMm: th, xMm: x - tw / 2, yMm: y - th / 2 - (def.id === 'ribbon' ? h * 0.06 : 0), align: 'center' });
  }
  return { doc: next, newId: el.id };
}

const ACCENT = '#d1495b';

const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').padEnd(6, '0').slice(i, i + 2), 16) || 0);

/** Relative brightness 0…1 of a hex colour. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Hex blend: t = 1 → a, 0 → b. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}
