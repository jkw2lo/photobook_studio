import { produce, type Draft } from 'immer';
import type { BindingId, BookDocument, BookSettings, BookStyle, Element, ImageElement, PhotoAsset, PrinterId, Spread, TextRole } from './model';
import { blankSpread, pageContentRect, pageTrimRect, type PageSide } from './book';
import { aspectOf, dateRangeOf } from './curation';
import { defaultCrop } from './geometry';
import { chooseTemplate, isCutout, keepSubjectOutOfGutter, layoutPage, makeImageElement, makeTextElement, pageOfElement, templateOrThrow } from './layout';
import { mulberry32, newId } from './random';
import { stylePreset, styleFromPreset } from './styles';
import { template as findTemplate } from './templates';
import { chooseCoverPhotos, coverPhotos, makeCover, reconcileCover } from './cover';
import { pageCountOf, presetSettings } from './printers';
import { findSurface } from './surface';
import { pageScale, recolorLinkedText, restyleText, roleSizePt, roleStyle, setRoleStyle, styleFields } from './typography';
import { MM_PER_PT } from './units';
import { layoutCollage } from './collage';
import { MOSAIC_LAYOUT } from './generator';

// Every edit is a pure function BookDocument → BookDocument. The UI's undo history stores the
// resulting documents (structural sharing keeps that cheap), so undo restores state exactly.

export class CommandError extends Error {}

/** Spreads and the cover share ids space; element commands work on either. */
const findSpread = (d: Draft<BookDocument>, spreadId: string) => {
  const s = d.cover?.id === spreadId ? d.cover : d.spreads.find((x) => x.id === spreadId);
  if (!s) throw new CommandError('Spread not found');
  return s;
};

const findElement = (s: Draft<Spread>, elementId: string) => {
  const el = s.elements.find((e) => e.id === elementId);
  if (!el) throw new CommandError('Element not found');
  return el;
};

export type ElementPatch = Partial<Omit<ImageElement, 'id' | 'type'>> & Partial<Omit<Element, 'id' | 'type'>> & Record<string, unknown>;

export function updateElement(doc: BookDocument, spreadId: string, elementId: string, patch: ElementPatch): BookDocument {
  return produce(doc, (d) => {
    const el = findElement(findSpread(d, spreadId), elementId);
    Object.assign(el, patch);
  });
}

export function addElement(doc: BookDocument, spreadId: string, element: Element): BookDocument {
  return produce(doc, (d) => {
    findSpread(d, spreadId).elements.push(element as Draft<Element>);
  });
}

export function removeElements(doc: BookDocument, spreadId: string, ids: string[]): BookDocument {
  return produce(doc, (d) => {
    const s = findSpread(d, spreadId);
    s.elements = s.elements.filter((e) => !ids.includes(e.id) || e.locked);
  });
}

export function duplicateElement(doc: BookDocument, spreadId: string, elementId: string): { doc: BookDocument; newId: string } {
  const id = newId();
  const next = produce(doc, (d) => {
    const s = findSpread(d, spreadId);
    const el = findElement(s, elementId);
    s.elements.push({ ...structuredClone(el), id, xMm: el.xMm + 5, yMm: el.yMm + 5, locked: false } as Draft<Element>);
  });
  return { doc: next, newId: id };
}

export function reorderElement(doc: BookDocument, spreadId: string, elementId: string, where: 'front' | 'back' | 'forward' | 'backward'): BookDocument {
  return produce(doc, (d) => {
    const s = findSpread(d, spreadId);
    const i = s.elements.findIndex((e) => e.id === elementId);
    if (i < 0) return;
    const [el] = s.elements.splice(i, 1);
    const to = where === 'front' ? s.elements.length : where === 'back' ? 0 : where === 'forward' ? Math.min(s.elements.length, i + 1) : Math.max(0, i - 1);
    s.elements.splice(to, 0, el);
  });
}

