import { produce, type Draft } from 'immer';
import type { BookDocument, Cover, Element, ImageElement, PhotoAsset } from './model';
import { aspectOf, dateRangeOf } from './curation';
import { makeImageElement, makeShapeElement, makeTextElement, textSizeFor } from './layout';
import { pageCountOf, printer } from './printers';
import { newId } from './random';
import { coverDims, coverGeometry } from './surface';
import { MM_PER_PT } from './units';

// Cover layouts. Coordinates: x = 0 at the back cover's left trim edge; back | spine | front.

export interface CoverTemplate {
  id: string;
  name: string;
  description: string;
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: 'cover-band', name: 'Photo + title band', description: 'Photo bleeds off the top and outer edge of the front; title sits on the paper colour below.' },
  { id: 'cover-framed', name: 'Framed photo', description: 'Photo inside generous margins with the title beneath. Quiet and classic.' },
  { id: 'cover-wrap', name: 'Wraparound photo', description: 'One photo across back, spine and front. Best with a wide landscape; title on a paper-colour panel.' },
];

export interface CoverPhotos {
  front?: PhotoAsset | null;
  back?: PhotoAsset | null;
}

/** Spine text only when the spine is wide enough and the printer allows it at this page count. */
export function spineTextAllowed(doc: BookDocument): boolean {
  const S = coverDims(doc).spine.mm;
  return S >= 6 && pageCountOf(doc) >= printer(doc.settings.printerId).spineTextMinPages;
}

export function layoutCover(doc: BookDocument, templateId: string, photos: CoverPhotos): Element[] {
  const g = coverGeometry(doc);
  const { panelW: W, panelH: H, wrap, safe } = coverDims(doc);
  const S = g.spine?.mm ?? 0;
  const frontX = W + S;
  const els: Element[] = [];
  const title = doc.title || 'Untitled';
  const subtitle = doc.subtitle || '';
  const titleSize = textSizeFor('title', doc) * 1.15;

  const titleBlock = (top: number, color?: string) => {
    const t = makeTextElement(doc, 'title', title, { x: frontX + safe, y: top, w: W - 2 * safe, h: H * 0.12 });
    t.fontSizePt = Math.round(titleSize * 2) / 2;
    if (color) t.color = color;
    els.push(t);
    if (subtitle) {
      const st = makeTextElement(doc, 'subtitle', subtitle, { x: frontX + safe, y: top + H * 0.13, w: W - 2 * safe, h: H * 0.06 });
      if (color) st.color = color;
      els.push(st);
    }
  };

  if (templateId === 'cover-wrap') {
    const p = photos.front ?? photos.back ?? null;
    els.push(makeImageElement(doc, p, { x: -wrap, y: -wrap, w: 2 * W + S + 2 * wrap, h: H + 2 * wrap }, 0, true));
    // A paper-colour panel keeps the title legible over any photo.
    els.push(makeShapeElement({ x: frontX + safe * 0.6, y: H * 0.68, w: W - safe * 1.2, h: H * 0.24 }, doc.style.background, 0.94));
    titleBlock(H * 0.71);
  } else if (templateId === 'cover-framed') {
    const p = photos.front ?? null;
    const m = safe * 1.4;
    els.push(makeImageElement(doc, p, { x: frontX + m, y: m, w: W - 2 * m, h: H * 0.6 }, 0, false));
    titleBlock(H * 0.7);
  } else {
    // cover-band (default): front photo bleeds off top and outer edge, stops at the spine fold.
    const p = photos.front ?? null;
    els.push(makeImageElement(doc, p, { x: frontX, y: -wrap, w: W + wrap, h: H * 0.66 + wrap }, 0, true));
    titleBlock(H * 0.72);
  }

  // Back cover: a smaller photo and the date range (not on the wraparound, where the photo is the back).
  if (templateId !== 'cover-wrap') {
    if (photos.back) {
      const ar = aspectOf(photos.back);
      const w = W * 0.5;
      const h = Math.min(H * 0.42, w / ar);
      els.push(makeImageElement(doc, photos.back, { x: (W - (ar >= 1 ? w : h * ar)) / 2, y: H * 0.2, w: ar >= 1 ? w : h * ar, h }, 0, false));
    }
    const range = dateRangeOf([photos.front, photos.back].filter((x): x is PhotoAsset => !!x));
    if (range) els.push(makeTextElement(doc, 'caption', range, { x: safe, y: H * 0.7, w: W - 2 * safe, h: H * 0.05 }));
  }

  // Spine: title reading top-to-bottom (rotated 90°), sized to the spine width.
  if (spineTextAllowed(doc)) {
    const len = H - 2 * safe;
    const thick = S * 0.7;
    const t = makeTextElement(doc, 'heading', title, { x: W + S / 2 - len / 2, y: H / 2 - thick / 2, w: len, h: thick }, { rotationDeg: 90 });
    t.fontSizePt = Math.max(5, Math.min(t.fontSizePt, Math.floor(((S * 0.42) / MM_PER_PT) * 2) / 2));
    t.lineHeight = 1.1;
    if (templateId === 'cover-wrap') t.color = '#ffffff';
    els.push(t);
  }
  return els;
}

// ---- back cover and spine text ------------------------------------------------------------------

/** The spine title on the cover, if any (rotated text centred on the spine). */
export function spineTextElement(doc: BookDocument): Element | undefined {
  if (!doc.cover) return undefined;
  const { panelW, spine } = coverDims(doc);
  return doc.cover.elements.find((e) => e.type === 'text' && Math.abs(Math.abs(e.rotationDeg) - 90) < 1 && Math.abs(e.xMm + e.widthMm / 2 - (panelW + spine.mm / 2)) < Math.max(1, spine.mm / 2));
}

