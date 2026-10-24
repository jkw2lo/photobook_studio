import type { BookDocument, Element, ImageElement, PhotoAsset } from './model';
import { isPrintable, pageSafeRect, pageTrimRect, sideOfX, type PageSide } from './book';
import { containsRect, effectiveDpi, elementBounds, elementPlacement, intersects } from './geometry';
import { spineTextAllowed } from './cover';
import { binding, pageCountOf, printer } from './printers';
import { COVER_INDEX, coverGeometry, posterGeometry, type SurfaceGeometry } from './surface';
import { spreadPagesLabel } from './generator';

// Print preflight. Pure and fast enough to run on every edit.

export type Severity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  severity: Severity;
  code: 'missing-photo' | 'empty-frame' | 'low-dpi' | 'inside-cover' | 'bleed-gap' | 'near-trim' | 'binding' | 'off-page' | 'page-count' | 'spine' | 'cover';
  message: string;
  spreadIndex?: number;
  elementId?: string;
}

const EPS = 0.25; // mm tolerance for "touching" an edge

export function preflight(doc: BookDocument, assets: Map<string, PhotoAsset>): PreflightIssue[] {
  if (doc.settings.product === 'poster') return posterIssues(doc, assets);
  const issues: PreflightIssue[] = [];
  const s = doc.settings;
  const W = s.trimWidthMm;
  const H = s.trimHeightMm;
  const b = s.bleedMm;
  const n = doc.spreads.length;
  const pages = n * 2 - 2;

  const bind = binding(s);
  const pr = printer(s.printerId);
  if (bind.minPages && pages < bind.minPages) {
    issues.push({ id: 'pages', severity: 'error', code: 'page-count', message: `${pages} pages — ${pr.name} ${bind.name} needs at least ${bind.minPages}.` });
  } else if (bind.maxPages && pages > bind.maxPages) {
    issues.push({ id: 'pages', severity: 'error', code: 'page-count', message: `${pages} pages — ${pr.name} ${bind.name} allows at most ${bind.maxPages}.` });
  } else if (!bind.minPages && pages < 20) {
    issues.push({ id: 'pages', severity: 'info', code: 'page-count', message: `${pages} pages — many photobook printers require at least 20.` });
  }

  if (doc.cover) issues.push(...coverIssues(doc, assets));
  else issues.push({ id: 'no-cover', severity: 'info', code: 'cover', message: 'This book has no cover yet. Open “Cover” in the filmstrip to add one.' });

  doc.spreads.forEach((spread, si) => {
    const where = spreadPagesLabel(si, n);
    for (const el of spread.elements) {
      const add = (severity: Severity, code: PreflightIssue['code'], message: string) =>
        issues.push({ id: `${code}:${el.id}`, severity, code, message: `${where}: ${message}`, spreadIndex: si, elementId: el.id });
      const bounds = elementBounds(el);
      const kind = el.type === 'image' ? 'Photo' : 'Text';

      // Off the spread entirely.
      if (bounds.x > 2 * W + b || bounds.x + bounds.w < -b || bounds.y > H + b || bounds.y + bounds.h < -b) {
        add('warning', 'off-page', `${kind} is outside the page and will not print.`);
        continue;
      }

      // On an inside cover (left of page 1, right of the last page).
      for (const side of ['left', 'right'] as const) {
        if (isPrintable(si, side, n)) continue;
        const t = pageTrimRect(side, s);
        const inner = { x: t.x + EPS, y: t.y, w: t.w - 2 * EPS, h: t.h };
        if (intersects(bounds, inner)) add('warning', 'inside-cover', `${kind} extends onto the inside cover, which is not printed.`);
      }

      if (el.type === 'image') checkImage(el, add, assets, doc, true);
      if (el.type === 'shape') continue;

      // Distance from trim edges and spine.
      const side: PageSide = sideOfX(el.xMm + el.widthMm / 2, s);
      const crossesSpine = bounds.x < W - EPS && bounds.x + bounds.w > W + EPS;
      const safe = pageSafeRect(side, s);
      const trim = pageTrimRect(side, s);
      const outerEdges = edgeDistances(bounds, trim, side);

      if (el.type === 'text') {
        if (crossesSpine) add('warning', 'binding', 'Text crosses the binding and will be split by the fold.');
        else if (distanceToSpine(bounds, W) < s.bindingZoneMm) add('warning', 'binding', 'Text is close to the binding and may be hard to read.');
        if (!(bounds.x >= safe.x - EPS && bounds.y >= safe.y - EPS && bounds.x + bounds.w <= safe.x + safe.w + EPS && bounds.y + bounds.h <= safe.y + safe.h + EPS)) {
          if (!crossesSpine) add('warning', 'near-trim', 'Text is outside the safe area and may be trimmed.');
        }
        continue;
      }

      // Photos: an edge that stops between the trim and the bleed edge risks a white sliver after cutting.
      for (const [edge, d] of Object.entries(outerEdges)) {
        if (d < -EPS && d > -(b - EPS)) {
          add('error', 'bleed-gap', `Photo's ${edge} edge stops inside the bleed. Extend it to the bleed edge or pull it inside the page.`);
        } else if (d > EPS && d < s.safeMarginMm - EPS) {
          add('warning', 'near-trim', `Photo's ${edge} edge is ${d.toFixed(1)} mm from the trim; small cutting shifts will be visible.`);
        }
      }
      if (!crossesSpine) {
        const ds = distanceToSpine(bounds, W);
        if (ds > EPS && ds < s.bindingZoneMm * 0.5) add('info', 'binding', 'Photo edge sits very close to the binding.');
      }
    }
  });
  return issues;
}