/** Put a photo into a frame (replace), resetting the crop to the new photo's subject. */
export function setFramePhoto(doc: BookDocument, spreadId: string, elementId: string, asset: PhotoAsset | null): BookDocument {
  return produce(doc, (d) => {
    const el = findElement(findSpread(d, spreadId), elementId);
    if (el.type !== 'image') throw new CommandError('Not an image frame');
    if (el.locked) throw new CommandError('Frame is locked');
    el.assetId = asset?.id ?? null;
    el.crop = defaultCrop(asset);
    delete el.adjust; // adjustments were for the previous photo
    cutoutLook(el, asset);
  });
}

/** A cutout put into a frame is shown whole and loses the frame's border; a photo replacing a
 * cutout goes back to filling the frame. */
function cutoutLook(el: Draft<ImageElement>, asset: PhotoAsset | null | undefined, previous?: PhotoAsset | null) {
  if (isCutout(asset)) {
    el.fit = 'contain';
    el.borderMm = 0;
  } else if (asset && isCutout(previous)) el.fit = 'cover';
}

/** Swap the photos of two frames (possibly on different spreads); each keeps its frame geometry. */
export function swapFramePhotos(
  doc: BookDocument,
  a: { spreadId: string; elementId: string },
  b: { spreadId: string; elementId: string },
  assets: Map<string, PhotoAsset>,
): BookDocument {
  return produce(doc, (d) => {
    const ea = findElement(findSpread(d, a.spreadId), a.elementId);
    const eb = findElement(findSpread(d, b.spreadId), b.elementId);
    if (ea.type !== 'image' || eb.type !== 'image') throw new CommandError('Both elements must be image frames');
    if (ea.locked || eb.locked) throw new CommandError('A locked frame cannot be swapped');
    const [ida, idb] = [ea.assetId, eb.assetId];
    ea.assetId = idb;
    eb.assetId = ida;
    ea.crop = defaultCrop(idb ? assets.get(idb) : null);
    eb.crop = defaultCrop(ida ? assets.get(ida) : null);
    cutoutLook(ea, idb ? assets.get(idb) : null, ida ? assets.get(ida) : null);
    cutoutLook(eb, ida ? assets.get(ida) : null, idb ? assets.get(idb) : null);
    // Colour adjustments belong to the photo: they move with it.
    [ea.adjust, eb.adjust] = [eb.adjust, ea.adjust];
  });
}

/** Add a new photo frame centred on a point, sized to the photo's aspect ratio. */
export function addPhotoAt(doc: BookDocument, spreadId: string, asset: PhotoAsset, xMm: number, yMm: number): { doc: BookDocument; newId: string } {
  const longEdge = Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm) * 0.45;
  const ar = aspectOf(asset);
  const w = ar >= 1 ? longEdge : longEdge * ar;
  const h = ar >= 1 ? longEdge / ar : longEdge;
  const el = makeImageElement(doc, asset, { x: xMm - w / 2, y: yMm - h / 2, w, h });
  return { doc: addElement(doc, spreadId, el), newId: el.id };
}

const DEFAULT_TEXT: Record<TextRole, string> = {
  title: 'Title', subtitle: 'Subtitle', heading: 'Heading', body: 'Double-click to edit', caption: 'Caption', quote: '“A line worth remembering.”', label: 'Label',
};

/** Add a text box in a given style, sized so its first line fits. */
export function addTextAt(doc: BookDocument, spreadId: string, xMm: number, yMm: number, text?: string, role: TextRole = 'body'): { doc: BookDocument; newId: string } {
  const sizeMm = roleSizePt(doc, role) * MM_PER_PT;
  const ts = roleStyle(doc.style, role);
  const w = doc.settings.trimWidthMm * (role === 'body' || role === 'quote' ? 0.5 : 0.6);
  const lines = role === 'body' || role === 'quote' ? 3 : 1;
  const h = Math.max(6, sizeMm * ts.lineHeight * lines + 2);
  const el = makeTextElement(doc, role, text ?? DEFAULT_TEXT[role], { x: xMm - w / 2, y: yMm - h / 2, w, h }, { align: role === 'body' ? 'left' : 'center' });
  return { doc: addElement(doc, spreadId, el), newId: el.id };
}

/** Give a text box a different style (title, caption, …); it follows that style from now on. */
export function setTextRole(doc: BookDocument, spreadId: string, elementId: string, role: TextRole): BookDocument {
  return produce(doc, (d) => {
    const el = findElement(findSpread(d, spreadId), elementId);
    if (el.type !== 'text') return;
    Object.assign(el, { role, ...styleFields(d.style as BookStyle, role, roleSizePt(d as BookDocument, role)), styleLinked: true });
  });
}

