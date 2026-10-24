import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import sharp from 'sharp';
import {
  COVER_INDEX, coverGeometry, posterGeometry, elementBounds, elementPlacement, fontFilePath, intersects, mmToInch, mmToPt, nearestWeight,
  pageNumberRect, preflight, printablePages, roleStyle, type BleedMode, type BookDocument, type Element, type ImageElement,
  type PhotoAsset, type PreflightIssue, type Rect, type TextElement,
} from '../core';

// Print export. Geometry comes from core (same functions the editor preview uses); this module only
// translates millimetres to points and pixels. Every export is re-opened and verified afterwards.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TARGET_DPI = 300;

export interface ExportOptions {
  /** Overrides the book's printer setting. 'all': bleed on all four sides; 'outer': none at the spine. */
  bleedMode?: BleedMode;
}

export interface ExportVerification {
  ok: boolean;
  pageCount: number;
  expectedPageCount: number;
  pageSizeMm: { width: number; height: number };
  trimSizeMm: { width: number; height: number };
  problems: string[];
}

export interface FileResult {
  path: string;
  bytes: number;
  verification: ExportVerification;
}

export interface ExportResult extends FileResult {
  issues: PreflightIssue[];
  textOverflow: PreflightIssue[];
  durationMs: number;
  bleedMode: BleedMode;
}

export interface ExportAsset {
  asset: PhotoAsset;
  /** File sharp can decode (original, or the HEIC→JPEG conversion). */
  workPath: string;
}

/** Expected box geometry of one PDF page, in mm, for verification. */
interface PageSpec {
  pageW: number;
  pageH: number;
  trim: Rect;
}

class PdfWriter {
  readonly pdf: PDFKit.PDFDocument;
  private readonly done: Promise<void>;
  private readonly fonts = new Set<string>();
  private readonly imageCache = new Map<string, Buffer>();
  readonly overflow: { elementId: string; label: string; spreadIndex: number }[] = [];

  constructor(readonly outPath: string, title: string, private readonly assets: Map<string, ExportAsset>) {
    this.pdf = new PDFDocument({ autoFirstPage: false, compress: true, info: { Title: title, Creator: 'Photobook Studio', Producer: 'Photobook Studio (PDFKit)' } });
    const stream = createWriteStream(outPath);
    this.pdf.pipe(stream);
    this.done = new Promise((res, rej) => {
      stream.on('finish', () => res());
      stream.on('error', rej);
    });
  }

  useFont(family: string, weight: number) {
    const w = nearestWeight(family, weight);
    const name = `${family}-${w}`;
    if (!this.fonts.has(name)) {
      this.pdf.registerFont(name, join(ROOT, fontFilePath(family, w)));
      this.fonts.add(name);
    }
    this.pdf.font(name);
  }

  /** Start a page whose top-left corner is at (originX, originY) in surface coordinates. */
  page(spec: PageSpec, background: string) {
    const { pdf } = this;
    pdf.addPage({ size: [mmToPt(spec.pageW), mmToPt(spec.pageH)], margin: 0 });
    // PDF boxes use a bottom-left origin.
    const H = mmToPt(spec.pageH);
    const t = spec.trim;
    const page = pdf.page as unknown as { dictionary: { data: Record<string, number[]> } };
    page.dictionary.data.TrimBox = [mmToPt(t.x), H - mmToPt(t.y + t.h), mmToPt(t.x + t.w), H - mmToPt(t.y)].map(r3);
    page.dictionary.data.BleedBox = [0, 0, mmToPt(spec.pageW), H].map(r3);
    pdf.rect(0, 0, mmToPt(spec.pageW), H).fill(background);
  }

  /** Draw the elements of a surface that touch `area` (surface coordinates), offset by its origin. */
  async elements(elements: Element[], area: Rect, spreadIndex: number, label: string) {
    const { pdf } = this;
    for (const el of elements) {
      if (!intersects(elementBounds(el), area)) continue;
      pdf.save();
      // Element frame: translate to its centre, rotate, then work in element-local mm (top-left origin).
      pdf.translate(mmToPt(el.xMm + el.widthMm / 2 - area.x), mmToPt(el.yMm + el.heightMm / 2 - area.y));
      if (el.rotationDeg) pdf.rotate(el.rotationDeg);
      pdf.translate(-mmToPt(el.widthMm / 2), -mmToPt(el.heightMm / 2));
      if (el.type === 'image') await this.image(el);
      else if (el.type === 'shape') {
        pdf.fillOpacity(el.opacity).rect(0, 0, mmToPt(el.widthMm), mmToPt(el.heightMm)).fill(el.fill);
      } else if (this.text(el) && !this.overflow.some((o) => o.elementId === el.id)) {
        this.overflow.push({ elementId: el.id, label, spreadIndex });
      }
      pdf.restore();
    }
  }