function checkImage(
  el: ImageElement,
  add: (severity: Severity, code: PreflightIssue['code'], message: string) => void,
  assets: Map<string, PhotoAsset>,
  doc: BookDocument,
  interior: boolean,
) {
  if (!el.assetId) {
    add('warning', 'empty-frame', 'Empty photo frame.');
    return;
  }
  const asset = assets.get(el.assetId);
  if (!asset) {
    add('error', 'missing-photo', 'Photo is not in this project’s library.');
    return;
  }
  if (asset.missing) add('error', 'missing-photo', `Original file for ${asset.fileName} is missing. Relink it from the library.`);
  const dpi = effectiveDpi(el, asset);
  if (dpi < doc.settings.minDpiError) add('error', 'low-dpi', `${asset.fileName} prints at only ${Math.round(dpi)} DPI — it will look blurry. Make the frame smaller or zoom out.`);
  else if (dpi < doc.settings.minDpiWarning) add('warning', 'low-dpi', `${asset.fileName} prints at ${Math.round(dpi)} DPI; ${doc.settings.minDpiWarning}+ is recommended.`);

  // Panorama: is the subject in the fold?
  const W = doc.settings.trimWidthMm;
  if (interior && el.xMm < W && el.xMm + el.widthMm > W && Math.abs(el.rotationDeg) < 0.01 && asset.analysis) {
    const { box, placement } = elementPlacement(el, asset);
    const salX = el.xMm + box.x + placement.x + asset.analysis.saliencyX * placement.w;
    if (Math.abs(salX - W) < doc.settings.bindingZoneMm) {
      add('warning', 'binding', `The main subject of ${asset.fileName} falls in the binding. Pan the crop sideways.`);
    }
  }
}

function coverIssues(doc: BookDocument, assets: Map<string, PhotoAsset>): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const cover = doc.cover!;
  const g = coverGeometry(doc);
  const pr = printer(doc.settings.printerId);
  const spine = g.spine!;
  const push = (severity: Severity, code: PreflightIssue['code'], message: string, elementId?: string) =>
    out.push({ id: `cover:${code}:${elementId ?? message}`, severity, code, message: `Cover: ${message}`, spreadIndex: COVER_INDEX, elementId });

  if (spine.source === 'none') push('error', 'spine', `this binding has no spine width for ${pageCountOf(doc)} pages.`);
  if (spine.source === 'estimate') push('warning', 'spine', `spine width ${spine.mm.toFixed(1)} mm is an estimate. ${pr.coverHelp}`);
  if (!binding(doc.settings).coverWrapVerified && doc.settings.coverOverrides?.wrapMm == null) {
    push('info', 'cover', `the ${g.bleed.toFixed(1)} mm cover wrap is a starting value; confirm it with your printer.`);
  }

  const [spineL, spineR] = g.folds;
  out.push(
    ...surfaceIssues(doc, g, cover.elements, assets, COVER_INDEX, 'Cover', (el, r, add) => {
      if (el.type !== 'text') return false;
      const onSpine = r.x >= spineL - EPS && r.x + r.w <= spineR + EPS;
      if (onSpine && !spineTextAllowed(doc)) {
        add('warning', 'spine', `spine text on a ${pageCountOf(doc)}-page book can drift onto the covers; ${pr.name} advises none below ${pr.spineTextMinPages} pages.`);
        return true;
      }
      return false;
    }),
  );
  return out;
}