/** Drop manual font/size edits: back to its style. */
export function resetTextToStyle(doc: BookDocument, spreadId: string, elementId: string): BookDocument {
  const el = findSurface(doc, spreadId)?.surface.elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'text') return doc;
  return setTextRole(doc, spreadId, elementId, el.role);
}

/** Make this box's look the style for its role; every box following that role updates. */
export function saveTextAsRoleStyle(doc: BookDocument, spreadId: string, elementId: string): BookDocument {
  const el = findSurface(doc, spreadId)?.surface.elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'text') return doc;
  const next = setRoleStyle(doc, el.role, {
    family: el.fontFamily, weight: el.fontWeight, sizePt: el.fontSizePt / pageScale(doc), lineHeight: el.lineHeight,
    letterSpacingEm: el.letterSpacingEm ?? 0, uppercase: !!el.uppercase,
  });
  return updateElement(next, spreadId, elementId, { styleLinked: true });
}

/** Resize the frame to the photo's aspect ratio, keeping its centre and area. */
export function fitFrameToPhoto(doc: BookDocument, spreadId: string, elementId: string, asset: PhotoAsset): BookDocument {
  return produce(doc, (d) => {
    const el = findElement(findSpread(d, spreadId), elementId);
    if (el.type !== 'image') return;
    const area = el.widthMm * el.heightMm;
    const ar = aspectOf(asset);
    const w = Math.sqrt(area * ar);
    const h = w / ar;
    el.xMm += (el.widthMm - w) / 2;
    el.yMm += (el.heightMm - h) / 2;
    el.widthMm = w;
    el.heightMm = h;
    el.crop = { ...el.crop, zoom: 1 };
  });
}

// ---- spreads ------------------------------------------------------------------------------

/** Middle spreads only: the first (with page 1) and last (with the final page) stay put. */
const isMiddle = (doc: BookDocument, i: number) => i > 0 && i < doc.spreads.length - 1;

export function insertSpreadAfter(doc: BookDocument, index: number): BookDocument {
  return produce(doc, (d) => {
    const at = Math.min(Math.max(index + 1, 1), d.spreads.length - 1);
    const s = blankSpread();
    s.chapterId = d.spreads[at - 1]?.chapterId;
    d.spreads.splice(at, 0, s as Draft<Spread>);
  });
}

export function duplicateSpread(doc: BookDocument, index: number): BookDocument {
  if (!isMiddle(doc, index)) throw new CommandError('Only inner spreads can be duplicated');
  return produce(doc, (d) => {
    const copy = structuredClone(d.spreads[index]) as Spread;
    copy.id = newId();
    copy.locked = false;
    copy.elements = copy.elements.map((e) => ({ ...e, id: newId() }));
    d.spreads.splice(index + 1, 0, copy as Draft<Spread>);
  });
}

export function removeSpread(doc: BookDocument, index: number): BookDocument {
  if (!isMiddle(doc, index)) throw new CommandError('The first and last spreads hold the opening and closing pages');
  if (doc.spreads[index].locked) throw new CommandError('Unlock the spread before deleting it');
  return produce(doc, (d) => {
    d.spreads.splice(index, 1);
  });
}

export function moveSpread(doc: BookDocument, from: number, to: number): BookDocument {
  if (!isMiddle(doc, from) || !isMiddle(doc, to)) throw new CommandError('Only inner spreads can be moved');
  return produce(doc, (d) => {
    const [s] = d.spreads.splice(from, 1);
    d.spreads.splice(to, 0, s);
  });
}

export function setSpreadLocked(doc: BookDocument, spreadId: string, locked: boolean): BookDocument {
  return produce(doc, (d) => {
    findSpread(d, spreadId).locked = locked;
  });
}

export function setSpreadChapter(doc: BookDocument, spreadId: string, chapterId: string | undefined): BookDocument {
  return produce(doc, (d) => {
    findSpread(d, spreadId).chapterId = chapterId;
  });
}