  private async image(el: ImageElement) {
    const { pdf } = this;
    if (el.borderMm > 0) pdf.rect(0, 0, mmToPt(el.widthMm), mmToPt(el.heightMm)).fill(el.borderColor);
    const entry = el.assetId ? this.assets.get(el.assetId) : undefined;
    if (!entry) return; // empty frame or missing photo: preflight reports it; nothing is printed
    const { box, visible } = elementPlacement(el, entry.asset);
    if (!visible) return;
    const { asset } = entry;
    const left = Math.max(0, Math.floor(visible.src.x * asset.widthPx));
    const top = Math.max(0, Math.floor(visible.src.y * asset.heightPx));
    const width = Math.max(1, Math.min(asset.widthPx - left, Math.round(visible.src.w * asset.widthPx)));
    const height = Math.max(1, Math.min(asset.heightPx - top, Math.round(visible.src.h * asset.heightPx)));
    // Never upsample; downsample to 300 DPI at the printed size.
    const tw = Math.max(1, Math.min(width, Math.round(mmToInch(visible.dest.w) * TARGET_DPI)));
    const th = Math.max(1, Math.min(height, Math.round(mmToInch(visible.dest.h) * TARGET_DPI)));
    const key = `${asset.id}|${left},${top},${width},${height}|${tw}x${th}`;
    let buf = this.imageCache.get(key);
    if (!buf) {
      buf = await sharp(entry.workPath, { failOn: 'none' })
        .rotate() // EXIF orientation first, so extract() works in the same oriented space as the preview
        .extract({ left, top, width, height })
        .resize(tw, th, { fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer();
      this.imageCache.set(key, buf);
    }
    pdf.image(buf, mmToPt(box.x + visible.dest.x), mmToPt(box.y + visible.dest.y), { width: mmToPt(visible.dest.w), height: mmToPt(visible.dest.h) });
  }

  /** Returns true if the text overflows its box. */
  private text(el: TextElement): boolean {
    const { pdf } = this;
    this.useFont(el.fontFamily, el.fontWeight);
    pdf.fontSize(el.fontSizePt).fillColor(el.color);
    // Same transforms as the editor's CSS (text-transform: uppercase, letter-spacing in em).
    const text = el.uppercase ? el.text.toUpperCase() : el.text;
    const characterSpacing = (el.letterSpacingEm ?? 0) * el.fontSizePt;
    // Match CSS line-height: line box = lineHeight × size, with half-leading above the first line.
    const natural = pdf.currentLineHeight(false);
    const lineBox = el.lineHeight * el.fontSizePt;
    const lineGap = lineBox - natural;
    const opts = { width: mmToPt(el.widthMm), align: el.align, lineGap, characterSpacing } as const;
    const boxH = mmToPt(el.heightMm);
    const overflow = pdf.heightOfString(text, opts) > boxH + 1;
    // A bounded height also stops PDFKit from ever starting a new page for long text.
    pdf.text(text, 0, lineGap / 2, { ...opts, height: boxH * 1.5 + lineBox });
    return overflow;
  }

  async finish(): Promise<number> {
    this.pdf.end();
    await this.done;
    return (await readFile(this.outPath)).byteLength;
  }
}

/** Interior: one PDF page per printed page, trim + bleed, TrimBox/BleedBox set. */
export async function exportPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string, options: ExportOptions = {}): Promise<ExportResult> {
  const started = Date.now();
  const s = doc.settings;
  const W = s.trimWidthMm;
  const H = s.trimHeightMm;
  const b = s.bleedMm;
  const bleedMode = options.bleedMode ?? s.bleedMode ?? 'all';
  const spineBleed = bleedMode === 'all' ? b : 0;
  const pageW = W + b + spineBleed;
  const pageH = H + 2 * b;
  const issues = preflight(doc, new Map([...assets].map(([id, a]) => [id, a.asset])));
  const w = new PdfWriter(outPath, doc.title, assets);
  const specs: PageSpec[] = [];

  for (const page of printablePages(doc)) {
    const spread = doc.spreads[page.spreadIndex];
    // Spread-space x of this PDF page's left edge (its bleed edge).
    const originX = page.side === 'left' ? -b : W - spineBleed;
    const spec: PageSpec = { pageW, pageH, trim: { x: page.side === 'left' ? b : spineBleed, y: b, w: W, h: H } };
    specs.push(spec);
    w.page(spec, spread.background ?? doc.style.background);
    await w.elements(spread.elements, { x: originX, y: -b, w: pageW, h: pageH }, page.spreadIndex, `Page ${page.pageNumber}`);
    if (s.pageNumbers && page.pageNumber > 1) {
      const r = pageNumberRect(page.side, s);
      w.useFont(roleStyle(doc.style, 'caption').family, 400);
      w.pdf.fontSize(8).fillColor(doc.style.textColor);
      w.pdf.text(String(page.pageNumber), mmToPt(r.x - originX), mmToPt(r.y + b), { width: mmToPt(r.w), align: page.side === 'left' ? 'left' : 'right', lineBreak: false });
    }
  }

  const bytes = await w.finish();
  const verification = await verifyPdf(outPath, specs);
  return { path: outPath, bytes, issues, textOverflow: overflowIssues(w), verification, durationMs: Date.now() - started, bleedMode };
}

/** Cover: a single page — back, spine and front — with the wrap/bleed around it. */
export async function exportCoverPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string): Promise<FileResult & { textOverflow: PreflightIssue[]; spineMm: number }> {
  if (!doc.cover) throw new Error('This book has no cover');
  const g = coverGeometry(doc);
  const spec: PageSpec = { pageW: g.width + 2 * g.bleed, pageH: g.height + 2 * g.bleed, trim: { x: g.bleed, y: g.bleed, w: g.width, h: g.height } };
  const w = new PdfWriter(outPath, `${doc.title} — cover`, assets);
  w.page(spec, doc.cover.background ?? doc.style.background);
  await w.elements(doc.cover.elements, { x: -g.bleed, y: -g.bleed, w: spec.pageW, h: spec.pageH }, COVER_INDEX, 'Cover');
  const bytes = await w.finish();
  return { path: outPath, bytes, verification: await verifyPdf(outPath, [spec]), textOverflow: overflowIssues(w), spineMm: g.spine?.mm ?? 0 };
}

