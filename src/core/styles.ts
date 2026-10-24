import type { BookStyle } from './model';
import { typePack } from './typography';

// Style presets are pure data: they set book-wide design values and *bias* the generator
// (template weights, density). They never restrict manual editing.

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  style: Omit<BookStyle, 'presetId' | 'typePackId' | 'textStyles'>;
  /** Type pack the preset starts with. */
  typePack: string;
  /** Average photos per page the generator aims for. */
  density: number;
  maxPerPage: number;
  /** Share of eligible spreads that become a single panoramic hero photo. */
  heroSpreadShare: number;
  /** Relative preference for each template id. Missing = not used unless nothing else fits. */
  templateWeights: Record<string, number>;
  /** 'mosaic': pages with 2+ photos are laid out by the collage engine instead of fixed templates. */
  layoutMode?: 'templates' | 'mosaic';
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'minimalist',
    typePack: 'modern',
    name: 'Minimalist',
    description: 'Generous white space, restrained type, one or two photos per page.',
    density: 1.15,
    maxPerPage: 2,
    heroSpreadShare: 0.12,
    style: {
      marginOuterMm: 22, marginInnerMm: 18, marginTopMm: 22, marginBottomMm: 26, gapMm: 6,
      background: '#ffffff', textColor: '#2b2b2b',
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
    typePack: 'editorial',
    name: 'Editorial',
    description: 'Bold full-bleed heroes, asymmetry, varied scale and dramatic pacing.',
    density: 1.6,
    maxPerPage: 3,
    heroSpreadShare: 0.3,
    style: {
      marginOuterMm: 12, marginInnerMm: 14, marginTopMm: 12, marginBottomMm: 16, gapMm: 3,
      background: '#fbfaf7', textColor: '#1d1d1b',
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
    typePack: 'scrapbook',
    name: 'Scrapbook',
    description: 'Layered, tilted prints with white borders on warm paper and handwritten notes.',
    density: 2.4,
    maxPerPage: 4,
    heroSpreadShare: 0,
    style: {
      marginOuterMm: 12, marginInnerMm: 14, marginTopMm: 12, marginBottomMm: 14, gapMm: 4,
      background: '#efe5d3', textColor: '#4a3a28',
      imageBorderMm: 3, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'scrap-single': 2, 'scrap-duo': 3, 'scrap-trio': 3, 'scrap-quad': 2,
      'title-photo': 1, 'chapter-divider': 1,
    },
  },
  {
    id: 'documentary',
    typePack: 'documentary',
    name: 'Documentary',
    description: 'Chronological grids, dated captions, broad coverage of the whole story.',
    density: 3.2,
    maxPerPage: 6,
    heroSpreadShare: 0.12,
    style: {
      marginOuterMm: 14, marginInnerMm: 16, marginTopMm: 14, marginBottomMm: 20, gapMm: 2.5,
      background: '#ffffff', textColor: '#222222',
      imageBorderMm: 0, imageBorderColor: '#ffffff', captionMode: 'date',
    },
    templateWeights: {
      'single-captioned': 1.5, 'duo-rows': 2, 'duo-columns': 1, 'trio-hero-top': 2, 'trio-columns': 1,
      'quad-grid': 3, 'quad-hero': 2, 'five-mosaic': 1.5, 'six-grid': 2, panorama: 1,
      'title-photo': 1, 'chapter-divider': 1,
    },
  },
  {
    id: 'collage',
    typePack: 'modern',
    name: 'Collage',
    description: 'Dense photo mosaics — many photos per page, edge to edge, each kept close to its shape.',
    density: 5,
    maxPerPage: 9,
    heroSpreadShare: 0.1,
    layoutMode: 'mosaic',
    style: {
      marginOuterMm: 8, marginInnerMm: 12, marginTopMm: 8, marginBottomMm: 8, gapMm: 2,
      background: '#ffffff', textColor: '#1f1f1f',
      imageBorderMm: 0, imageBorderColor: '#ffffff', captionMode: 'none',
    },
    templateWeights: { 'full-bleed': 2, 'single-margin': 1, panorama: 1, 'title-photo': 1, 'chapter-divider': 1 },
  },
];

export function stylePreset(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[1];
}

export function styleFromPreset(id: string): BookStyle {
  const p = stylePreset(id);
  const pack = typePack(p.typePack);
  return { presetId: p.id, ...structuredClone(p.style), typePackId: pack.id, textStyles: structuredClone(pack.roles) };
}