export function addChapter(doc: BookDocument, title: string): { doc: BookDocument; newId: string } {
  const id = newId();
  return { doc: produce(doc, (d) => void d.chapters.push({ id, title })), newId: id };
}

export function renameChapter(doc: BookDocument, chapterId: string, title: string): BookDocument {
  return produce(doc, (d) => {
    const c = d.chapters.find((x) => x.id === chapterId);
    if (c) c.title = title;
  });
}

// ---- book ---------------------------------------------------------------------------------

export function setTitle(doc: BookDocument, title: string, subtitle?: string): BookDocument {
  return produce(doc, (d) => {
    d.title = title;
    if (subtitle !== undefined) d.subtitle = subtitle;
  });
}

export function updateSettings(doc: BookDocument, patch: Partial<BookSettings>): BookDocument {
  return produce(doc, (d) => void Object.assign(d.settings, patch));
}

export function updateStyle(doc: BookDocument, patch: Partial<BookStyle>): BookDocument {
  const next = produce(doc, (d) => void Object.assign(d.style, patch));
  // Text that follows its style takes the new text/paper colour (muted tones depend on both).
  return patch.textColor !== undefined || patch.background !== undefined ? recolorLinkedText(next) : next;
}

/** Switch style preset. Existing layouts keep their geometry; regenerate or re-apply layouts to restyle them. */
export function applyStylePreset(doc: BookDocument, presetId: string): BookDocument {
  // Linked text follows the preset's type pack immediately; layouts keep their geometry.
  return recolorLinkedText(restyleText(doc, styleFromPreset(presetId)));
}

// ---- layouts ------------------------------------------------------------------------------

function elementsOnSide(spread: Spread, side: PageSide | 'spread', doc: BookDocument): Element[] {
  if (side === 'spread') return spread.elements;
  return spread.elements.filter((e) => pageOfElement(e, doc) === side);
}

/** Left page before right, then top-to-bottom in ~10 mm bands, then left-to-right. */
function readingOrder<T extends Element>(els: T[], spineMm = Infinity): T[] {
  const key = (e: Element) => [e.xMm + e.widthMm / 2 < spineMm ? 0 : 1, Math.round((e.yMm + e.heightMm / 2) / 10), e.xMm] as const;
  return [...els].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
}

/**
 * Apply a template to one page (or the whole spread), keeping that page's photos in reading order.
 * Surplus photos fall back to the library; extra slots become empty frames. Locked elements stay.
 */
export function applyTemplate(
  doc: BookDocument,
  spreadIndex: number,
  side: PageSide | 'spread',
  templateId: string,
  assets: Map<string, PhotoAsset>,
): BookDocument {
  const t = templateOrThrow(templateId);
  const spread = doc.spreads[spreadIndex];
  if (!spread) throw new CommandError('Spread not found');
  if (spread.locked) throw new CommandError('Spread is locked');
  const target: PageSide | 'spread' = t.scope === 'spread' ? 'spread' : side === 'spread' ? 'right' : side;
  const affected = target === 'spread' ? spread.elements : elementsOnSide(spread, target, doc);
  const keep = affected.filter((e) => e.locked);
  const photos = readingOrder(affected.filter((e): e is ImageElement => e.type === 'image' && !e.locked && !!e.assetId), doc.settings.trimWidthMm)
    .map((e) => assets.get(e.assetId!))
    .filter((a): a is PhotoAsset => !!a);
  const oldText = affected.filter((e) => e.type === 'text' && !e.locked);
  const textOf = (role: string) => oldText.find((e) => e.type === 'text' && e.role === role);
  const captionText = textOf('caption');
  const text = {
    caption: captionText?.type === 'text' ? captionText.text : dateRangeOf(photos) || undefined,
    title: doc.title,
    subtitle: doc.subtitle,
    heading: (textOf('heading') as { text?: string } | undefined)?.text,
  };
  let fresh = layoutPage(doc, t, target, photos, text);
  fresh = fresh.map((el) => (el.type === 'image' && el.assetId ? keepSubjectOutOfGutter(el, assets.get(el.assetId)!, doc) : el));
  return produce(doc, (d) => {
    const s = d.spreads[spreadIndex];
    const affectedIds = new Set(affected.map((e) => e.id));
    s.elements = [...s.elements.filter((e) => !affectedIds.has(e.id)), ...(fresh as Draft<Element>[]), ...(keep as Draft<Element>[])];
    s.layout = target === 'spread' ? { spread: t.id } : { ...(s.layout?.spread ? {} : s.layout), [target]: t.id };
  });
}

