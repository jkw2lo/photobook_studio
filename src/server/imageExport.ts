import { execFile } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { BookDocument } from '../core';
import { exportPosterPdf, type ExportAsset } from './pdf';

// Posters as images (PNG or JPEG) for sharing or printing at home. The poster is exported to the
// same verified PDF as for print, rendered by macOS (sips, the system PDF renderer) at the asked
// resolution, then cropped to the trim — so the image is exactly what the print shop would get.

const run = promisify(execFile);

export const MAX_IMAGE_PX = 14000;

export interface ImageExportResult {
  path: string;
  bytes: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  format: 'png' | 'jpeg';
}

export async function exportPosterImage(
  doc: BookDocument,
  assets: Map<string, ExportAsset>,
  outPath: string,
  opts: { format: 'png' | 'jpeg'; dpi: number },
): Promise<ImageExportResult> {
  if (process.platform !== 'darwin') throw new Error('Image export needs macOS (it uses the system PDF renderer) in this version.');
  const s = doc.settings;
  const inch = (mm: number) => mm / 25.4;
  const pageW = s.trimWidthMm + 2 * s.bleedMm;
  const pageH = s.trimHeightMm + 2 * s.bleedMm;
  // Keep within a sensible size: very large posters at 300 DPI drop to what fits.
  const dpi = Math.max(36, Math.min(opts.dpi, MAX_IMAGE_PX / inch(Math.max(pageW, pageH))));
  const pdf = `${outPath}.tmp.pdf`;
  const png = `${outPath}.tmp.png`;
  try {
    await exportPosterPdf(doc, assets, pdf);
    const longPx = Math.round(inch(Math.max(pageW, pageH)) * dpi);
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(longPx), pdf, '--out', png]);
    const meta = await sharp(png).metadata();
    const k = (meta.width ?? 1) / pageW; // rendered pixels per mm
    const left = Math.round(s.bleedMm * k);
    const top = Math.round(s.bleedMm * k);
    const width = Math.min((meta.width ?? 0) - left, Math.round(s.trimWidthMm * k));
    const height = Math.min((meta.height ?? 0) - top, Math.round(s.trimHeightMm * k));
    let img = sharp(png).extract({ left, top, width, height }).withMetadata({ density: Math.round(dpi) });
    img = opts.format === 'jpeg' ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }) : img.png({ compressionLevel: 7 });
    await img.toFile(outPath);
    return { path: outPath, bytes: (await stat(outPath)).size, widthPx: width, heightPx: height, dpi: Math.round(dpi), format: opts.format };
  } finally {
    await rm(pdf, { force: true });
    await rm(png, { force: true });
  }
}