/** Poster: one page, the sheet plus bleed on every side. */
export async function exportPosterPdf(doc: BookDocument, assets: Map<string, ExportAsset>, outPath: string): Promise<ExportResult> {
  const started = Date.now();
  const sheet = doc.spreads[0];
  if (!sheet) throw new Error('This poster has no sheet');
  const g = posterGeometry(doc);
  const issues = preflight(doc, new Map([...assets].map(([id, a]) => [id, a.asset])));
  const spec: PageSpec = { pageW: g.width + 2 * g.bleed, pageH: g.height + 2 * g.bleed, trim: { x: g.bleed, y: g.bleed, w: g.width, h: g.height } };
  const w = new PdfWriter(outPath, doc.title, assets);
  w.page(spec, sheet.background ?? doc.style.background);
  await w.elements(sheet.elements, { x: -g.bleed, y: -g.bleed, w: spec.pageW, h: spec.pageH }, 0, 'Poster');
  const bytes = await w.finish();
  return { path: outPath, bytes, issues, textOverflow: overflowIssues(w), verification: await verifyPdf(outPath, [spec]), durationMs: Date.now() - started, bleedMode: 'all' };
}

function overflowIssues(w: PdfWriter): PreflightIssue[] {
  return w.overflow.map((o) => ({
    id: `overflow:${o.elementId}`, severity: 'warning', code: 'near-trim', spreadIndex: o.spreadIndex, elementId: o.elementId,
    message: `${o.label}: text does not fit its box and continues below it.`,
  }));
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Re-open the written file and check page count, MediaBox and TrimBox against what was intended. */
export async function verifyPdf(path: string, expected: PageSpec[]): Promise<ExportVerification> {
  const problems: string[] = [];
  const pdf = await PdfLibDocument.load(await readFile(path));
  const pages = pdf.getPages();
  if (pages.length !== expected.length) problems.push(`PDF has ${pages.length} pages; expected ${expected.length}.`);
  const tol = 0.05; // pt
  pages.forEach((p, i) => {
    const e = expected[i];
    if (!e) return;
    const { width, height } = p.getSize();
    if (Math.abs(width - mmToPt(e.pageW)) > tol || Math.abs(height - mmToPt(e.pageH)) > tol) {
      problems.push(`Page ${i + 1} is ${width.toFixed(2)}×${height.toFixed(2)} pt; expected ${mmToPt(e.pageW).toFixed(2)}×${mmToPt(e.pageH).toFixed(2)}.`);
    }
    const trim = p.node.get(PDFName.of('TrimBox'));
    if (!(trim instanceof PDFArray)) return void problems.push(`Page ${i + 1} has no TrimBox.`);
    const [x0, y0, x1, y1] = trim.asArray().map((n) => (n as PDFNumber).asNumber());
    if (Math.abs(x1 - x0 - mmToPt(e.trim.w)) > tol || Math.abs(y1 - y0 - mmToPt(e.trim.h)) > tol) problems.push(`Page ${i + 1} trim is ${(x1 - x0).toFixed(2)}×${(y1 - y0).toFixed(2)} pt.`);
    if (Math.abs(x0 - mmToPt(e.trim.x)) > tol || Math.abs(height - y1 - mmToPt(e.trim.y)) > tol) problems.push(`Page ${i + 1} trim box is offset incorrectly.`);
  });
  const first = expected[0];
  return {
    ok: problems.length === 0,
    pageCount: pages.length,
    expectedPageCount: expected.length,
    pageSizeMm: { width: round2(first?.pageW ?? 0), height: round2(first?.pageH ?? 0) },
    trimSizeMm: { width: round2(first?.trim.w ?? 0), height: round2(first?.trim.h ?? 0) },
    problems,
  };
}

export { printablePages };