/**
 * Re-lay out a spread with the same photos but a different arrangement.
 * Deterministic for a given seed; each call with a new seed gives a new variation.
 */
export function shuffleSpreadLayout(doc: BookDocument, spreadIndex: number, assets: Map<string, PhotoAsset>, seed: number): BookDocument {
  const spread = doc.spreads[spreadIndex];
  if (!spread) throw new CommandError('Spread not found');
  if (spread.locked) throw new CommandError('Spread is locked — unlock it to change its layout');
  const preset = stylePreset(doc.style.presetId);
  const rng = mulberry32(seed);
  const n = doc.spreads.length;
  const sides: PageSide[] = spreadIndex === 0 ? ['right'] : spreadIndex === n - 1 ? ['left'] : ['left', 'right'];
  const lockedEls = spread.elements.filter((e) => e.locked);
  const photos = readingOrder(spread.elements.filter((e): e is ImageElement => e.type === 'image' && !e.locked && !!e.assetId), doc.settings.trimWidthMm)
    .map((e) => assets.get(e.assetId!))
    .filter((a): a is PhotoAsset => !!a);
  if (!photos.length) throw new CommandError('No photos on this spread to rearrange');
  const captions = doc.generation?.settings.includeCaptions !== false && doc.style.captionMode === 'date';
  const current = spread.layout ?? {};

  const elements: Element[] = [];
  const layout: Spread['layout'] = {};
  const options: { left: number; right: number; panorama?: boolean }[] = [];
  if (sides.length === 2) {
    if (photos.length === 1 && aspectOf(photos[0]) >= 1.2) options.push({ left: 0, right: 0, panorama: true });
    for (let l = 0; l <= photos.length; l++) {
      const r = photos.length - l;
      if (l <= preset.maxPerPage && r <= preset.maxPerPage && (photos.length < 2 || (l > 0 && r > 0))) options.push({ left: l, right: r });
    }
  }
  const pick = options.length ? options[Math.floor(rng() * options.length)] : { left: sides[0] === 'left' ? photos.length : 0, right: sides[0] === 'right' ? photos.length : 0 };
  if (pick.panorama && current.spread !== 'panorama') {
    const t = templateOrThrow('panorama');
    elements.push(...layoutPage(doc, t, 'spread', photos, {}).map((el) => (el.type === 'image' ? keepSubjectOutOfGutter(el, photos[0], doc) : el)));
    layout.spread = t.id;
  } else {
    let cursor = 0;
    for (const side of sides) {
      const count = side === 'left' ? pick.left : pick.right;
      const pagePhotos = photos.slice(cursor, cursor + Math.min(count, 6));
      cursor += count;
      if (!pagePhotos.length) continue;
      const avoid = [current[side] ?? '', layout.left ?? ''];
      if (preset.layoutMode === 'mosaic' && pagePhotos.length >= 2) {
        const shuffled = pagePhotos.map((p) => ({ p, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.p);
        elements.push(...layoutCollage(doc, pageContentRect(side, doc.settings, doc.style), shuffled, { style: 'mosaic', gapMm: doc.style.gapMm, seed }).elements);
        layout[side] = MOSAIC_LAYOUT;
        continue;
      }
      const special = spreadIndex === 0 && side === 'right' && pagePhotos.length === 1;
      const t = special ? templateOrThrow('title-photo') : chooseTemplate(preset, pagePhotos, avoid, rng, doc, side);
      const text = special ? { title: doc.title, subtitle: doc.subtitle } : { caption: captions ? dateRangeOf(pagePhotos) || undefined : undefined };
      elements.push(...layoutPage(doc, t, side, pagePhotos, text));
      layout[side] = t.id;
    }
  }
  return produce(doc, (d) => {
    const s = d.spreads[spreadIndex];
    s.elements = [...(elements as Draft<Element>[]), ...(lockedEls as Draft<Element>[])];
    s.layout = layout;
  });
}

export function templateName(id: string | undefined): string {
  if (id === MOSAIC_LAYOUT) return 'Mosaic';
  return (id && findTemplate(id)?.name) || 'Custom';
}

/** Lay out one page (or the whole spread) as an edge-to-edge mosaic of its current photos. */
export function applyMosaicLayout(doc: BookDocument, spreadIndex: number, side: PageSide | 'spread', assets: Map<string, PhotoAsset>, seed = 1): BookDocument {
  const spread = doc.spreads[spreadIndex];
  if (!spread) throw new CommandError('Spread not found');
  if (spread.locked) throw new CommandError('Spread is locked');
  const affected = side === 'spread' ? spread.elements : elementsOnSide(spread, side, doc);
  const photos = readingOrder(affected.filter((e): e is ImageElement => e.type === 'image' && !e.locked && !!e.assetId), doc.settings.trimWidthMm)
    .map((e) => assets.get(e.assetId!))
    .filter((a): a is PhotoAsset => !!a);
  if (photos.length < 2) throw new CommandError('A mosaic needs at least two photos on the page');
  const box = side === 'spread'
    ? { x: doc.style.marginOuterMm, y: doc.style.marginTopMm, w: doc.settings.trimWidthMm * 2 - 2 * doc.style.marginOuterMm, h: doc.settings.trimHeightMm - doc.style.marginTopMm - doc.style.marginBottomMm }
    : pageContentRect(side, doc.settings, doc.style);
  const { elements } = layoutCollage(doc, box, photos, { style: 'mosaic', gapMm: doc.style.gapMm, seed });
  const keepIds = new Set(affected.filter((e) => e.type !== 'image' || e.locked).map((e) => e.id));
  const affectedIds = new Set(affected.map((e) => e.id));
  return produce(doc, (d) => {
    const s = d.spreads[spreadIndex];
    s.elements = [...s.elements.filter((e) => !affectedIds.has(e.id) || keepIds.has(e.id)), ...(elements as Draft<Element>[])];
    s.layout = side === 'spread' ? { spread: MOSAIC_LAYOUT } : { ...(s.layout?.spread ? {} : s.layout), [side]: MOSAIC_LAYOUT };
  });
}

export function pageRect(doc: BookDocument, side: PageSide) {
  return pageTrimRect(side, doc.settings);
}

// ---- cover -----------------------------------------------------------------------------------

/** Create a cover (for books made before covers existed) or re-lay it out with a template. */
export function applyCoverTemplate(doc: BookDocument, templateId: string, assets: Map<string, PhotoAsset>, fallback: PhotoAsset[] = []): BookDocument {
  if (doc.cover?.locked) throw new CommandError('The cover is locked — unlock it to change its layout');
  let photos = coverPhotos(doc, assets);
  if (!photos.front && !photos.back) {
    // Use the title photo if there is one, else the first photos in the book.
    const used = doc.spreads.flatMap((s) => s.elements).filter((e): e is ImageElement => e.type === 'image' && !!e.assetId).map((e) => assets.get(e.assetId!)).filter((a): a is PhotoAsset => !!a);
    photos = chooseCoverPhotos(used.length ? used : fallback, () => 0, used[0]);
  }
  return { ...doc, cover: makeCover(doc, templateId, photos, doc.cover?.id) };
}

export function setCoverLocked(doc: BookDocument, locked: boolean): BookDocument {
  if (!doc.cover) return doc;
  return { ...doc, cover: { ...doc.cover, locked } };
}

export function setSurfaceBackground(doc: BookDocument, spreadId: string, background: string | undefined): BookDocument {
  return produce(doc, (d) => {
    findSpread(d, spreadId).background = background;
  });
}

/** Switch printer / binding / size. Existing layouts are not rescaled; the cover follows the new spine. */
export function applyPrinter(doc: BookDocument, printerId: PrinterId, bindingId: BindingId, sizeId?: string): BookDocument {
  const settings = { ...doc.settings, ...presetSettings(doc.settings, printerId, bindingId, sizeId, pageCountOf(doc)) };
  return reconcileCover({ ...doc, settings });
}
