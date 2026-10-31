// @ts-expect-error -- registerStdFonts exists only in PDFKit's browser build (not in @types/pdfkit)
import { registerStdFonts } from 'pdfkit';
import Helvetica from 'pdfkit/standard-fonts/Helvetica';
import type { BookDocument, PhotoAsset, PreflightIssue } from '../../../core';
import { renderCover, renderInterior, renderPoster, verifyPdf, type ExportOptions, type ExportVerification, type ImageCut, type PdfEnv, type PdfOutput, type Rendered } from '../../../shared/pdfWriter';
import { decode, resized } from './canvas';
import { fontBytes } from './fonts';
import { serve } from './rpc';

// Print PDFs in a worker: the server's drawing code (src/shared/pdfWriter.ts) with the photos cut
// and scaled on an OffscreenCanvas instead of sharp. Each photo is decoded once, cut to its
// printed size at 300 DPI and encoded, then dropped, so memory stays near one photo at a time.

(registerStdFonts as (...f: object[]) => void)(Helvetica);

export interface WorkerAsset {
  asset: PhotoAsset;
  file: Blob;
}

export interface PdfFile {
  blob: Blob;
  bytes: number;
  verification: ExportVerification;
  textOverflow: PreflightIssue[];
}

/** The last decoded photo: a photo placed twice in a row (spread + detail) decodes once. */
let lastDecoded: { id: string; bitmap: ImageBitmap } | null = null;

async function bitmapFor(entry: WorkerAsset) {
  if (lastDecoded?.id === entry.asset.id) return lastDecoded.bitmap;
  lastDecoded?.bitmap.close();
  lastDecoded = null;
  const bitmap = await decode(entry.file, entry.asset.fileName);
  lastDecoded = { id: entry.asset.id, bitmap };
  return bitmap;
}

const env: PdfEnv<WorkerAsset> = {
  font: fontBytes,
  imageCacheLimit: 4,
  async image(entry, cut: ImageCut) {
    const bitmap = await bitmapFor(entry);
    const c = resized(bitmap, cut.outWidth, cut.outHeight, {
      crop: { x: cut.left, y: cut.top, w: cut.width, h: cut.height },
      background: cut.cutout ? undefined : '#ffffff',
    });
    if (cut.grade) applyGrade(c, cut.grade);
    const blob = await c.convertToBlob(cut.cutout ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
    return new Uint8Array(await blob.arrayBuffer());
  },
};

/** rgb' = M·rgb + o, the same grade the editor and the server apply (alpha untouched). */
function applyGrade(c: OffscreenCanvas, { m, o }: { m: number[]; o: number[] }) {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const o0 = o[0] * 255;
  const o1 = o[1] * 255;
  const o2 = o[2] * 255;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = m[0] * r + m[1] * g + m[2] * b + o0;
    d[i + 1] = m[3] * r + m[4] * g + m[5] * b + o1;
    d[i + 2] = m[6] * r + m[7] * g + m[8] * b + o2;
  }
  ctx.putImageData(img, 0, 0);
}

function memoryOutput() {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const out: PdfOutput = {
    write(chunk) {
      chunks.push(chunk);
      bytes += chunk.byteLength;
    },
    close: async () => bytes,
  };
  const data = () => {
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return all;
  };
  return { out, chunks, data };
}

async function file(render: (out: PdfOutput) => Promise<Rendered>): Promise<PdfFile & { rendered: Rendered }> {
  const mem = memoryOutput();
  const rendered = await render(mem.out);
  lastDecoded?.bitmap.close();
  lastDecoded = null;
  const verification = await verifyPdf(mem.data(), rendered.specs);
  return { blob: new Blob(mem.chunks as BlobPart[], { type: 'application/pdf' }), bytes: rendered.bytes, verification, textOverflow: rendered.textOverflow, rendered };
}

const assetMap = (assets: WorkerAsset[]) => new Map(assets.map((a) => [a.asset.id, a]));

async function interior(doc: BookDocument, assets: WorkerAsset[], options: ExportOptions = {}) {
  const map = assetMap(assets);
  const f = await file((out) => renderInterior(doc, map, env, out, options));
  const r = f.rendered as Awaited<ReturnType<typeof renderInterior>>;
  return { blob: f.blob, bytes: f.bytes, verification: f.verification, textOverflow: f.textOverflow, issues: r.issues, durationMs: r.durationMs, bleedMode: r.bleedMode };
}

async function cover(doc: BookDocument, assets: WorkerAsset[]) {
  const map = assetMap(assets);
  const f = await file((out) => renderCover(doc, map, env, out));
  return { blob: f.blob, bytes: f.bytes, verification: f.verification, textOverflow: f.textOverflow, spineMm: (f.rendered as Rendered & { spineMm: number }).spineMm };
}

async function poster(doc: BookDocument, assets: WorkerAsset[]) {
  const map = assetMap(assets);
  const f = await file((out) => renderPoster(doc, map, env, out));
  const r = f.rendered as Awaited<ReturnType<typeof renderPoster>>;
  return { blob: f.blob, bytes: f.bytes, verification: f.verification, textOverflow: f.textOverflow, issues: r.issues, durationMs: r.durationMs, bleedMode: r.bleedMode };
}

serve({ interior, cover, poster });
