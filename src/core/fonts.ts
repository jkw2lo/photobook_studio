// Bundled font families. The same font files back the editor (CSS @font-face via @fontsource)
// and the PDF export (embedded .woff), so preview and print use identical metrics.

export type FontCategory = 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';

export interface FontFamilyDef {
  family: string;
  /** @fontsource package directory name. */
  pkg: string;
  weights: number[];
  category: FontCategory;
  /** One line on where it works best — shown in the font picker. */
  note: string;
}

// Every weight listed here is verified to embed in PDFs (tests/fonts.test.ts). Some fonts that
// render fine in the browser crash PDFKit's subsetter (e.g. IBM Plex Mono), so they are left out.
export const FONT_FAMILIES: FontFamilyDef[] = [
  // Sans
  { family: 'Inter', pkg: 'inter', weights: [300, 400, 600], category: 'sans', note: 'Neutral, very legible captions' },
  { family: 'Montserrat', pkg: 'montserrat', weights: [300, 400, 600], category: 'sans', note: 'Geometric, confident headings' },
  { family: 'Josefin Sans', pkg: 'josefin-sans', weights: [300, 400, 600], category: 'sans', note: 'Elegant, vintage geometric' },
  { family: 'Raleway', pkg: 'raleway', weights: [300, 400, 700], category: 'sans', note: 'Light and airy, minimalist' },
  { family: 'Work Sans', pkg: 'work-sans', weights: [400, 600], category: 'sans', note: 'Friendly, slightly wide' },
  // Serif
  { family: 'Source Serif 4', pkg: 'source-serif-4', weights: [400, 600], category: 'serif', note: 'Calm, readable body text' },
  { family: 'Lora', pkg: 'lora', weights: [400, 700], category: 'serif', note: 'Warm, storybook feel' },
  { family: 'EB Garamond', pkg: 'eb-garamond', weights: [400, 600], category: 'serif', note: 'Classic book typography' },
  { family: 'Cormorant Garamond', pkg: 'cormorant-garamond', weights: [300, 400, 600], category: 'serif', note: 'Refined, high-contrast, wedding albums' },
  { family: 'Libre Baskerville', pkg: 'libre-baskerville', weights: [400, 700], category: 'serif', note: 'Traditional, sturdy' },
  // Display
  { family: 'Playfair Display', pkg: 'playfair-display', weights: [400, 700], category: 'display', note: 'Editorial titles' },
  { family: 'Bodoni Moda', pkg: 'bodoni-moda', weights: [400, 700], category: 'display', note: 'High fashion, magazine covers' },
  { family: 'DM Serif Display', pkg: 'dm-serif-display', weights: [400], category: 'display', note: 'Soft, bold display serif' },
  { family: 'Abril Fatface', pkg: 'abril-fatface', weights: [400], category: 'display', note: 'Heavy poster headlines' },
  { family: 'Fraunces', pkg: 'fraunces', weights: [400, 700], category: 'display', note: 'Quirky, characterful old-style' },
  // Handwriting
  { family: 'Caveat', pkg: 'caveat', weights: [400, 700], category: 'handwriting', note: 'Casual handwritten notes' },
  { family: 'Dancing Script', pkg: 'dancing-script', weights: [400, 700], category: 'handwriting', note: 'Flowing script, celebrations' },
  { family: 'Amatic SC', pkg: 'amatic-sc', weights: [400, 700], category: 'handwriting', note: 'Tall hand-drawn capitals' },
  { family: 'Permanent Marker', pkg: 'permanent-marker', weights: [400], category: 'handwriting', note: 'Bold marker, scrapbook labels' },
  // Mono
  { family: 'Courier Prime', pkg: 'courier-prime', weights: [400, 700], category: 'mono', note: 'Typewriter, documentary captions' },
];

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'handwriting', label: 'Handwriting' },
  { id: 'mono', label: 'Typewriter' },
];

export function weightName(w: number): string {
  return w <= 300 ? 'Light' : w <= 400 ? 'Regular' : w <= 500 ? 'Medium' : w <= 600 ? 'Semibold' : 'Bold';
}

export function fontFamily(family: string): FontFamilyDef {
  return FONT_FAMILIES.find((f) => f.family === family) ?? FONT_FAMILIES[0];
}

/** Snap a requested weight to the nearest bundled weight of that family. */
export function nearestWeight(family: string, weight: number): number {
  const def = fontFamily(family);
  return def.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

/** Relative path (from the project root) of the .woff file the PDF exporter embeds. */
export function fontFilePath(family: string, weight: number): string {
  const def = fontFamily(family);
  const w = nearestWeight(def.family, weight);
  return `node_modules/@fontsource/${def.pkg}/files/${def.pkg}-latin-${w}-normal.woff`;
}
