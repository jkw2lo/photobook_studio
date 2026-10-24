import type { BookSettings, BookStyle, Rect, TextRole } from './model';
import { pageBleedRect, pageContentRect, spreadBleedRect, type PageSide } from './book';

// Layout templates are data. Slot rectangles are fractions (0..1) of either the page's content box
// (inside the style margins) or its bleed box. The style's gap is applied between neighbouring slots.

export interface SlotDef {
  kind: 'image' | 'text';
  role?: TextRole;
  box: 'content' | 'bleed';
  x: number;
  y: number;
  w: number;
  h: number;
  rotationDeg?: number;
  align?: 'left' | 'center' | 'right';
}

export interface LayoutTemplate {
  id: string;
  name: string;
  scope: 'page' | 'spread';
  /** Number of image slots. */
  imageCount: number;
  /** Purpose-built pages the generator places explicitly rather than by photo count. */
  special?: 'title' | 'divider';
  /** Asymmetric templates are authored for a right page and mirrored on a left page. */
  mirrorOnLeft?: boolean;
  slots: SlotDef[];
}

const img = (x: number, y: number, w: number, h: number, extra: Partial<SlotDef> = {}): SlotDef => ({
  kind: 'image', box: 'content', x, y, w, h, ...extra,
});
const txt = (role: TextRole, x: number, y: number, w: number, h: number, extra: Partial<SlotDef> = {}): SlotDef => ({
  kind: 'text', role, box: 'content', x, y, w, h, align: 'center', ...extra,
});

export const TEMPLATES: LayoutTemplate[] = [
  // ---- one photo
  { id: 'full-bleed', name: 'Full bleed', scope: 'page', imageCount: 1, slots: [img(0, 0, 1, 1, { box: 'bleed' })] },
  { id: 'single-margin', name: 'Single, margins', scope: 'page', imageCount: 1, slots: [img(0, 0, 1, 1)] },
  {
    id: 'single-captioned', name: 'Single with caption', scope: 'page', imageCount: 1,
    slots: [img(0, 0, 1, 0.88), txt('caption', 0, 0.92, 1, 0.08, { align: 'left' })],
  },
  {
    id: 'single-small', name: 'Single, quiet', scope: 'page', imageCount: 1,
    slots: [img(0.14, 0.16, 0.72, 0.56), txt('caption', 0.14, 0.76, 0.72, 0.06)],
  },
  {
    id: 'single-offset', name: 'Single, offset', scope: 'page', imageCount: 1, mirrorOnLeft: true,
    slots: [img(0.3, 0, 0.7, 0.74), txt('caption', 0.3, 0.8, 0.7, 0.06, { align: 'left' })],
  },
  // ---- two
  { id: 'duo-columns', name: 'Two columns', scope: 'page', imageCount: 2, slots: [img(0, 0, 0.5, 1), img(0.5, 0, 0.5, 1)] },
  { id: 'duo-rows', name: 'Two rows', scope: 'page', imageCount: 2, slots: [img(0, 0, 1, 0.5), img(0, 0.5, 1, 0.5)] },
  {
    id: 'duo-stagger', name: 'Two, staggered', scope: 'page', imageCount: 2, mirrorOnLeft: true,
    slots: [img(0, 0, 0.62, 0.47), img(0.38, 0.53, 0.62, 0.47)],
  },
  // ---- three
  {
    id: 'trio-hero-left', name: 'Three, hero left', scope: 'page', imageCount: 3, mirrorOnLeft: true,
    slots: [img(0, 0, 0.62, 1), img(0.62, 0, 0.38, 0.5), img(0.62, 0.5, 0.38, 0.5)],
  },
  {
    id: 'trio-hero-top', name: 'Three, hero top', scope: 'page', imageCount: 3,
    slots: [img(0, 0, 1, 0.6), img(0, 0.6, 0.5, 0.4), img(0.5, 0.6, 0.5, 0.4)],
  },
  {
    id: 'trio-columns', name: 'Three columns', scope: 'page', imageCount: 3,
    slots: [img(0, 0, 1 / 3, 1), img(1 / 3, 0, 1 / 3, 1), img(2 / 3, 0, 1 / 3, 1)],
  },
  // ---- four to six
  {
    id: 'quad-grid', name: 'Grid of four', scope: 'page', imageCount: 4,
    slots: [img(0, 0, 0.5, 0.5), img(0.5, 0, 0.5, 0.5), img(0, 0.5, 0.5, 0.5), img(0.5, 0.5, 0.5, 0.5)],
  },
  {
    id: 'quad-hero', name: 'Four, hero top', scope: 'page', imageCount: 4,
    slots: [img(0, 0, 1, 0.6), img(0, 0.6, 1 / 3, 0.4), img(1 / 3, 0.6, 1 / 3, 0.4), img(2 / 3, 0.6, 1 / 3, 0.4)],
  },
  {
    id: 'five-mosaic', name: 'Mosaic of five', scope: 'page', imageCount: 5,
    slots: [
      img(0, 0, 0.6, 0.5), img(0.6, 0, 0.4, 0.5),
      img(0, 0.5, 1 / 3, 0.5), img(1 / 3, 0.5, 1 / 3, 0.5), img(2 / 3, 0.5, 1 / 3, 0.5),
    ],
  },
  {
    id: 'six-grid', name: 'Grid of six', scope: 'page', imageCount: 6,
    slots: [
      img(0, 0, 0.5, 1 / 3), img(0.5, 0, 0.5, 1 / 3),
      img(0, 1 / 3, 0.5, 1 / 3), img(0.5, 1 / 3, 0.5, 1 / 3),
      img(0, 2 / 3, 0.5, 1 / 3), img(0.5, 2 / 3, 0.5, 1 / 3),
    ],
  },
  // ---- scrapbook: tilted prints, deliberately overlapping
  {
    id: 'scrap-single', name: 'Scrapbook single', scope: 'page', imageCount: 1,
    slots: [img(0.06, 0.06, 0.88, 0.72, { rotationDeg: -2 }), txt('caption', 0.1, 0.84, 0.8, 0.1, { rotationDeg: -1 })],
  },
  {
    id: 'scrap-duo', name: 'Scrapbook pair', scope: 'page', imageCount: 2,
    slots: [
      img(0, 0.02, 0.66, 0.5, { rotationDeg: -3 }),
      img(0.34, 0.44, 0.66, 0.5, { rotationDeg: 2.5 }),
      txt('caption', 0, 0.68, 0.36, 0.12, { rotationDeg: -4, align: 'left' }),
    ],
  },
  {
    id: 'scrap-trio', name: 'Scrapbook trio', scope: 'page', imageCount: 3,
    slots: [
      img(0, 0, 0.58, 0.42, { rotationDeg: -3 }),
      img(0.42, 0.22, 0.58, 0.42, { rotationDeg: 3.5 }),
      img(0.06, 0.56, 0.58, 0.42, { rotationDeg: -1.5 }),
      txt('caption', 0.66, 0.74, 0.34, 0.1, { rotationDeg: 3 }),
    ],
  },
  {
    id: 'scrap-quad', name: 'Scrapbook four', scope: 'page', imageCount: 4,
    slots: [
      img(0, 0, 0.52, 0.47, { rotationDeg: -2.5 }),
      img(0.48, 0.03, 0.52, 0.47, { rotationDeg: 2 }),
      img(0.02, 0.52, 0.52, 0.47, { rotationDeg: 1.5 }),
      img(0.47, 0.5, 0.52, 0.47, { rotationDeg: -3 }),
    ],
  },
  // ---- special pages
  {
    id: 'title-photo', name: 'Title with photo', scope: 'page', imageCount: 1, special: 'title',
    slots: [img(0, 0, 1, 0.68), txt('title', 0, 0.75, 1, 0.13), txt('subtitle', 0, 0.9, 1, 0.06)],
  },
  {
    id: 'title-text', name: 'Title page', scope: 'page', imageCount: 0, special: 'title',
    slots: [txt('title', 0, 0.38, 1, 0.14), txt('subtitle', 0, 0.54, 1, 0.06)],
  },
  {
    id: 'chapter-divider', name: 'Chapter divider', scope: 'page', imageCount: 0, special: 'divider',
    slots: [txt('heading', 0, 0.42, 1, 0.1), txt('subtitle', 0, 0.54, 1, 0.06)],
  },
  // ---- whole spread
  { id: 'panorama', name: 'Panorama across spread', scope: 'spread', imageCount: 1, slots: [img(0, 0, 1, 1, { box: 'bleed' })] },
];

