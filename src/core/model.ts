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
export const API_VERSION = 7;

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
  /** How photos are ordered on the sheet. Missing = 'time'. */
  order?: 'time' | 'similar' | 'color';
  /** Cut every collage photo to this library shape (circle, heart, arch…). Missing = rectangles. */
  frameShape?: string;
  /** Where the photos go, as fractions of the sheet (templates leave room for text). Missing = the whole sheet inside the margin. */
  area?: Rect;
  /** Which photos Arrange and Shuffle use: the strongest `photoCount`, every usable photo, or only
   * the photos already on the sheet. Missing = 'best'. */
  source?: CollageSource;
}

export type CollageSource = 'best' | 'all' | 'sheet';

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
  /** Collages: drawn behind the photos, and kept there through Arrange and Shuffle. */
  behind?: boolean;
  /** Elements sharing a group id are selected, moved and aligned together. */
  groupId?: string;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  /** null = empty frame waiting for a photo. */
  assetId: ID | null;
  crop: Crop;
  fit: FitMode;
  borderMm: number;
  borderColor: string;
  /** 0–1. Missing = 1 (used by sheet background images). */
  opacity?: number;
  /** Collages: stays exactly where it is (position, size, crop) and auto layouts flow around it. */
  pinned?: boolean;
  /** Collages: auto layouts may move this frame but keep its crop, fit and border, and keep the
   * photo on the sheet through shuffles. */
  keepCrop?: boolean;
  /** Collages: auto layouts keep this frame's tilt (and keep the photo on the sheet). */
  keepRotation?: boolean;
  /** Cut the photo to a shape or to the outline of some text. */
  mask?: PhotoMask;
  /** This photo's own colour adjustments, applied before the document's grade. */
  adjust?: ColorGrade;
}

/**
 * A photo cut to a shape (from the shape library, stretched to the frame) or to text (glyph
 * outlines measured once by the server and stored here, fitted into the frame without distortion).
 */
export type PhotoMask =
  | { kind: 'shape'; shape: string }
  /** Cut by hand (desktop editor): an outline to keep (missing = the whole frame) minus erased
   * areas, in fractions of the frame (0–1). */
  | { kind: 'cut'; keep?: { x: number; y: number }[]; erase: { x: number; y: number }[][] }
  | { kind: 'text'; text: string; fontFamily: string; fontWeight: number; italic?: boolean; uppercase?: boolean; letterSpacingEm?: number; d: string; aspect: number }
  | ({ kind: 'outline' } & PlaceOutline);

/** A country or territory outline, 100 units tall (`aspect` = width / height). */
export interface PlaceOutline {
  name: string;
  d: string;
  aspect: number;
}

/** Two-colour linear gradient. Angle as in CSS: 0 = bottom → top, 90 = left → right. */
export interface Gradient {
  from: string;
  to: string;
  angleDeg: number;
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
  italic?: boolean;
  /** Fill behind the text (the whole box). Missing = none. */
  backgroundColor?: string;
  /** 0–1. Missing = 1. */
  backgroundOpacity?: number;
  /** Space between the box edge and the text, on every side. Missing = 0. */
  paddingMm?: number;
  /** Rounded corners for the background fill. */
  backgroundRadiusMm?: number;
  /** Fills the letters instead of `color`. */
  gradient?: Gradient;
  /** Outline around the letters. */
  strokeColor?: string;
  strokeWidthMm?: number;
  /** Hard drop shadow (prints exactly as shown). */
  shadow?: { color: string; dxMm: number; dyMm: number; opacity: number };
  /** Bend the text along an arc: −100 (a frown) … 100 (a smile). Single line only. */
  arch?: number;
  /** Filled in automatically: the table of contents' chapter titles or their page numbers. */
  auto?: 'toc' | 'toc-pages';
  /** 0–1, the whole box (text, background, outline, shadow). Missing = 1. */
  opacity?: number;
  /** Follows its role's style; false once its font or size is edited by hand. */
  styleLinked: boolean;
}

