import type { BookStyle } from './model';

// Style presets are pure data: they set book-wide design values and *bias* the generator
// (template weights, density). They never restrict manual editing.

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  style: Omit<BookStyle, 'presetId'>;
  /** Average photos per page the generator aims for. */
  density: number;
  maxPerPage: number;
  /** Share of eligible spreads that become a single panoramic hero photo. */
  heroSpreadShare: number;
  /** Relative preference for each template id. Missing = not used unless nothing else fits. */
  templateWeights: Record<string, number>;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Generous white space, restrained type, one or two photos per page.',
    density: 1.15,
    maxPerPage: 2,
    heroSpreadShare: 0.12,
    style: {
      marginOuterMm: 22, marginInnerMm: 18, marginTopMm: 22, marginBottomMm: 26, gapMm: 6,
      background: '#ffffff', textColor: '#2b2b2b',
      headingFont: { family: 'Inter', weight: 400 },
      bodyFont: { family: 'Inter', weight: 400 },
      captionFont: { family: 'Inter', weight: 400 },
      imageBorderMm: 0, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'single-small': 3, 'single-margin': 2, 'single-captioned': 1.5, 'full-bleed': 0.6,
      'duo-columns': 1.5, 'duo-rows': 1.5, panorama: 1,
      'title-photo': 1, 'title-text': 1, 'chapter-divider': 1,
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Bold full-bleed heroes, asymmetry, varied scale and dramatic pacing.',
    density: 1.6,
    maxPerPage: 3,
    heroSpreadShare: 0.3,
    style: {
      marginOuterMm: 12, marginInnerMm: 14, marginTopMm: 12, marginBottomMm: 16, gapMm: 3,
      background: '#fbfaf7', textColor: '#1d1d1b',
      headingFont: { family: 'Playfair Display', weight: 700 },
      bodyFont: { family: 'Source Serif 4', weight: 400 },
      captionFont: { family: 'Inter', weight: 400 },
      imageBorderMm: 0, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'full-bleed': 3, 'single-offset': 2.5, 'single-margin': 0.6, 'duo-stagger': 2, 'duo-columns': 1,
      'duo-rows': 0.8, 'trio-hero-left': 2, 'trio-hero-top': 1, panorama: 3,
      'title-photo': 1, 'chapter-divider': 1,
    },
  },
  {
    id: 'scrapbook',
    name: 'Scrapbook',
    description: 'Layered, tilted prints with white borders on warm paper and handwritten notes.',
    density: 2.4,
    maxPerPage: 4,
    heroSpreadShare: 0,
    style: {
      marginOuterMm: 12, marginInnerMm: 14, marginTopMm: 12, marginBottomMm: 14, gapMm: 4,
      background: '#efe5d3', textColor: '#4a3a28',
      headingFont: { family: 'Caveat', weight: 700 },
      bodyFont: { family: 'Caveat', weight: 400 },
      captionFont: { family: 'Caveat', weight: 400 },
      imageBorderMm: 3, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'scrap-single': 2, 'scrap-duo': 3, 'scrap-trio': 3, 'scrap-quad': 2,
      'title-photo': 1, 'chapter-divider': 1,
    },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Chronological grids, dated captions, broad coverage of the whole story.',
    density: 3.2,
    maxPerPage: 6,
    heroSpreadShare: 0.12,
    style: {
      marginOuterMm: 14, marginInnerMm: 16, marginTopMm: 14, marginBottomMm: 20, gapMm: 2.5,
      background: '#ffffff', textColor: '#222222',
      headingFont: { family: 'Source Serif 4', weight: 600 },
      bodyFont: { family: 'Source Serif 4', weight: 400 },
      captionFont: { family: 'Inter', weight: 400 },
      imageBorderMm: 0, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'single-captioned': 1.5, 'duo-rows': 2, 'duo-columns': 1, 'trio-hero-top': 2, 'trio-columns': 1,
      'quad-grid': 3, 'quad-hero': 2, 'five-mosaic': 1.5, 'six-grid': 2, panorama: 1,
      'title-photo': 1, 'chapter-divider': 1,
    },
  },
];

export function stylePreset(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[1];
}

export function styleFromPreset(id: string): BookStyle {
  const p = stylePreset(id);
  return { presetId: p.id, ...structuredClone(p.style) };
}
