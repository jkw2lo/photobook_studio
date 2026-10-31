import { produce } from 'immer';
import type { BackgroundImage, BookDocument, ImageElement, PhotoAsset, Rect, Spread } from './model';
import { defaultCrop, imagePlacement, panCrop, zoomCropAt } from './geometry';
import { findSurface } from './surface';

// Background images: one photo behind everything on a surface (a poster sheet, a cover, a spread),
// out to the bleed. It is not an element, so Arrange, Shuffle and templates never move or replace
// it. For drawing, export and preflight it becomes a virtual image frame covering the surface.

type Geom = { width: number; height: number; bleed: number };

/** The surface out to its bleed: what a filling background covers. */
export const backgroundArea = (g: Geom): Rect => ({ x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed });

/** Where a fitted ('contain') background sits: its own box, or as large as fits, centred. */
export function backgroundBox(bg: BackgroundImage, g: Geom, asset: Pick<PhotoAsset, 'widthPx' | 'heightPx'> | undefined): Rect {
  const area = backgroundArea(g);
  if (bg.box) return bg.box;
  if (!asset) return area;
  const p = imagePlacement(area, { w: asset.widthPx, h: asset.heightPx }, { cx: 0.5, cy: 0.5, zoom: 1 }, 'contain');
  return { x: area.x + p.x, y: area.y + p.y, w: p.w, h: p.h };
}

/**
 * The background as a frame (id `<surface>:bg`): covering the surface and its bleed, or — fitted
 * and moved — the photo's own box.
 */
export function backgroundFrame(surface: Pick<Spread, 'id' | 'backgroundImage'>, g: Geom): ImageElement | null {
  const bg = surface.backgroundImage;
  if (!bg) return null;
  const r = bg.fit === 'contain' && bg.box ? bg.box : backgroundArea(g);
  return {
    id: `${surface.id}:bg`,
    type: 'image',
    assetId: bg.assetId,
    xMm: r.x,
    yMm: r.y,
    widthMm: r.w,
    heightMm: r.h,
    rotationDeg: 0,
    locked: true,
    crop: bg.fit === 'contain' && bg.box ? { cx: 0.5, cy: 0.5, zoom: 1 } : bg.crop,
    fit: bg.fit,
    borderMm: 0,
    borderColor: '#ffffff',
    opacity: bg.opacity,
    adjust: bg.adjust,
  };
}

/** Move the background by (dx, dy) mm: a filling photo pans inside the sheet, a fitted one moves on it. */
export function moveBackground(bg: BackgroundImage, g: Geom, asset: Pick<PhotoAsset, 'widthPx' | 'heightPx'>, dx: number, dy: number): Partial<BackgroundImage> {
  if (bg.fit === 'contain') {
    const b = backgroundBox(bg, g, asset);
    return { box: { ...b, x: b.x + dx, y: b.y + dy } };
  }
  return { crop: panCrop(backgroundArea(g), { w: asset.widthPx, h: asset.heightPx }, bg.crop, 'cover', dx, dy) };
}

/**
 * Scale the background by `factor` about a surface point: a filling photo zooms (never below
 * filling the sheet), a fitted one grows or shrinks (from a tenth of the sheet to four times it).
 */
export function scaleBackground(bg: BackgroundImage, g: Geom, asset: Pick<PhotoAsset, 'widthPx' | 'heightPx'>, factor: number, at: { x: number; y: number }): Partial<BackgroundImage> {
  const area = backgroundArea(g);
  if (bg.fit === 'contain') {
    const b = backgroundBox(bg, g, asset);
    const fitted = backgroundBox({ ...bg, box: undefined }, g, asset);
    const k = Math.max(0.1, Math.min(4, (b.w * factor) / fitted.w)) * (fitted.w / b.w);
    return { box: { x: at.x - (at.x - b.x) * k, y: at.y - (at.y - b.y) * k, w: b.w * k, h: b.h * k } };
  }
  return { crop: zoomCropAt(area, { w: asset.widthPx, h: asset.heightPx }, bg.crop, 'cover', factor, { x: at.x - area.x, y: at.y - area.y }) };
}

function withSurface(doc: BookDocument, surfaceId: string, fn: (s: Spread) => void): BookDocument {
  if (!findSurface(doc, surfaceId)) return doc;
  return produce(doc, (d) => {
    const s = d.cover?.id === surfaceId ? d.cover : d.spreads.find((x) => x.id === surfaceId);
    if (s) fn(s as Spread);
  });
}

/** Put a photo behind everything on a surface (null removes it). Keeps fit and opacity when replacing. */
export function setBackgroundImage(doc: BookDocument, surfaceId: string, asset: PhotoAsset | null): BookDocument {
  return withSurface(doc, surfaceId, (s) => {
    if (!asset) {
      delete s.backgroundImage;
      return;
    }
    // A new photo keeps the fit and fade, but not the old one's position or adjustments.
    const prev = s.backgroundImage;
    s.backgroundImage = { assetId: asset.id, fit: prev?.fit ?? 'cover', opacity: prev?.opacity ?? 1, crop: defaultCrop(asset) };
  });
}

export function updateBackgroundImage(doc: BookDocument, surfaceId: string, patch: Partial<Omit<BackgroundImage, 'assetId'>>): BookDocument {
  return withSurface(doc, surfaceId, (s) => {
    if (!s.backgroundImage) return;
    Object.assign(s.backgroundImage, patch);
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete s.backgroundImage[k];
  });
}

/** Move a photo off the layout and behind everything: the frame is removed, its photo becomes the background. */
export function useAsBackground(doc: BookDocument, surfaceId: string, elementId: string, asset: PhotoAsset): BookDocument {
  const next = setBackgroundImage(doc, surfaceId, asset);
  return withSurface(next, surfaceId, (s) => {
    s.elements = s.elements.filter((e) => e.id !== elementId);
  });
}
