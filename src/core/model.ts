// Domain model for Photobook Studio.
// Conventions (see docs/ARCHITECTURE.md §3):
//  - All document geometry is in millimetres.
//  - Element coordinates are in *spread space*: origin at the top-left of the left page's trim box,
//    x ∈ [0, 2W], y ∈ [0, H]; bleed extends outside that range.
//  - Rotation is degrees clockwise about the element centre.
//  - Crop centre (cx, cy) is normalized to the auto-oriented source image.

export const SCHEMA_VERSION = 3 as const;

/**
 * Bumped whenever the client/server contract changes. The page compares it with the running
 * server's and warns when they differ (e.g. the page was rebuilt but the server wasn't restarted).
 */
export const API_VERSION = 5;

export type ID = string;

export interface BookSettings {
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  /** Distance from trim edge that important content should stay inside. */
  safeMarginMm: number;
  /** Width, on each side of the spine, where content may disappear into the binding. */
  bindingZoneMm: number;
  pageNumbers: boolean;
  /** Effective DPI below which an image is flagged as a warning. */
  minDpiWarning: number;
  /** Effective DPI below which an image is flagged as an error. */
  minDpiError: number;
  /** Printer preset id (see printers.ts). Drives sizes, bleed, spine and cover rules. */
  printerId: PrinterId;
  bindingId: BindingId;
  /** 'all': bleed on every side of every interior page. 'outer': none at the spine. */
  bleedMode: BleedMode;
  /** Manual cover measurements (from the printer's own calculator). null = use the preset. */
  coverOverrides: CoverOverrides;
  /** A bound photobook, or a single printed sheet (poster / collage print). */
  product: Product;
}

export type Product = 'book' | 'poster';

export interface CollageSettings {
  style: 'mosaic' | 'grid' | 'hero' | 'scatter';
  photoCount: number;
  gapMm: number;
  /** 0 = photos run to the edge (into the bleed). */
  marginMm: number;
  titlePosition: 'none' | 'top' | 'bottom';
  seed: number;
}

export type PrinterId = 'lulu' | 'blurb' | 'custom';
export type BindingId = 'hardcover' | 'softcover';
export type BleedMode = 'all' | 'outer';

export interface CoverOverrides {
  spineMm: number | null;
  /** Bleed + board wrap around each outer edge of the cover. */
  wrapMm: number | null;
  /** Front/back board size, when it differs from the page trim size. */
  panelWidthMm: number | null;
  panelHeightMm: number | null;
}

export type CaptionMode = 'none' | 'date';

export interface BookStyle {
  presetId: string;
  marginOuterMm: number;
  marginInnerMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  gapMm: number;
  background: string;
  textColor: string;
  /** Type pack the role styles came from ('custom' once edited). */
  typePackId: string;
  /** One style per text role; text boxes with styleLinked follow these. */
  textStyles: Record<TextRole, TextStyle>;
  imageBorderMm: number;
  imageBorderColor: string;
  captionMode: CaptionMode;
}

/** A role's typography: what a pack defines for titles, captions, etc. */
export interface TextStyle {
  family: string;
  weight: number;
  /** Points on an 8 in page; scaled to the page's short side. */
  sizePt: number;
  lineHeight: number;
  letterSpacingEm: number;
  uppercase: boolean;
  /** 'muted' blends the text colour toward the paper colour. */
  tone: 'text' | 'muted';
}

export interface FontRef {
  family: string;
  weight: number;
}

export interface Chapter {
  id: ID;
  title: string;
}

export interface Crop {
  cx: number;
  cy: number;
  zoom: number;
}

export type FitMode = 'cover' | 'contain';

interface ElementBase {
  id: ID;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  locked: boolean;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  /** null = empty frame waiting for a photo. */
  assetId: ID | null;
  crop: Crop;
  fit: FitMode;
  borderMm: number;
  borderColor: string;
}

export type TextRole = 'title' | 'subtitle' | 'heading' | 'caption' | 'body' | 'quote' | 'label';

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  role: TextRole;
  fontFamily: string;
  fontWeight: number;
  fontSizePt: number;
  lineHeight: number;
  /** Extra space between letters, in em (0.1 = 10% of the font size). */
  letterSpacingEm: number;
  uppercase: boolean;
  align: 'left' | 'center' | 'right';
  color: string;
  /** Follows its role's style; false once its font or size is edited by hand. */
  styleLinked: boolean;
}

/** A filled rectangle: colour panels behind titles, blocks of colour on a page. */
export interface ShapeElement extends ElementBase {
  type: 'shape';
  fill: string;
  opacity: number;
}

export type Element = ImageElement | TextElement | ShapeElement;

export interface SpreadLayout {
  left?: string;
  right?: string;
  /** Set when one template covers the whole spread (e.g. a panorama). */
  spread?: string;
}

export interface Spread {
  id: ID;
  locked: boolean;
  chapterId?: ID;
  background?: string;
  layout?: SpreadLayout;
  provenance?: { generatedAt: string; seed: number; assetIds: ID[] };
  /** Painted in array order: later elements are on top. */
  elements: Element[];
}

export type Ordering = 'chronological';

export interface GenerationSettings {
  targetPages: number;
  stylePresetId: string;
  ordering: Ordering;
  includeCaptions: boolean;
  seed: number;
}

export interface GenerationRecord {
  settings: GenerationSettings;
  generatedAt: string;
}

export interface BookDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  id: ID;
  title: string;
  subtitle: string;
  settings: BookSettings;
  style: BookStyle;
  chapters: Chapter[];
  spreads: Spread[];
  generation?: GenerationRecord;
  /** The cover spread (back · spine · front). Absent on books created before covers existed. */
  cover?: Cover;
  /** Last collage settings used (posters, and book pages laid out as collages). */
  collage?: CollageSettings;
}

/**
 * Cover coordinates: origin at the top-left of the back cover's trim; x runs across back, spine
 * and front. `spineMm` records the spine width the elements were laid out for, so they can be
 * shifted when the page count (and therefore the spine) changes.
 */
export interface Cover extends Spread {
  spineMm: number;
}

/** Analysis computed once at import; all values are cheap, local, and deterministic. */
export interface PhotoAnalysis {
  /** Variance of the Laplacian on a 256px greyscale thumbnail. Higher = sharper. */
  sharpness: number;
  /** Mean luminance 0..1. */
  meanLuma: number;
  /** Fraction of pixels crushed to near-black / blown to near-white. */
  clippedShadows: number;
  clippedHighlights: number;
  /** 64-bit difference hash as 16 hex chars. */
  dHash: string;
  /** Edge-energy centre of mass, normalized 0..1 — a cheap stand-in for "where the subject is". */
  saliencyX: number;
  saliencyY: number;
}

export interface PhotoAsset {
  id: ID;
  fileName: string;
  format: string;
  fileSizeBytes: number;
  /** Dimensions after EXIF orientation has been applied. */
  widthPx: number;
  heightPx: number;
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  rating: number;
  favorite: boolean;
  tags: string[];
  contentHash: string;
  exactDuplicateOf: ID | null;
  analysis: PhotoAnalysis | null;
  /** Per-project: user excluded this photo from automatic drafts. */
  excluded: boolean;
  /** Original file could not be found at its recorded path. */
  missing: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
