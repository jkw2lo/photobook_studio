import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Rect } from '../../../core';

// Turning the verified print PDF into pictures (poster PNG/JPEG, flipbook pages), with pdf.js.
// The server does the same step with macOS `sips`; rendering the PDF rather than redrawing the
// page means the images show exactly what will be printed.

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Canvases larger than this fail in Safari (16.7 Mpx); other browsers allow more, but stay safe. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false }).promise;
}

/**
 * Render page `index` (0-based) so that `pageMm` maps to the given pixel scale, and cut out each
 * rect (mm, page coordinates from the top-left), flattened on white.
 */
export async function renderCrops(pdf: PDFDocumentProxy, index: number, pageMm: { w: number; h: number }, rects: Rect[], pxPerMm: number): Promise<HTMLCanvasElement[]> {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = (pxPerMm * pageMm.w) / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise;
  page.cleanup();
  const k = canvas.width / pageMm.w;
  const out = rects.map((r) => {
    const left = Math.round(r.x * k);
    const top = Math.round(r.y * k);
    const w = Math.min(canvas.width - left, Math.round(r.w * k));
    const h = Math.min(canvas.height - top, Math.round(r.h * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(canvas, left, top, w, h, 0, 0, w, h);
    return c;
  });
  canvas.width = canvas.height = 0; // free the full render now
  return out;
}

export function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality));
}

let webp: boolean | null = null;
/** WebP where the browser can encode it (not Safari), else JPEG. */
export async function pageImageType(): Promise<'image/webp' | 'image/jpeg'> {
  if (webp === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    webp = (await toBlob(c, 'image/webp').catch(() => null))?.type === 'image/webp';
  }
  return webp ? 'image/webp' : 'image/jpeg';
}

export function dataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
