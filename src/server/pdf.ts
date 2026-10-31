import { createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';
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
    // The colour grade: the same rgb' = M·rgb + o the editor applies (alpha untouched).
    if (cut.grade) {
      const { m, o } = cut.grade;
      img = cut.cutout
        ? img.recomb([[m[0], m[1], m[2], 0], [m[3], m[4], m[5], 0], [m[6], m[7], m[8], 0], [0, 0, 0, 1]]).linear([1, 1, 1, 1], [o[0] * 255, o[1] * 255, o[2] * 255, 0])
        : img.recomb([[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]).linear([1, 1, 1], [o[0] * 255, o[1] * 255, o[2] * 255]);
    }
    return cut.cutout ? img.png({ compressionLevel: 6 }).toBuffer() : img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
  },
};

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
