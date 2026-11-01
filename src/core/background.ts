import { produce } from 'immer';
import type { BackgroundImage, BookDocument, ImageElement, PhotoAsset, Spread } from './model';
import { defaultCrop } from './geometry';
import { findSurface } from './surface';

// Background images: one photo behind everything on a surface (a poster sheet, a cover, a spread),
// out to the bleed. It is not an element, so Arrange, Shuffle and templates never move or replace
// it. For drawing, export and preflight it becomes a virtual image frame covering the surface.

/** The background as a frame covering the surface and its bleed (id `<surface>:bg`). */
export function backgroundFrame(surface: Pick<Spread, 'id' | 'backgroundImage'>, g: { width: number; height: number; bleed: number }): ImageElement | null {
  const bg = surface.backgroundImage;
  if (!bg) return null;
  // A fitted photo moved or resized on the desktop sits in its own box; otherwise it covers the
  // surface and its bleed.
  const boxed = bg.fit === 'contain' && bg.box;
  const r = boxed ? bg.box! : { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed };
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
    crop: boxed ? { cx: 0.5, cy: 0.5, zoom: 1 } : bg.crop,
    fit: bg.fit,
    borderMm: 0,
    borderColor: '#ffffff',
    opacity: bg.opacity,
    adjust: bg.adjust,
  };
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
    const prev = s.backgroundImage;
    s.backgroundImage = { assetId: asset.id, fit: prev?.fit ?? 'cover', opacity: prev?.opacity ?? 1, crop: defaultCrop(asset) };
  });
}

export function updateBackgroundImage(doc: BookDocument, surfaceId: string, patch: Partial<Omit<BackgroundImage, 'assetId'>>): BookDocument {
  return withSurface(doc, surfaceId, (s) => {
    if (s.backgroundImage) Object.assign(s.backgroundImage, patch);
  });
}

/** Move a photo off the layout and behind everything: the frame is removed, its photo becomes the background. */
export function useAsBackground(doc: BookDocument, surfaceId: string, elementId: string, asset: PhotoAsset): BookDocument {
  const next = setBackgroundImage(doc, surfaceId, asset);
  return withSurface(next, surfaceId, (s) => {
    s.elements = s.elements.filter((e) => e.id !== elementId);
  });
}