export function template(id: string): LayoutTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function pageTemplatesFor(count: number): LayoutTemplate[] {
  return TEMPLATES.filter((t) => t.scope === 'page' && !t.special && t.imageCount === count);
}

export interface ResolvedSlot {
  slot: SlotDef;
  /** Spread-space rectangle in mm. */
  rect: Rect;
  rotationDeg: number;
}

/**
 * Turn a template into concrete spread-space rectangles for one page (or the whole spread).
 * Interior slot edges are inset by half the gap so neighbouring photos are separated by exactly one gap.
 */
export function resolveTemplate(t: LayoutTemplate, target: PageSide | 'spread', settings: BookSettings, style: BookStyle): ResolvedSlot[] {
  const mirror = t.mirrorOnLeft && target === 'left';
  return t.slots.map((slot) => {
    const box =
      target === 'spread'
        ? spreadBleedRect(settings)
        : slot.box === 'bleed'
          ? pageBleedRect(target, settings)
          : pageContentRect(target, settings, style);
    const fx = mirror ? 1 - slot.x - slot.w : slot.x;
    const half = style.gapMm / 2;
    const eps = 1e-6;
    // Gaps only apply between slots, never at the outer edge of the box, and not to text.
    const applyGap = slot.kind === 'image';
    const left = box.x + fx * box.w + (applyGap && fx > eps ? half : 0);
    const right = box.x + (fx + slot.w) * box.w - (applyGap && fx + slot.w < 1 - eps ? half : 0);
    const top = box.y + slot.y * box.h + (applyGap && slot.y > eps ? half : 0);
    const bottom = box.y + (slot.y + slot.h) * box.h - (applyGap && slot.y + slot.h < 1 - eps ? half : 0);
    const rot = slot.rotationDeg ?? 0;
    return {
      slot: mirror && slot.align && slot.align !== 'center' ? { ...slot, align: slot.align === 'left' ? 'right' : 'left' } : slot,
      rect: { x: left, y: top, w: right - left, h: bottom - top },
      rotationDeg: mirror && rot ? -rot : rot,
    };
  });
}
