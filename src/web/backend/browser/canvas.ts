import { fitInside } from './analysis';

// Canvas helpers shared by the workers (OffscreenCanvas: no DOM needed).

export type Source = ImageBitmap | OffscreenCanvas;

export function canvas(w: number, h: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/**
 * Draw `src` (or the `crop` of it) at w × h. Large reductions go down in halves first: a single
 * huge downscale aliases in some browsers.
 */
export function resized(src: Source, w: number, h: number, opts: { background?: string; crop?: { x: number; y: number; w: number; h: number } } = {}): OffscreenCanvas {
  let cur: Source = src;
  let crop = opts.crop ?? { x: 0, y: 0, w: src.width, h: src.height };
  while (crop.w / w > 2.5 && crop.h / h > 2.5) {
    const hw = Math.max(w, Math.round(crop.w / 2));
    const hh = Math.max(h, Math.round(crop.h / 2));
    const [c, ctx] = canvas(hw, hh);
    ctx.drawImage(cur, crop.x, crop.y, crop.w, crop.h, 0, 0, hw, hh);
    cur = c;
    crop = { x: 0, y: 0, w: hw, h: hh };
  }
  const [c, ctx] = canvas(w, h);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(cur, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  return c;
}

export const fitted = (src: Source, box: number, opts: { background?: string; enlarge?: boolean } = {}) => {
  const s = fitInside(src.width, src.height, box, opts.enlarge);
  return resized(src, s.w, s.h, opts);
};

export function pixels(c: OffscreenCanvas): Uint8ClampedArray {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
}

let webp: Promise<boolean> | null = null;
/** Whether this browser can encode WebP (Safari can't: it returns PNG instead). */
export const canEncodeWebp = () => (webp ??= new OffscreenCanvas(2, 2).convertToBlob({ type: 'image/webp' }).then((b) => b.type === 'image/webp', () => false));

/** Decode a photo, EXIF orientation applied. HEIC only decodes where the browser supports it (Safari). */
export async function decode(file: Blob, name = ''): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (/\.hei[cf]$/i.test(name) || /hei[cf]/i.test(file.type)) throw new Error('This browser can’t open HEIC photos. Use Safari, or convert them to JPEG first.');
    throw new Error('Could not read this image');
  }
}
