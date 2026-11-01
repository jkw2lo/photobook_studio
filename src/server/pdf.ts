import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { printablePages, type BookDocument, type PhotoAsset, type PreflightIssue } from '../core';
import {
  renderCover, renderInterior, renderPoster, verifyPdf as verifyBytes,
  type ExportOptions, type ExportVerification, type ImageCut, type PageSpec, type PdfEnv, type PdfOutput,
} from '../shared/pdfWriter';

// Print export on the local server. The drawing lives in src/shared/pdfWriter.ts (shared with the
// web version); this module supplies sharp for the photos, the font files from disk, and writes
// each PDF to a file. Every export is re-opened from disk and verified.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export type { ExportOptions, ExportVerification };

export interface FileResult {
  path: string;
  bytes: number;
  verification: ExportVerification;
}

export interface ExportResult extends FileResult {
  issues: PreflightIssue[];
  textOverflow: PreflightIssue[];
  durationMs: number;
  bleedMode: import('../core').BleedMode;
}

export interface ExportAsset {
  asset: PhotoAsset;
  /** File sharp can decode (original, or the HEIC→JPEG conversion). */
  workPath: string;
}

const env: PdfEnv<ExportAsset> = {
  font: (file) => readFile(join(ROOT, file)),
  async image(entry, cut: ImageCut) {
    let img = sharp(entry.workPath, { failOn: 'none' })
      .rotate() // EXIF orientation first, so extract() works in the same oriented space as the preview
      .extract({ left: cut.left, top: cut.top, width: cut.width, height: cut.height })
      .resize(cut.outWidth, cut.outHeight, { fit: 'fill' });
    img = cut.cutout ? img.ensureAlpha() : img.flatten({ background: '#ffffff' });
    // The colour grade: the same rgb' = M·rgb + o the editor applies (alpha untouched), done on the
    // finished pixels in one step and clamped once. (As sharp's recomb + linear, the negative values
    // an invert produces get clamped between the two steps after a resize, and print white.)
    if (cut.grade) img = await applyGrade(img.toColourspace('srgb'), cut.grade);
    return cut.cutout ? img.png({ compressionLevel: 6 }).toBuffer() : img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  },
};

/** A colour grade (rgb' = M·rgb + o, sRGB 0–1) applied to an image's final 8-bit pixels; alpha is left alone. */
async function applyGrade(img: Sharp, { m, o }: { m: number[]; o: number[] }): Promise<Sharp> {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.from(data);
  const ob = o.map((v) => v * 255);
  const clamp = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let i = 0; i < out.length; i += ch) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    out[i] = clamp(m[0] * r + m[1] * g + m[2] * b + ob[0]);
    out[i + 1] = clamp(m[3] * r + m[4] * g + m[5] * b + ob[1]);
    out[i + 2] = clamp(m[6] * r + m[7] * g + m[8] * b + ob[2]);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: ch } });
}

function fileOutput(path: string): PdfOutput {
  const stream = createWriteStream(path);
  const finished = new Promise<void>((res, rej) => {
    stream.on('finish', () => res());
    stream.on('error', rej);
  });
  return {
    write: (chunk) => void stream.write(chunk),
    async close() {
      stream.end();
      await finished;
      return (await stat(path)).size;
    },
  };
}

/** Re-open the written file and check page count, MediaBox and TrimBox against what was intended. */
export async function verifyPdf(path: string, expected: PageSpec[]): Promise<ExportVerification> {
  return verifyBytes(await readFile(path), expected);
}

/** Interior: one PDF page per printed page, trim + bleed, TrimBox/BleedBox set. */
export async function exportPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string, options: ExportOptions = {}): Promise<ExportResult> {
  const r = await renderInterior(doc, assets, env, fileOutput(outPath), options);
  return { path: outPath, bytes: r.bytes, issues: r.issues, textOverflow: r.textOverflow, verification: await verifyPdf(outPath, r.specs), durationMs: r.durationMs, bleedMode: r.bleedMode };
}

/** Cover: a single page — back, spine and front — with the wrap/bleed around it. */
export async function exportCoverPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string): Promise<FileResult & { textOverflow: PreflightIssue[]; spineMm: number }> {
  const r = await renderCover(doc, assets, env, fileOutput(outPath));
  return { path: outPath, bytes: r.bytes, verification: await verifyPdf(outPath, r.specs), textOverflow: r.textOverflow, spineMm: r.spineMm };
}

/** Poster: one page, the sheet plus bleed on every side. */
export async function exportPosterPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string): Promise<ExportResult> {
  const r = await renderPoster(doc, assets, env, fileOutput(outPath));
  return { path: outPath, bytes: r.bytes, issues: r.issues, textOverflow: r.textOverflow, verification: await verifyPdf(outPath, r.specs), durationMs: r.durationMs, bleedMode: r.bleedMode };
}

export { printablePages };
