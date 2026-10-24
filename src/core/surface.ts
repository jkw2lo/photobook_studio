import type { BookDocument, Cover, Rect, Spread } from './model';
import { isPrintable, pageNumberOf, pageSafeRect } from './book';
import { binding, spineWidth, type SpineInfo } from './printers';

// A "surface" is anything you lay out on: an interior spread or the cover. The editor canvas,
// snapping, guides, preflight and PDF export all read geometry from here, so the cover gets the
// same treatment as pages without special cases scattered through the UI.

export const COVER_INDEX = -1;

export interface Panel {
  id: 'left' | 'right' | 'back' | 'spine' | 'front' | 'sheet';
  label: string;
  x: number;
  w: number;
  printable: boolean;
}

export interface SurfaceGeometry {
  kind: 'spread' | 'cover' | 'poster';
  /** Trim extent (mm). */
  width: number;
  height: number;
  /** Bleed (or bleed + wrap for covers) beyond the trim on each outer edge. */
  bleed: number;
  panels: Panel[];
  /** x positions of folds (the spine for spreads; both spine edges for covers). */
  folds: number[];
  /** Area around the fold where content may be lost. */
  foldZone: Rect | null;
  /** Areas where text and important content are safe. */
  safeRects: Rect[];
  spine?: SpineInfo;
}

export function surfaceAt(doc: BookDocument, index: number): Spread | Cover | undefined {
  return index === COVER_INDEX ? doc.cover : doc.spreads[index];
}

export function findSurface(doc: BookDocument, spreadId: string): { surface: Spread | Cover; index: number } | undefined {
  if (doc.cover?.id === spreadId) return { surface: doc.cover, index: COVER_INDEX };
  const i = doc.spreads.findIndex((s) => s.id === spreadId);
  return i >= 0 ? { surface: doc.spreads[i], index: i } : undefined;
}

export function surfaceGeometry(doc: BookDocument, index: number): SurfaceGeometry {
  return index === COVER_INDEX ? coverGeometry(doc) : spreadGeometry(doc, index);
}

export function posterGeometry(doc: Pick<BookDocument, 'settings'>): SurfaceGeometry {
  const s = doc.settings;
  const m = s.safeMarginMm;
  return {
    kind: 'poster',
    width: s.trimWidthMm,
    height: s.trimHeightMm,
    bleed: s.bleedMm,
    panels: [{ id: 'sheet', label: `${(s.trimWidthMm / 25.4).toFixed(1).replace(/\.0$/, '')} × ${(s.trimHeightMm / 25.4).toFixed(1).replace(/\.0$/, '')} in poster`, x: 0, w: s.trimWidthMm, printable: true }],
    folds: [],
    foldZone: null,
    safeRects: [{ x: m, y: m, w: s.trimWidthMm - 2 * m, h: s.trimHeightMm - 2 * m }],
  };
}

export function spreadGeometry(doc: BookDocument, index: number): SurfaceGeometry {
  if (doc.settings.product === 'poster') return posterGeometry(doc);
  const s = doc.settings;
  const W = s.trimWidthMm;
  const n = doc.spreads.length;
  const panel = (side: 'left' | 'right'): Panel => {
    const num = pageNumberOf(index, side, n);
    return { id: side, label: num ? `Page ${num}` : 'Inside cover', x: side === 'left' ? 0 : W, w: W, printable: isPrintable(index, side, n) };
  };
  const panels = [panel('left'), panel('right')];
  return {
    kind: 'spread',
    width: 2 * W,
    height: s.trimHeightMm,
    bleed: s.bleedMm,
    panels,
    folds: [W],
    foldZone: { x: W - s.bindingZoneMm, y: 0, w: 2 * s.bindingZoneMm, h: s.trimHeightMm },
    safeRects: panels.filter((p) => p.printable).map((p) => pageSafeRect(p.id as 'left' | 'right', s)),
  };
}

export interface CoverDims {
  panelW: number;
  panelH: number;
  spine: SpineInfo;
  wrap: number;
  safe: number;
}

export function coverDims(doc: BookDocument): CoverDims {
  const s = doc.settings;
  const o = s.coverOverrides ?? { spineMm: null, wrapMm: null, panelWidthMm: null, panelHeightMm: null };
  const b = binding(s);
  return {
    panelW: o.panelWidthMm ?? s.trimWidthMm,
    panelH: o.panelHeightMm ?? s.trimHeightMm,
    spine: spineWidth(doc),
    wrap: o.wrapMm ?? b.coverWrapMm,
    safe: b.coverSafeMm,
  };
}

export function coverGeometry(doc: BookDocument): SurfaceGeometry {
  const { panelW, panelH, spine, wrap, safe } = coverDims(doc);
  const S = spine.mm;
  const panels: Panel[] = [
    { id: 'back', label: 'Back cover', x: 0, w: panelW, printable: true },
    { id: 'spine', label: S > 0 ? `Spine ${S.toFixed(1)} mm` : 'Spine', x: panelW, w: S, printable: true },
    { id: 'front', label: 'Front cover', x: panelW + S, w: panelW, printable: true },
  ];
  const hinge = Math.min(6, panelW / 10);
  const safeRects: Rect[] = [
    { x: safe, y: safe, w: panelW - safe - hinge, h: panelH - 2 * safe },
    { x: panelW + S + hinge, y: safe, w: panelW - safe - hinge, h: panelH - 2 * safe },
  ];
  // Spine text needs clearance from both folds; Lulu warns about spine shift.
  const spineClear = Math.min(1.6, S / 4);
  if (S > 3) safeRects.push({ x: panelW + spineClear, y: safe, w: S - 2 * spineClear, h: panelH - 2 * safe });
  return {
    kind: 'cover',
    width: 2 * panelW + S,
    height: panelH,
    bleed: wrap,
    panels,
    folds: [panelW, panelW + S],
    foldZone: { x: panelW - hinge, y: 0, w: S + 2 * hinge, h: panelH },
    safeRects,
    spine,
  };
}

/**
 * Geometry from just the inputs it depends on, so UI components can memoize on stable values
 * (settings object identity, spread count) instead of the whole document.
 */
export function geometryFor(settings: BookDocument['settings'], spreadCount: number, index: number): SurfaceGeometry {
  const pseudo = { settings, spreads: { length: spreadCount } } as unknown as BookDocument;
  return surfaceGeometry(pseudo, index);
}