/** A filled rectangle: colour panels behind titles, blocks of colour on a page. */
export interface ShapeElement extends ElementBase {
  type: 'shape';
  fill: string;
  opacity: number;
  /** Id in the shape library (shapes, banners, icons, lines). Missing = a plain rectangle. */
  shape?: string;
  /** A place's outline (map sticker) instead of a library shape; fitted without distortion. */
  outline?: PlaceOutline;
  gradient?: Gradient;
  strokeColor?: string;
  strokeWidthMm?: number;
}

export type CalendarMark = 'circle' | 'ring' | 'square' | 'heart' | 'star' | 'dot' | 'underline' | 'highlight' | 'cross';

/** A calendar: the weeks of a trip, or a whole month, with the photo days marked. */
export interface CalendarElement extends ElementBase {
  type: 'calendar';
  /** 'range': only the weeks from `start` to `end`; 'month': the whole month of `start`. */
  mode: 'range' | 'month';
  /** 'YYYY-MM-DD'. */
  start: string;
  end: string;
  /** Marked days ('YYYY-MM-DD'), usually the days photos were taken. */
  highlights: string[];
  /** 0 = Sunday, 1 = Monday. */
  weekStart: 0 | 1;
  showTitle: boolean;
  showWeekdays: boolean;
  /** Replaces the automatic title ("14 – 23 March 2026"). */
  title?: string;
  fontFamily: string;
  fontWeight: number;
  color: string;
  /** Colour of the marks. */
  accent: string;
  markStyle: CalendarMark;
  /** 0–1. Missing = 1. */
  opacity?: number;
}

export type Element = ImageElement | TextElement | ShapeElement | CalendarElement;

export interface BackgroundImage {
  assetId: ID;
  /** 'cover' fills the surface (cropping the photo); 'contain' shows all of it. */
  fit: FitMode;
  /** 0–1. */
  opacity: number;
  crop: Crop;
  /** 'contain' only: where the whole photo sits on the surface (mm, surface coordinates, the
   * photo's own shape). Missing = as large as fits, centred. (Made by the desktop editor.) */
  box?: Rect;
  /** The background photo's own adjustments, applied before the document's grade. */
  adjust?: ColorGrade;
}

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
  /** A photo filling the whole surface (out to the bleed), behind every element. Auto layouts
   * never touch it. */
  backgroundImage?: BackgroundImage;
  layout?: SpreadLayout;
  /** Where an auto layout came from. `generatedIds`: elements the generator made besides photos
   * (e.g. a collage title band) — replaced on re-layout, unlike text the user added. */
  provenance?: { generatedAt: string; seed: number; assetIds: ID[]; generatedIds?: ID[] };
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
  /** Start every chapter on an opener page (book templates). */
  chapterOpeners?: boolean;
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
  /** Colour grade applied to every photo (and the background image) when shown and printed. */
  grade?: ColorGrade;
  /** Poster or book template it was last started from (highlighted in the picker). */
  template?: string;
}

/** A whole-document colour grade. Sliders are −100…100 (fade 0…100); 0 = unchanged. */
export interface ColorGrade {
  preset: string;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  fade: number;
  /** Tint shadows-to-highlights through a single colour (black & white, sepia). */
  mono?: 'bw' | 'sepia';
  /** A negative: every colour turned to its opposite (white becomes black), after everything else. */
  invert?: boolean;
  /** 'photos': the grade changes the photos only, not the background photo (posters made in the
   * desktop editor). Missing or 'page': the background photo too. */
  scope?: 'photos' | 'page';
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
  /** Mean colour (sRGB 0–255). Photos imported before colour analysis get it on next library load. */
  avgColor?: [number, number, number];
  /** 3 × 3 grid of mean colours (27 numbers, row-major RGB): palette plus rough composition. */
  colorGrid?: number[];
  /** Has see-through pixels (a cutout or sticker). Missing = opaque (checked on next library load). */
  transparent?: boolean;
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
