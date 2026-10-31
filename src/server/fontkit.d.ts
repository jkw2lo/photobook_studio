// Minimal typings for the parts of fontkit (a PDFKit dependency) used to outline text.
declare module 'fontkit' {
  interface PathCommand {
    command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    args: number[];
  }
  interface Glyph {
    path: { commands: PathCommand[] };
    advanceWidth: number;
  }
  interface GlyphRun {
    glyphs: Glyph[];
    positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[];
  }
  interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    layout(text: string): GlyphRun;
  }
  export function openSync(path: string): Font;
  export function create(data: Uint8Array): Font;
}
