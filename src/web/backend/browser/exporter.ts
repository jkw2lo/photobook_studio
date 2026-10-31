import { coverDims, coverGeometry, printablePages, type BookDocument, type Rect } from '../../../core';
import { flipbookHtml, type FlipbookData } from '../../../shared/flipbookViewer';
import type { ExportResponse, FlipbookResponse, ImageExportResponse } from '../types';
import type { PdfFile, WorkerAsset } from './export.worker';
import { WorkerPool } from './pool';

// Exports in the web version. PDFs are drawn in a worker (export.worker.ts); posters as images and
// the flipbook are rendered from those verified PDFs with pdf.js (raster.ts). Results are blob:
// URLs that live as long as the page — download them to keep them.

const FLIPBOOK_SIZES = { standard: 1400, sharp: 2200 } as const;

type PdfResult = PdfFile & { issues: ExportResponse['issues']; durationMs: number; bleedMode: 'all' | 'outer' };

export class BrowserExporter {
  private pool: WorkerPool | null = null;
  private urls: string[] = [];

  private worker() {
    // One worker: PDFs are big; two at once would double the memory for little gain.
    return (this.pool ??= new WorkerPool(() => new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' }), 1));
  }

  private url(blob: Blob) {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    // Keep the last few exports' links working; older ones are freed.
    while (this.urls.length > 12) URL.revokeObjectURL(this.urls.shift()!);
    return u;
  }

  async pdf(doc: BookDocument, assets: WorkerAsset[], bleedMode?: 'all' | 'outer'): Promise<ExportResponse> {
    const { safeTitle, stamp } = names(doc, 'photobook');
    if (doc.settings.product === 'poster') {
      const r = await this.worker().call<PdfResult>('poster', doc, assets);
      const file = `${safeTitle}-${stamp}-poster.pdf`;
      return { file, url: this.url(r.blob), bytes: r.bytes, verification: r.verification, issues: r.issues, textOverflow: r.textOverflow, durationMs: r.durationMs, bleedMode: r.bleedMode, cover: null };
    }
    const r = await this.worker().call<PdfResult>('interior', doc, assets, bleedMode ? { bleedMode } : {});
    const file = `${safeTitle}-${stamp}-interior.pdf`;
    let cover: ExportResponse['cover'] = null;
    if (doc.cover) {
      const c = await this.worker().call<PdfFile & { spineMm: number }>('cover', doc, assets);
      const coverFile = `${safeTitle}-${stamp}-cover.pdf`;
      cover = { file: coverFile, url: this.url(c.blob), bytes: c.bytes, spineMm: c.spineMm, verification: c.verification, textOverflow: c.textOverflow };
    }
    return { file, url: this.url(r.blob), bytes: r.bytes, verification: r.verification, issues: r.issues, textOverflow: r.textOverflow, durationMs: r.durationMs, bleedMode: r.bleedMode, cover };
  }

  /** Poster as PNG/JPEG: the print PDF rendered at `dpi`, cut to the trim. */
  async posterImage(doc: BookDocument, assets: WorkerAsset[], format: 'png' | 'jpeg', dpiAsked: number): Promise<ImageExportResponse> {
    if (doc.settings.product !== 'poster') throw new Error('Image export is for posters');
    const { renderCrops, openPdf, toBlob, MAX_CANVAS_PIXELS } = await import('./raster');
    const s = doc.settings;
    const pageW = s.trimWidthMm + 2 * s.bleedMm;
    const pageH = s.trimHeightMm + 2 * s.bleedMm;
    // Keep within what a canvas can hold: very large posters at 300 DPI drop to what fits.
    const maxDpi = Math.sqrt(MAX_CANVAS_PIXELS / ((pageW / 25.4) * (pageH / 25.4)));
    const dpi = Math.max(36, Math.min(dpiAsked, 600, maxDpi));
    const r = await this.worker().call<PdfResult>('poster', doc, assets);
    const pdf = await openPdf(r.blob);
    try {
      const [c] = await renderCrops(pdf, 0, { w: pageW, h: pageH }, [{ x: s.bleedMm, y: s.bleedMm, w: s.trimWidthMm, h: s.trimHeightMm }], dpi / 25.4);
      const blob = format === 'jpeg' ? await toBlob(c, 'image/jpeg', 0.92) : await toBlob(c, 'image/png');
      const { safeTitle, stamp } = names(doc, 'poster');
      const file = `${safeTitle}-${stamp}-${Math.round(dpi)}dpi.${format === 'jpeg' ? 'jpg' : 'png'}`;
      return { file, url: this.url(blob), bytes: blob.size, widthPx: c.width, heightPx: c.height, dpi: Math.round(dpi), format };
    } finally {
      await pdf.loadingTask.destroy();
    }
  }

  /** Book as one self-contained HTML flipbook, pages cut from the verified print PDFs. */
  async flipbook(doc: BookDocument, assets: WorkerAsset[], size: 'standard' | 'sharp'): Promise<FlipbookResponse> {
    if (doc.settings.product === 'poster') throw new Error('The flipbook is for books — export a poster as an image instead.');
    const started = Date.now();
    const { renderCrops, openPdf, toBlob, pageImageType, dataUri } = await import('./raster');
    const s = doc.settings;
    const longPx = FLIPBOOK_SIZES[size];
    const quality = size === 'sharp' ? 0.84 : 0.8;
    const type = await pageImageType();
    // Interior with bleed on all four sides, so every page crops the same way.
    const interior = await this.worker().call<PdfResult>('interior', doc, assets, { bleedMode: 'all' });
    const b = s.bleedMm;
    const pageMm = { w: s.trimWidthMm + 2 * b, h: s.trimHeightMm + 2 * b };
    const trim: Rect = { x: b, y: b, w: s.trimWidthMm, h: s.trimHeightMm };
    const pxPerMm = longPx / Math.max(trim.w, trim.h);
    const printable = printablePages(doc);
    const pdf = await openPdf(interior.blob);
    const pages: FlipbookData['pages'] = [];
    let first = { w: 0, h: 0 };
    try {
      for (let i = 0; i < pdf.numPages; i++) {
        const [c] = await renderCrops(pdf, i, pageMm, [trim], pxPerMm);
        if (i === 0) first = { w: c.width, h: c.height };
        pages.push({ src: await dataUri(await toBlob(c, type, quality)), pageNumber: printable[i].pageNumber });
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
    const indexOf = new Map(printable.map((p, i) => [`${p.spreadIndex}:${p.side}`, i]));
    const spreads = doc.spreads.map((_, si) => [indexOf.get(`${si}:left`) ?? null, indexOf.get(`${si}:right`) ?? null] as [number | null, number | null]);

    let front: string | null = null;
    let back: string | null = null;
    const { panelW, panelH } = coverDims(doc);
    if (doc.cover) {
      const c = await this.worker().call<PdfFile>('cover', doc, assets);
      const g = coverGeometry(doc);
      const sheet = { w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed };
      const spine = g.spine?.mm ?? 0;
      const coverPdf = await openPdf(c.blob);
      try {
        const [bk, fr] = await renderCrops(coverPdf, 0, sheet, [
          { x: g.bleed, y: g.bleed, w: panelW, h: panelH },
          { x: g.bleed + panelW + spine, y: g.bleed, w: panelW, h: panelH },
        ], longPx / Math.max(panelW, panelH));
        back = await dataUri(await toBlob(bk, type, quality));
        front = await dataUri(await toBlob(fr, type, quality));
      } finally {
        await coverPdf.loadingTask.destroy();
      }
    }
    const data: FlipbookData = { title: doc.title, pageW: s.trimWidthMm, pageH: s.trimHeightMm, coverW: panelW, coverH: panelH, front, back, pages, spreads };
    const blob = new Blob([flipbookHtml(data)], { type: 'text/html' });
    const { safeTitle, stamp } = names(doc, 'photobook');
    return { file: `${safeTitle}-${stamp}-flipbook.html`, url: this.url(blob), bytes: blob.size, pages: pages.length, hasCover: !!doc.cover, widthPx: first.w, heightPx: first.h, durationMs: Date.now() - started };
  }
}

function names(doc: BookDocument, fallback: string) {
  const safeTitle = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || fallback;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return { safeTitle, stamp };
}
