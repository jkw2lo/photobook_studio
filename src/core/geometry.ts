import type { Crop, Element, FitMode, ImageElement, PhotoAsset, Rect } from './model';
import { clamp, mmToInch } from './units';

// The single source of truth for how a photo sits inside its frame.
// Both the CSS preview and the PDF exporter call imagePlacement(); nothing else computes crops.

export interface Size {
  w: number;
  h: number;
}

/** The frame's photo area: the frame minus its border. Frame-local mm. */
export function innerBox(el: Pick<ImageElement, 'widthMm' | 'heightMm' | 'borderMm'>): Rect {
  const b = Math.max(0, Math.min(el.borderMm, el.widthMm / 2 - 0.5, el.heightMm / 2 - 0.5));
  return { x: b, y: b, w: el.widthMm - 2 * b, h: el.heightMm - 2 * b };
}

/**
 * Where the *whole* source image lands, relative to the inner box origin (mm).
 * The image may extend beyond the box; the box clips it.
 *
 * cover:   baseline scale fills the box; zoom ≥ 1 enlarges. The image always covers the box.
 * contain: baseline scale fits the whole image in the box; zoom ≥ 1 enlarges. Centred while smaller.
 * (cx, cy) is the normalized source point placed at the box centre, clamped so no gap appears.
 */
export function imagePlacement(box: Size, img: Size, crop: Crop, fit: FitMode): Rect {
  const zoom = Math.max(1, crop.zoom || 1);
  const base = fit === 'cover' ? Math.max(box.w / img.w, box.h / img.h) : Math.min(box.w / img.w, box.h / img.h);
  const s = base * zoom;
  const w = img.w * s;
  const h = img.h * s;
  return { x: placeAxis(box.w, w, crop.cx), y: placeAxis(box.h, h, crop.cy), w, h };
}

function placeAxis(boxLen: number, imgLen: number, c: number): number {
  if (imgLen <= boxLen) return (boxLen - imgLen) / 2;
  return clamp(boxLen / 2 - c * imgLen, boxLen - imgLen, 0);
}

/** The crop that a placement actually shows (after clamping). Used to store a clean crop after panning. */
export function cropFromPlacement(box: Size, placement: Rect, zoom: number): Crop {
  return {
    cx: clamp((box.w / 2 - placement.x) / placement.w, 0, 1),
    cy: clamp((box.h / 2 - placement.y) / placement.h, 0, 1),
    zoom,
  };
}

export interface VisibleRegion {
  /** Destination rect inside the inner box (mm, box-local). */
  dest: Rect;
  /** Matching source rect, normalized 0..1 of the oriented source image. */
  src: Rect;
}

/** Intersection of the placed image with its box — exactly what is visible on the page. */
export function visibleRegion(box: Size, placement: Rect): VisibleRegion | null {
  const x0 = Math.max(0, placement.x);
  const y0 = Math.max(0, placement.y);
  const x1 = Math.min(box.w, placement.x + placement.w);
  const y1 = Math.min(box.h, placement.y + placement.h);
  if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return null;
  return {
    dest: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    src: {
      x: (x0 - placement.x) / placement.w,
      y: (y0 - placement.y) / placement.h,
      w: (x1 - x0) / placement.w,
      h: (y1 - y0) / placement.h,
    },
  };
}

export function elementPlacement(el: ImageElement, asset: Pick<PhotoAsset, 'widthPx' | 'heightPx'>) {
  const box = innerBox(el);
  const placement = imagePlacement(box, { w: asset.widthPx, h: asset.heightPx }, el.crop, el.fit);
  return { box, placement, visible: visibleRegion(box, placement) };
}

/** Pixels per inch the photo will print at, given its frame size and crop. */
export function effectiveDpi(el: ImageElement, asset: Pick<PhotoAsset, 'widthPx' | 'heightPx'>): number {
  const { visible } = elementPlacement(el, asset);
  if (!visible) return 0;
  const dpiX = (visible.src.w * asset.widthPx) / mmToInch(visible.dest.w);
  const dpiY = (visible.src.h * asset.heightPx) / mmToInch(visible.dest.h);
  return Math.min(dpiX, dpiY);
}

/** Default crop: centred on the photo's saliency point, softened toward the middle. */
export function defaultCrop(asset: Pick<PhotoAsset, 'analysis'> | null | undefined): Crop {
  const sx = asset?.analysis?.saliencyX ?? 0.5;
  const sy = asset?.analysis?.saliencyY ?? 0.45;
  return { cx: 0.5 + (sx - 0.5) * 0.7, cy: 0.5 + (sy - 0.5) * 0.7, zoom: 1 };
}

// ---- Rect helpers -------------------------------------------------------------------------

export const rectRight = (r: Rect) => r.x + r.w;
export const rectBottom = (r: Rect) => r.y + r.h;

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function containsRect(outer: Rect, inner: Rect, eps = 0.01): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

export function elementRect(el: Pick<Element, 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>): Rect {
  return { x: el.xMm, y: el.yMm, w: el.widthMm, h: el.heightMm };
}

/** Axis-aligned bounding box of a rotated element. */
export function elementBounds(el: Pick<Element, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg'>): Rect {
  const r = elementRect(el);
  const rad = (el.rotationDeg * Math.PI) / 180;
  if (Math.abs(rad) < 1e-9) return r;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = r.w * cos + r.h * sin;
  const h = r.w * sin + r.h * cos;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Is a spread-space point inside a (possibly rotated) element? */
export function pointInElement(el: Element, px: number, py: number): boolean {
  const cx = el.xMm + el.widthMm / 2;
  const cy = el.yMm + el.heightMm / 2;
  const rad = (-el.rotationDeg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= el.widthMm / 2 && Math.abs(ly) <= el.heightMm / 2;
}
