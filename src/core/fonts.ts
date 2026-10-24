// Bundled font families. The same font files back the editor (CSS @font-face via @fontsource)
// and the PDF export (embedded .woff), so preview and print use identical metrics.

export interface FontFamilyDef {
  family: string;
  /** @fontsource package directory name. */
  pkg: string;
  weights: number[];
  category: 'sans' | 'serif' | 'display' | 'handwriting';
}

export const FONT_FAMILIES: FontFamilyDef[] = [
  { family: 'Inter', pkg: 'inter', weights: [400, 600], category: 'sans' },
  { family: 'Playfair Display', pkg: 'playfair-display', weights: [400, 700], category: 'display' },
  { family: 'Source Serif 4', pkg: 'source-serif-4', weights: [400, 600], category: 'serif' },
  { family: 'Caveat', pkg: 'caveat', weights: [400, 700], category: 'handwriting' },
];

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