/** Put a title on the spine, reading top to bottom, sized to the spine — or update its words. */
export function setSpineText(doc: BookDocument, text: string): BookDocument {
  if (!doc.cover) return doc;
  const { panelW: W, panelH: H, safe, spine } = coverDims(doc);
  const S = spine.mm;
  const existing = spineTextElement(doc);
  return produce(doc, (d) => {
    const c = d.cover!;
    if (existing) {
      const el = c.elements.find((e) => e.id === existing.id)!;
      if (el.type === 'text') el.text = text;
      return;
    }
    const len = H - 2 * safe;
    const thick = Math.max(2, S * 0.7);
    const t = makeTextElement(doc, 'heading', text, { x: W + S / 2 - len / 2, y: H / 2 - thick / 2, w: len, h: thick }, { rotationDeg: 90 });
    t.fontSizePt = Math.max(5, Math.min(t.fontSizePt, Math.floor(((S * 0.42) / MM_PER_PT) * 2) / 2));
    t.lineHeight = 1.1;
    c.elements.push(t as Draft<Element>);
  });
}

export function removeSpineText(doc: BookDocument): BookDocument {
  const el = spineTextElement(doc);
  if (!el || !doc.cover) return doc;
  return produce(doc, (d) => {
    d.cover!.elements = d.cover!.elements.filter((e) => e.id !== el.id);
  });
}

/** The back-cover blurb (body text on the back panel), if any. */
export function backBlurbElement(doc: BookDocument): Element | undefined {
  if (!doc.cover) return undefined;
  const { panelW } = coverDims(doc);
  return doc.cover.elements.find((e) => e.type === 'text' && e.role === 'body' && e.xMm + e.widthMm / 2 < panelW);
}

/**
 * Add a few lines of text to the back cover, below the back photo; over a wraparound photo it
 * sits on a paper-colour panel so it stays readable.
 */
export function addBackBlurb(doc: BookDocument, text = 'A few words about this book — where it all happened, and who was there.'): { doc: BookDocument; newId: string } {
  if (!doc.cover) return { doc, newId: '' };
  const { panelW: W, panelH: H, safe } = coverDims(doc);
  const wrap = doc.cover.layout?.spread === 'cover-wrap';
  const box = { x: safe * 1.6, y: H * (wrap ? 0.66 : 0.77), w: W - safe * 3.2, h: H * 0.14 };
  const t = makeTextElement(doc, 'body', text, box, { align: 'center' });
  const els: Element[] = [];
  if (wrap) els.push(makeShapeElement({ x: box.x - safe * 0.6, y: box.y - safe * 0.6, w: box.w + safe * 1.2, h: box.h + safe * 1.2 }, doc.style.background, 0.92));
  els.push(t);
  return {
    doc: produce(doc, (d) => {
      d.cover!.elements.push(...(els as Draft<Element>[]));
    }),
    newId: t.id,
  };
}

/** Photos currently on the cover: the frame mostly on the front, and one mostly on the back. */
export function coverPhotos(doc: BookDocument, assets: Map<string, PhotoAsset>): CoverPhotos {
  const cover = doc.cover;
  if (!cover) return {};
  const { panelW, spine } = coverDims(doc);
  const imgs = cover.elements.filter((e): e is ImageElement => e.type === 'image' && !!e.assetId);
  const center = (e: ImageElement) => e.xMm + e.widthMm / 2;
  const front = imgs.find((e) => center(e) >= panelW + spine.mm) ?? imgs.find((e) => e.widthMm > panelW * 1.5);
  const back = imgs.find((e) => center(e) < panelW && e !== front);
  return { front: front ? assets.get(front.assetId!) : undefined, back: back ? assets.get(back.assetId!) : undefined };
}

export function makeCover(doc: BookDocument, templateId: string, photos: CoverPhotos, keepId?: string): Cover {
  const spineMm = coverDims(doc).spine.mm;
  return { id: keepId ?? newId(), locked: false, spineMm, layout: { spread: templateId }, elements: layoutCover(doc, templateId, photos) };
}

/** Pick cover photos from a set: best landscape for the front, next best for the back. */
export function chooseCoverPhotos(candidates: PhotoAsset[], score: (a: PhotoAsset) => number, front?: PhotoAsset): CoverPhotos {
  const ranked = [...candidates].sort((a, b) => score(b) - score(a));
  const f = front ?? ranked.find((a) => aspectOf(a) >= 1.1) ?? ranked[0];
  const back = ranked.find((a) => a !== f);
  return { front: f ?? null, back: back ?? null };
}

/**
 * Keep the cover aligned when the spine width changes (pages added or removed, binding or
 * override changed): front-cover elements move by the change, spine elements by half of it,
 * and elements spanning the whole cover grow with it.
 */
export function reconcileCover(doc: BookDocument): BookDocument {
  const cover = doc.cover;
  if (!cover) return doc;
  const { panelW, spine } = coverDims(doc);
  const S = spine.mm;
  const old = cover.spineMm;
  if (Math.abs(S - old) < 0.01) return doc;
  const d = S - old;
  return produce(doc, (draft) => {
    const c = draft.cover!;
    for (const el of c.elements as Draft<Element>[]) {
      const cx = el.xMm + el.widthMm / 2;
      if (el.xMm < panelW && el.xMm + el.widthMm > panelW + old) el.widthMm += d;
      else if (cx >= panelW + old) el.xMm += d;
      else if (cx >= panelW) el.xMm += d / 2;
    }
    c.spineMm = S;
  });
}