type AddIssue = (severity: Severity, code: PreflightIssue['code'], message: string) => void;

/**
 * Checks for any single surface (cover, poster): elements off the sheet, photo resolution, text
 * outside the safe area or across a fold, and photos/panels that stop inside the bleed.
 * `special` may handle an element first and return true to skip the generic text checks.
 */
function surfaceIssues(
  doc: BookDocument,
  g: SurfaceGeometry,
  elements: Element[],
  assets: Map<string, PhotoAsset>,
  index: number,
  label: string,
  special?: (el: Element, bounds: { x: number; y: number; w: number; h: number }, add: AddIssue) => boolean,
): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const edgeName = g.kind === 'cover' ? 'wrap' : 'bleed';
  for (const el of elements) {
    const add: AddIssue = (severity, code, message) =>
      out.push({ id: `${label}:${code}:${el.id}`, severity, code, message: `${label}: ${message}`, spreadIndex: index, elementId: el.id });
    const r = elementBounds(el);
    if (r.x > g.width + g.bleed || r.x + r.w < -g.bleed || r.y > g.height + g.bleed || r.y + r.h < -g.bleed) {
      add('warning', 'off-page', `${el.type === 'text' ? 'Text' : 'An element'} is off the sheet and will not print.`);
      continue;
    }
    if (el.type === 'image') checkImage(el, add, assets, doc, false);
    if (special?.(el, r, add)) continue;
    if (el.type === 'text') {
      if (!g.safeRects.some((sr) => containsRect(sr, r, EPS))) {
        const crosses = g.folds.some((f) => r.x < f - EPS && r.x + r.w > f + EPS);
        add('warning', crosses ? 'binding' : 'near-trim', crosses ? 'Text crosses a spine fold.' : 'Text is outside the safe area and may be trimmed.');
      }
      continue;
    }
    // Photos and colour panels that stop between the trim and the bleed edge leave a white sliver.
    if (Math.abs(el.rotationDeg) > 0.01) continue; // tilted prints are inset on purpose
    const edges = { left: r.x, top: r.y, right: g.width - (r.x + r.w), bottom: g.height - (r.y + r.h) };
    for (const [edge, d] of Object.entries(edges)) {
      if (d < -EPS && d > -(g.bleed - EPS)) add('error', 'bleed-gap', `${el.type === 'image' ? 'Photo' : 'Colour panel'} ${edge} edge stops inside the ${edgeName}. Extend it to the ${edgeName} edge.`);
    }
  }
  return out;
}

function posterIssues(doc: BookDocument, assets: Map<string, PhotoAsset>): PreflightIssue[] {
  const sheet = doc.spreads[0];
  if (!sheet) return [];
  const g = posterGeometry(doc);
  const out = surfaceIssues(doc, g, sheet.elements, assets, 0, 'Poster');
  if (!sheet.elements.length) out.push({ id: 'poster:empty', severity: 'info', code: 'empty-frame', message: 'Poster: the sheet is empty — use Auto collage or drag photos onto it.' });
  return out;
}

/** Signed distance from each *outer* trim edge (positive = inside the page). The spine edge is excluded. */
function edgeDistances(r: { x: number; y: number; w: number; h: number }, trim: { x: number; y: number; w: number; h: number }, side: PageSide) {
  const out: Record<string, number> = {
    top: r.y - trim.y,
    bottom: trim.y + trim.h - (r.y + r.h),
  };
  if (side === 'left') out.left = r.x - trim.x;
  else out.right = trim.x + trim.w - (r.x + r.w);
  return out;
}

function distanceToSpine(r: { x: number; w: number }, spine: number): number {
  return r.x >= spine ? r.x - spine : spine - (r.x + r.w);
}

export const issueCounts = (issues: PreflightIssue[]) => ({
  error: issues.filter((i) => i.severity === 'error').length,
  warning: issues.filter((i) => i.severity === 'warning').length,
  info: issues.filter((i) => i.severity === 'info').length,
});

export type { Element };
