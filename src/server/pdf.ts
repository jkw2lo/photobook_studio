import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import sharp from 'sharp';
import {
  COVER_INDEX, archGeometry, displayText, textLayers, gradeHex, gradeSurfaceColours, pageGrades, calendarLayout, calendarMark, elementOpacity, mapPath, backgroundFrame, coverGeometry, geometryFor, gradeChainKey, gradeChainMatrix, gradientLine, isNeutralChain, maskPath, pointOnArch, shapePath, posterGeometry, elementBounds, elementPlacement, fontFilePath, intersects, mmToInch, mmToPt, nearestWeight,
  pageNumberRect, preflight, printablePages, roleStyle, type BleedMode, type BookDocument, type Element, type ImageElement,
  type CalendarElement, type ColorGrade, type Gradient, type PhotoAsset, type PreflightIssue, type Rect, type ShapeElement, type Spread, type TextElement,
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
  /** Opacity of the element being drawn. */
  private alpha = 1;
  /** Grade of the page / spread / cover being drawn (between each photo's own and the document's). */
  private surfaceGrade?: ColorGrade;
  /** The grades that colour the whole page being drawn — the only ones its background photo takes. */
  private wholePage: ColorGrade[] = [];

  constructor(readonly outPath: string, title: string, private readonly assets: Map<string, ExportAsset>, private readonly grade?: ColorGrade) {
    this.pdf = new PDFDocument({ autoFirstPage: false, compress: true, info: { Title: title, Creator: 'Photobook Studio', Producer: 'Photobook Studio (PDFKit)' } });
    const stream = createWriteStream(outPath);
    this.pdf.pipe(stream);
    this.done = new Promise((res, rej) => {
      stream.on('finish', () => res());
      stream.on('error', rej);
    });
  }

  useFont(family: string, weight: number, italic = false) {
    const w = nearestWeight(family, weight);
    const file = fontFilePath(family, w, italic);
    const name = `${family}-${w}${file.includes('-italic.') ? '-italic' : ''}`;
    if (!this.fonts.has(name)) {
      this.pdf.registerFont(name, join(ROOT, file));
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
  async elements(elements: Element[], area: Rect, spreadIndex: number, label: string, surfaceGrade?: ColorGrade) {
    const { pdf } = this;
    this.surfaceGrade = surfaceGrade;
    this.wholePage = pageGrades([surfaceGrade, this.grade]);
    for (const el of elements) {
      if (!intersects(elementBounds(el), area)) continue;
      pdf.save();
      // Element frame: translate to its centre, rotate, then work in element-local mm (top-left origin).
      pdf.translate(mmToPt(el.xMm + el.widthMm / 2 - area.x), mmToPt(el.yMm + el.heightMm / 2 - area.y));
      if (el.rotationDeg) pdf.rotate(el.rotationDeg);
      pdf.translate(-mmToPt(el.widthMm / 2), -mmToPt(el.heightMm / 2));
      // Element opacity: the base alpha for everything drawn below; parts with their own alpha
      // (text backgrounds, shadows, calendar marks) multiply it in.
      this.alpha = elementOpacity(el);
      if (el.type !== 'shape' && this.alpha < 1) pdf.opacity(this.alpha);
      if (el.type === 'image') await this.image(el);
      else if (el.type === 'shape') this.shape(el);
      else if (el.type === 'calendar') this.calendar(el);
      else if (this.text(el) && !this.overflow.some((o) => o.elementId === el.id)) {
        this.overflow.push({ elementId: el.id, label, spreadIndex });
      }
      pdf.restore();
    }
  }

  /** A gradient fill across a w × h box (points), CSS angle semantics. */
  private gradient(g: Gradient, w: number, h: number) {
    const l = gradientLine(g.angleDeg, w, h);
    return this.pdf.linearGradient(l.x1, l.y1, l.x2, l.y2).stop(0, g.from).stop(1, g.to);
  }

  /** Same layout and marks as the editor; text baseline at centre + 0.35 × size, as there. */
  private calendar(el: CalendarElement) {
    const { pdf } = this;
    const lay = calendarLayout(el);
    this.useFont(el.fontFamily, el.fontWeight);
    const ascent = (pdf as unknown as { _font: { ascender: number } })._font.ascender / 1000;
    for (const c of lay.cells) {
      const cx = mmToPt(c.x + c.w / 2);
      const cy = mmToPt(c.y + c.h / 2);
      const sizeMm = c.kind === 'title' ? lay.titleMm : c.kind === 'weekday' ? lay.weekdayMm : lay.dayMm;
      const size = mmToPt(c.text.length > 3 && c.kind === 'day' ? sizeMm * 0.72 : sizeMm);
      const alpha = (c.faint ? 0.32 : c.kind === 'weekday' ? 0.6 : 1) * this.alpha;
      pdf.save();
      const mark = c.marked ? calendarMark(el.markStyle, c, lay.dayMm) : null;
      if (mark) {
        const d = mapPath(mark.d, (x, y) => [mmToPt(x), mmToPt(y)]);
        const a = alpha * (mark.opacity ?? 1);
        if (mark.fill) pdf.fillOpacity(a).path(d).fill(el.accent);
        else pdf.strokeOpacity(a).lineWidth(mmToPt(mark.strokeMm ?? 0.3)).lineCap('round').path(d).stroke(el.accent);
      }
      pdf.fillColor(mark?.knockout ? '#ffffff' : el.color).fillOpacity(alpha).fontSize(size);
      const w = mmToPt(c.w);
      pdf.text(c.text, cx - w / 2, cy + mmToPt(sizeMm) * 0.35 - ascent * size, { width: w, align: 'center', lineBreak: false });
      pdf.restore();
    }
  }

  private shape(el: ShapeElement) {
    const { pdf } = this;
    const w = mmToPt(el.widthMm);
    const h = mmToPt(el.heightMm);
    const p = shapePath(el, w, h);
    const rule = p.evenOdd ? 'even-odd' : 'non-zero';
    const d = p.d;
    pdf.fillOpacity(el.opacity).strokeOpacity(el.opacity);
    if (el.gradient || el.fill !== 'none') pdf.path(d).fill(el.gradient ? this.gradient(el.gradient, w, h) : el.fill, rule);
    if (el.strokeWidthMm) pdf.path(d).lineWidth(mmToPt(el.strokeWidthMm)).lineJoin('round').stroke(el.strokeColor ?? '#000000');
  }

  private async image(el: ImageElement) {
    const { pdf } = this;
    // Cut to a shape or to text: clip to the outline; borders don't apply.
    if (el.mask) {
      const m = maskPath(el.mask, mmToPt(el.widthMm), mmToPt(el.heightMm));
      pdf.path(m.d).clip(m.evenOdd ? 'even-odd' : 'non-zero');
      el = { ...el, borderMm: 0 };
    }
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
    // The photo's own adjustment, the page's grade, then the document's — as in the editor.
    const chain = el.id.endsWith(':bg') ? [el.adjust, ...this.wholePage] : [el.adjust, this.surfaceGrade, this.grade];
    const grade = isNeutralChain(chain) ? null : gradeChainMatrix(chain);
    const key = `${asset.id}|${left},${top},${width},${height}|${tw}x${th}|${gradeChainKey(chain)}`;
    let buf = this.imageCache.get(key);
    if (!buf) {
      let img = sharp(entry.workPath, { failOn: 'none' })
        .rotate() // EXIF orientation first, so extract() works in the same oriented space as the preview
        .extract({ left, top, width, height })
        .resize(tw, th, { fit: 'fill' });
      const cutout = !!asset.analysis?.transparent;
      img = cutout ? img.ensureAlpha() : img.flatten({ background: '#ffffff' });
      // The colour grade: the same rgb' = M·rgb + o the editor applies (alpha untouched).
      if (grade) {
        const { m, o } = grade;
        img = cutout
          ? img.recomb([[m[0], m[1], m[2], 0], [m[3], m[4], m[5], 0], [m[6], m[7], m[8], 0], [0, 0, 0, 1]]).linear([1, 1, 1, 1], [o[0] * 255, o[1] * 255, o[2] * 255, 0])
          : img.recomb([[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]).linear([1, 1, 1], [o[0] * 255, o[1] * 255, o[2] * 255]);
      }
      // Cutouts keep their transparency (PNG with alpha → PDF soft mask) so whatever is behind them
      // — the sheet colour, a background image, other photos — shows through. Photos stay JPEG.
      buf = cutout ? await img.png({ compressionLevel: 6 }).toBuffer() : await img.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
      this.imageCache.set(key, buf);
    }
    pdf.image(buf, mmToPt(box.x + visible.dest.x), mmToPt(box.y + visible.dest.y), { width: mmToPt(visible.dest.w), height: mmToPt(visible.dest.h) });
  }

  /** Returns true if the text overflows its box. */
  private text(el: TextElement): boolean {
    const { pdf } = this;
    const W = mmToPt(el.widthMm);
    const H = mmToPt(el.heightMm);
    // Fill behind the text: the whole box (rounded if asked), like the editor's CSS background.
    if (el.backgroundColor) {
      pdf.save();
      const r = mmToPt(el.backgroundRadiusMm ?? 0);
      (r > 0 ? pdf.roundedRect(0, 0, W, H, Math.min(r, W / 2, H / 2)) : pdf.rect(0, 0, W, H)).fillOpacity((el.backgroundOpacity ?? 1) * this.alpha).fill(el.backgroundColor);
      pdf.restore();
    }
    const pad = mmToPt(el.paddingMm ?? 0);
    this.useFont(el.fontFamily, el.fontWeight, !!el.italic);
    pdf.fontSize(el.fontSizePt);
    // Slanted letters: the same skew as the editor's CSS, about the box centre.
    if (el.skewDeg) pdf.translate(W / 2, H / 2).transform(1, 0, -Math.tan((el.skewDeg * Math.PI) / 180), 1, 0, 0).translate(-W / 2, -H / 2);
    // Same transforms as the editor's CSS (upper case, letter-spacing in em); vertical text is one letter per line.
    const text = displayText(el);
    const characterSpacing = (el.letterSpacingEm ?? 0) * el.fontSizePt;
    const fill = el.gradient ? this.gradient(el.gradient, W, H) : el.color;
    const stroke = el.strokeWidthMm ? { width: mmToPt(el.strokeWidthMm), color: el.strokeColor ?? '#000000' } : null;

    // Each pass draws the same glyphs: the effect layers behind (glow, shadow, 3D extrusion, second
    // outline — core's textLayers, as in the editor), the outline (under), then the fill.
    const passes = (draw: (mode: 'fill' | 'stroke') => void) => {
      for (const layer of textLayers(el)) {
        pdf.save();
        pdf.translate(mmToPt(layer.dxMm), mmToPt(layer.dyMm));
        const a = layer.opacity * this.alpha;
        pdf.fillColor(layer.color).fillOpacity(a).strokeColor(layer.color).strokeOpacity(a).lineJoin('round');
        if (layer.blurMm > 0) {
          // PDF has no blur: a soft halo from widening, fading outlines.
          for (const k of [1, 0.75, 0.5, 0.3]) {
            pdf.lineWidth(mmToPt(Math.max(0.05, layer.strokeMm * k))).strokeOpacity(a * 0.22);
            draw('stroke');
          }
        } else {
          if (layer.strokeMm > 0) {
            pdf.lineWidth(mmToPt(layer.strokeMm));
            draw('stroke');
          }
          draw('fill');
        }
        pdf.restore();
      }
      if (stroke) {
        pdf.save();
        pdf.lineWidth(stroke.width).lineJoin('round').strokeColor(stroke.color);
        draw('stroke');
        pdf.restore();
      }
      pdf.save();
      pdf.fillColor(fill);
      draw('fill');
      pdf.restore();
    };

    const arch = archGeometry(W, H, el.arch ?? 0, el.fontSizePt);
    if (arch) {
      // One line along the arc: each glyph centred on its arc position and turned to the tangent.
      const line = text.replace(/\n/g, ' ');
      const chars = [...line];
      const widths = chars.map((c) => pdf.widthOfString(c) + characterSpacing);
      const total = widths.reduce((a, b) => a + b, 0) - characterSpacing;
      const ascent = ((pdf as unknown as { _font: { ascender: number } })._font.ascender / 1000) * el.fontSizePt;
      passes((mode) => {
        let t = (arch.length - total) / 2;
        chars.forEach((c, i) => {
          const adv = widths[i] - characterSpacing;
          const p = pointOnArch(arch, t + adv / 2);
          pdf.save();
          pdf.translate(p.x, p.y).rotate(p.rotDeg);
          pdf.text(c, -adv / 2, -ascent, { lineBreak: false, fill: mode === 'fill', stroke: mode === 'stroke' });
          pdf.restore();
          t += widths[i];
        });
      });
      return false;
    }

    // Match CSS line-height: line box = lineHeight × size, with half-leading above the first line.
    const natural = pdf.currentLineHeight(false);
    const lineBox = el.lineHeight * el.fontSizePt;
    const lineGap = lineBox - natural;
    const opts = { width: Math.max(1, W - 2 * pad), align: el.vertical ? 'center' : el.align, lineGap, characterSpacing } as const;
    const boxH = H - 2 * pad;
    const overflow = pdf.heightOfString(text, opts) > boxH + 1;
    // A bounded height also stops PDFKit from ever starting a new page for long text.
    passes((mode) => pdf.text(text, pad, pad + lineGap / 2, { ...opts, height: boxH * 1.5 + lineBox, fill: mode === 'fill', stroke: mode === 'stroke' }));
    return overflow;
  }

  async finish(): Promise<number> {
    this.pdf.end();
    await this.done;
    return (await readFile(this.outPath)).byteLength;
  }
}

/** A surface's elements with its background image (if any) first, so it is drawn behind them. */
function withBackground(surface: Spread, g: { width: number; height: number; bleed: number }): Element[] {
  const bg = backgroundFrame(surface, g);
  return bg ? [bg, ...surface.elements] : surface.elements;
}

/** A surface as printed: under grades for the whole page its background and colours change too. */
function asGraded(doc: BookDocument, surface: Spread): { surface: Spread; background: string; textColor: string } {
  const whole = pageGrades([surface.grade, doc.grade]);
  const shown = gradeSurfaceColours(surface, doc.style.background, whole);
  return { surface: shown, background: shown.background ?? doc.style.background, textColor: gradeHex(doc.style.textColor, whole) };
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
  const w = new PdfWriter(outPath, doc.title, assets, doc.grade);
  const specs: PageSpec[] = [];

  for (const page of printablePages(doc)) {
    const spread = doc.spreads[page.spreadIndex];
    // Spread-space x of this PDF page's left edge (its bleed edge).
    const originX = page.side === 'left' ? -b : W - spineBleed;
    const spec: PageSpec = { pageW, pageH, trim: { x: page.side === 'left' ? b : spineBleed, y: b, w: W, h: H } };
    specs.push(spec);
    const shown = asGraded(doc, spread);
    w.page(spec, shown.background);
    await w.elements(withBackground(shown.surface, geometryFor(s, doc.spreads.length, page.spreadIndex)), { x: originX, y: -b, w: pageW, h: pageH }, page.spreadIndex, `Page ${page.pageNumber}`, spread.grade);
    if (s.pageNumbers && page.pageNumber > 1) {
      const r = pageNumberRect(page.side, s);
      w.useFont(roleStyle(doc.style, 'caption').family, 400);
      w.pdf.fontSize(8).fillColor(shown.textColor);
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
  const w = new PdfWriter(outPath, `${doc.title} — cover`, assets, doc.grade);
  const shown = asGraded(doc, doc.cover);
  w.page(spec, shown.background);
  await w.elements(withBackground(shown.surface, g), { x: -g.bleed, y: -g.bleed, w: spec.pageW, h: spec.pageH }, COVER_INDEX, 'Cover', doc.cover.grade);
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
  const w = new PdfWriter(outPath, doc.title, assets, doc.grade);
  const shown = asGraded(doc, sheet);
  w.page(spec, shown.background);
  await w.elements(withBackground(shown.surface, g), { x: -g.bleed, y: -g.bleed, w: spec.pageW, h: spec.pageH }, 0, 'Poster', sheet.grade);
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
