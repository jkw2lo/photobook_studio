import type { BookDocument, Element, ImageElement, PhotoAsset, ShapeElement, TextElement, TextRole } from './model';
import { pageTrimRect, type PageSide } from './book';
import { aspectOf } from './curation';
import { defaultCrop, imagePlacement, innerBox } from './geometry';
import { newId, type Rng } from './random';
import type { StylePreset } from './styles';
import { pageTemplatesFor, resolveTemplate, template, type LayoutTemplate } from './templates';
import { clamp } from './units';
import { roleSizePt, styleFields } from './typography';

// Turning (template + photos) into concrete page elements. Shared by the generator and by
// manual "apply layout" / "shuffle layout" commands so both produce identical results.

/** Point size for a role on this page (from the book's type styles). */
export function textSizeFor(role: TextRole, doc: Pick<BookDocument, 'settings' | 'style'>): number {
  return roleSizePt(doc, role);
}

export function makeTextElement(
  doc: Pick<BookDocument, 'settings' | 'style'>,
  role: TextRole,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  opts: { align?: 'left' | 'center' | 'right'; rotationDeg?: number } = {},
): TextElement {
  return {
    id: newId(), type: 'text', text, role,
    xMm: rect.x, yMm: rect.y, widthMm: rect.w, heightMm: rect.h,
    rotationDeg: opts.rotationDeg ?? 0, locked: false,
    ...styleFields(doc.style, role, roleSizePt(doc, role)),
    align: opts.align ?? 'center',
    styleLinked: true,
  };
}

export function makeImageElement(
  doc: Pick<BookDocument, 'style'>,
  asset: PhotoAsset | null,
  rect: { x: number; y: number; w: number; h: number },
  rotationDeg = 0,
  fullBleed = false,
): ImageElement {
  return {
    id: newId(), type: 'image', assetId: asset?.id ?? null,
    xMm: rect.x, yMm: rect.y, widthMm: rect.w, heightMm: rect.h, rotationDeg, locked: false,
    crop: defaultCrop(asset), fit: 'cover',
    // Bleed photos never get a border: it would print as a white frame at the trim edge.
    borderMm: fullBleed ? 0 : doc.style.imageBorderMm,
    borderColor: doc.style.imageBorderColor,
  };
}

export function makeShapeElement(rect: { x: number; y: number; w: number; h: number }, fill: string, opacity = 1): ShapeElement {
  return { id: newId(), type: 'shape', xMm: rect.x, yMm: rect.y, widthMm: rect.w, heightMm: rect.h, rotationDeg: 0, locked: false, fill, opacity };
}

/** DPI a photo would print at if it filled (cover) a slot of this size. */
export function coverDpi(slot: { w: number; h: number }, photo: Pick<PhotoAsset, 'widthPx' | 'heightPx'>): number {
  const mmPerPx = Math.max(slot.w / photo.widthPx, slot.h / photo.heightPx);
  return 25.4 / mmPerPx;
}

export interface SlotSize {
  w: number;
  h: number;
}

/**
 * Best slot↔photo assignment. Cost per photo = |ln(slotAspect / photoAspect)| (how much gets cropped)
 * plus a penalty when the photo would print below `minDpi` in that slot, so low-resolution photos
 * gravitate to small frames. Returns the mean cost and the assignment (order[slot] = photo index).
 */
