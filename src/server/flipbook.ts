import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { coverDims, coverGeometry, printablePages, type BookDocument, type Rect } from '../core';
import { flipbookHtml, type FlipbookData } from './flipbookViewer';
import { exportCoverPdf, exportPdf, type ExportAsset } from './pdf';

// Books as a shareable web flipbook. Every page is cut from the same verified print PDF (rendered
// by macOS, like poster images), so the flipbook shows exactly what will be printed: fonts,
// cut-outs, transparency, colour grade. Pages are trimmed (no bleed), saved as WebP and embedded
// in one HTML file with the viewer (see flipbookViewer.ts).

const run = promisify(execFile);

/** Long edge of each page image, in pixels. */
export const FLIPBOOK_SIZES = { standard: 1400, sharp: 2200 } as const;
export type FlipbookSize = keyof typeof FLIPBOOK_SIZES;

export interface FlipbookResult {
  path: string;
  bytes: number;
  pages: number;
  hasCover: boolean;
  widthPx: number;
  heightPx: number;
  durationMs: number;
}

/**
 * Render a one-page PDF with the system renderer and cut out each rect (mm) as WebP. The render is
 * scaled so a rect (not the whole page with its bleed) gets `longPx` on its long edge.
 */
async function renderCrops(pdfPath: string, pageMm: { w: number; h: number }, rects: Rect[], longPx: number, quality: number): Promise<{ buf: Buffer; w: number; h: number }[]> {
  const png = `${pdfPath}.png`;
  const renderPx = Math.round(longPx * (Math.max(pageMm.w, pageMm.h) / Math.max(rects[0].w, rects[0].h)));
  await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', String(renderPx), pdfPath, '--out', png]);
  try {
    const meta = await sharp(png).metadata();
    const k = (meta.width ?? 1) / pageMm.w;
    return await Promise.all(rects.map(async (rect) => {
      const left = Math.round(rect.x * k);
      const top = Math.round(rect.y * k);
      const w = Math.min((meta.width ?? 0) - left, Math.round(rect.w * k));
      const h = Math.min((meta.height ?? 0) - top, Math.round(rect.h * k));
      const buf = await sharp(png).extract({ left, top, width: w, height: h }).flatten({ background: '#ffffff' }).webp({ quality }).toBuffer();
      return { buf, w, h };
    }));
  } finally {
    await rm(png, { force: true });
  }
}

const dataUri = (buf: Buffer) => `data:image/webp;base64,${buf.toString('base64')}`;

/** Run `fn` over `items`, a few at a time (sips is single-threaded). */
async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export async function exportFlipbook(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string, opts: { size: FlipbookSize }): Promise<FlipbookResult> {
  if (process.platform !== 'darwin') throw new Error('The flipbook needs macOS (it uses the system PDF renderer) in this version.');
  if (doc.settings.product === 'poster') throw new Error('The flipbook is for books — export a poster as an image instead.');
  const started = Date.now();
  const s = doc.settings;
  const longPx = FLIPBOOK_SIZES[opts.size];
  const quality = opts.size === 'sharp' ? 84 : 80;
  const tmp = await mkdtemp(join(dirname(outPath), '.flipbook-'));
  try {
    // Interior with bleed on all four sides, so every page crops the same way.
    const interior = join(tmp, 'interior.pdf');
    await exportPdf(doc, assets, interior, { bleedMode: 'all' });
    const b = s.bleedMm;
    const pageMm = { w: s.trimWidthMm + 2 * b, h: s.trimHeightMm + 2 * b };
    const trim: Rect = { x: b, y: b, w: s.trimWidthMm, h: s.trimHeightMm };
    const src = await PDFDocument.load(await readFile(interior));
    const printable = printablePages(doc);
    // sips renders only the first page of a PDF: split it into one file per page.
    const files: string[] = [];
    for (let i = 0; i < src.getPageCount(); i++) {
      const one = await PDFDocument.create();
      const [p] = await one.copyPages(src, [i]);
      one.addPage(p);
      const f = join(tmp, `page-${i}.pdf`);
      await writeFile(f, await one.save());
      files.push(f);
    }
    const rendered = await pool(files, 4, async (f) => (await renderCrops(f, pageMm, [trim], longPx, quality))[0]);
    const pages = rendered.map((r, i) => ({ src: dataUri(r.buf), pageNumber: printable[i].pageNumber }));
    const indexOf = new Map(printable.map((p, i) => [`${p.spreadIndex}:${p.side}`, i]));
    const spreads = doc.spreads.map((_, si) => [indexOf.get(`${si}:left`) ?? null, indexOf.get(`${si}:right`) ?? null] as [number | null, number | null]);

    let front: string | null = null;
    let back: string | null = null;
    const { panelW, panelH } = coverDims(doc);
    if (doc.cover) {
      const coverPdf = join(tmp, 'cover.pdf');
      await exportCoverPdf(doc, assets, coverPdf);
      const g = coverGeometry(doc);
      const sheet = { w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed };
      const spine = g.spine?.mm ?? 0;
      const [bk, fr] = await renderCrops(coverPdf, sheet, [
        { x: g.bleed, y: g.bleed, w: panelW, h: panelH },
        { x: g.bleed + panelW + spine, y: g.bleed, w: panelW, h: panelH },
      ], longPx, quality);
      back = dataUri(bk.buf);
      front = dataUri(fr.buf);
    }

    const data: FlipbookData = {
      title: doc.title,
      pageW: s.trimWidthMm,
      pageH: s.trimHeightMm,
      coverW: panelW,
      coverH: panelH,
      front,
      back,
      pages,
      spreads,
    };
    await writeFile(outPath, flipbookHtml(data));
    return {
      path: outPath,
      bytes: (await stat(outPath)).size,
      pages: pages.length,
      hasCover: !!doc.cover,
      widthPx: rendered[0]?.w ?? 0,
      heightPx: rendered[0]?.h ?? 0,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