export function bestAssignment(slots: SlotSize[], photos: PhotoAsset[], minDpi = 0): { cost: number; order: number[] } {
  const n = photos.length;
  const idx = photos.map((_, i) => i);
  let best = { cost: Infinity, order: idx };
  const permute = (arr: number[], k: number) => {
    if (k === arr.length) {
      let cost = 0;
      let inversions = 0;
      for (let i = 0; i < n; i++) {
        const photo = photos[arr[i]];
        cost += Math.abs(Math.log(slots[i].w / slots[i].h / aspectOf(photo)));
        if (minDpi > 0) {
          const dpi = coverDpi(slots[i], photo);
          if (dpi < minDpi) cost += 0.6 + 1.5 * (1 - dpi / minDpi);
        }
        for (let j = i + 1; j < n; j++) if (arr[i] > arr[j]) inversions++;
      }
      // Tiny tie-breaker keeps chronological reading order when fit is equal.
      cost = cost / Math.max(1, n) + inversions * 0.002;
      if (cost < best.cost) best = { cost, order: [...arr] };
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(idx, 0);
  return best;
}

export interface CaptionSource {
  caption?: string;
  title?: string;
  subtitle?: string;
  heading?: string;
}

/** Build the elements of one page from a template. */
export function layoutPage(
  doc: Pick<BookDocument, 'settings' | 'style'>,
  t: LayoutTemplate,
  side: PageSide | 'spread',
  photos: PhotoAsset[],
  text: CaptionSource,
): Element[] {
  const resolved = resolveTemplate(t, side, doc.settings, doc.style);
  const imageSlots = resolved.filter((r) => r.slot.kind === 'image');
  const { order } = bestAssignment(imageSlots.map((r) => r.rect), photos.slice(0, imageSlots.length), minDpiFor(doc));
  const elements: Element[] = [];
  let imageIndex = 0;
  for (const r of resolved) {
    if (r.slot.kind === 'image') {
      const asset = photos[order[imageIndex]] ?? null;
      imageIndex++;
      elements.push(makeImageElement(doc, asset, r.rect, r.rotationDeg, r.slot.box === 'bleed'));
    } else {
      const role = r.slot.role ?? 'body';
      const value = role === 'caption' ? text.caption : role === 'title' ? text.title : role === 'heading' ? text.heading : text.subtitle;
      if (!value) continue; // empty text slots are omitted rather than shown as placeholder text
      elements.push(makeTextElement(doc, role, value, r.rect, { align: r.slot.align, rotationDeg: r.rotationDeg }));
    }
  }
  return elements;
}

/**
 * Choose the best template for a page holding `photos`.
 * Weighs style preference, aspect-ratio fit, and avoids repeating the previous or facing page.
 */
export function chooseTemplate(
  preset: StylePreset,
  photos: PhotoAsset[],
  avoid: string[],
  rng: Rng,
  doc: Pick<BookDocument, 'settings' | 'style'>,
  side: PageSide,
  /** 0.5 = mild randomness (the default "best" draft); larger values explore more for variations. */
  explore = 0.5,
): LayoutTemplate {
  let candidates = pageTemplatesFor(photos.length).filter((t) => (preset.templateWeights[t.id] ?? 0) > 0);
  if (!candidates.length) candidates = pageTemplatesFor(photos.length);
  if (!candidates.length) throw new Error(`No template holds ${photos.length} photos`);
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const t of candidates) {
    const weight = preset.templateWeights[t.id] ?? 0.1;
    const slots = resolveTemplate(t, side, doc.settings, doc.style).filter((r) => r.slot.kind === 'image');
    const { cost } = bestAssignment(slots.map((r) => r.rect), photos, minDpiFor(doc));
    const fit = Math.exp(-2.2 * cost);
    const repeat = avoid.includes(t.id) ? 0.3 : 1;
    const score = weight * fit * repeat * (1 - explore / 2 + explore * rng());
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * For an image spanning the spine, shift the crop so the photo's saliency point does not land
 * inside the binding zone (where it would disappear into the fold). If panning alone has no room
 * (photo barely wider than the spread), zoom in slightly — up to 1.35× — to create room.
 */
export function keepSubjectOutOfGutter(el: ImageElement, asset: PhotoAsset, doc: Pick<BookDocument, 'settings'>): ImageElement {
  return placeSubjectOffSpine(el, asset, doc).el;
}

export function placeSubjectOffSpine(el: ImageElement, asset: PhotoAsset, doc: Pick<BookDocument, 'settings'>): { el: ImageElement; ok: boolean } {
  const spine = doc.settings.trimWidthMm;
  if (!(el.xMm < spine && el.xMm + el.widthMm > spine)) return { el, ok: true };
  const box = innerBox(el);
  const img = { w: asset.widthPx, h: asset.heightPx };
  const sal = asset.analysis?.saliencyX ?? 0.5;
  const salXFor = (crop: ImageElement['crop']) => {
    const p = imagePlacement(box, img, crop, el.fit);
    return { x: el.xMm + box.x + p.x + sal * p.w, p };
  };
  const band = doc.settings.bindingZoneMm * 1.5;
  const start = salXFor(el.crop);
  if (Math.abs(start.x - spine) >= band) return { el, ok: true };
  const toLeft = start.x < spine; // move the subject to the side it is already on
  for (let zoom = Math.max(1, el.crop.zoom); zoom <= 1.351; zoom += 0.05) {
    const cur = salXFor({ ...el.crop, zoom });
    const targetX = toLeft ? spine - band : spine + band;
    const cx = clamp(el.crop.cx - (targetX - cur.x) / cur.p.w, 0, 1);
    const crop = { ...el.crop, cx, zoom: Math.round(zoom * 100) / 100 };
    if (Math.abs(salXFor(crop).x - spine) >= doc.settings.bindingZoneMm) return { el: { ...el, crop }, ok: true };
  }
  return { el, ok: false };
}

const minDpiFor = (doc: Pick<BookDocument, 'settings'>) => doc.settings?.minDpiWarning ?? 200;

export function templateOrThrow(id: string): LayoutTemplate {
  const t = template(id);
  if (!t) throw new Error(`Unknown template ${id}`);
  return t;
}

export function pageOfElement(el: Element, doc: Pick<BookDocument, 'settings'>): PageSide {
  const cx = el.xMm + el.widthMm / 2;
  return cx < pageTrimRect('right', doc.settings).x ? 'left' : 'right';
}
