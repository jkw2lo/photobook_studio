import type { Font } from 'fontkit';

// Text → vector outline, for photos cut to the shape of a word. Uses the same font files as the
// editor and the PDF. The outline is returned tightly cropped and scaled to a box 100 units tall,
// with its width/height ratio, ready to be fitted into a photo frame (core: maskPath).

export interface OutlineRequest {
  text: string;
  fontFamily: string;
  fontWeight: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacingEm?: number;
}

/** `f` is the font file for the request's family, weight and style (each side loads it its own way). */
export function textOutline(f: Font, req: OutlineRequest): { d: string; aspect: number } {
  const em = f.unitsPerEm;
  const spacing = (req.letterSpacingEm ?? 0) * em;
  const lines = (req.uppercase ? req.text.toUpperCase() : req.text).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Type some text for the photo to fill');
  // Lay out each line in font units (y up), centred on x = 0; lines stacked 0.95 em apart.
  type Cmd = { c: string; p: number[] };
  const cmds: Cmd[] = [];
  lines.forEach((line, li) => {
    const run = f.layout(line);
    const width = run.positions.reduce((s, p) => s + p.xAdvance + spacing, -spacing);
    let pen = -width / 2;
    const baseline = -li * em * 0.95;
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i];
      const ox = pen + pos.xOffset;
      const oy = baseline + pos.yOffset;
      for (const cmd of g.path.commands) {
        const pts: number[] = [];
        for (let k = 0; k + 1 < cmd.args.length; k += 2) pts.push(ox + cmd.args[k], oy + cmd.args[k + 1]);
        cmds.push({ c: { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' }[cmd.command], p: pts });
      }
      pen += pos.xAdvance + spacing;
    });
  });
  const xs = cmds.flatMap((c) => c.p.filter((_, i) => i % 2 === 0));
  const ys = cmds.flatMap((c) => c.p.filter((_, i) => i % 2 === 1));
  if (!xs.length) throw new Error('This font has no outlines for that text');
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = 100 / (maxY - minY);
  const r = (n: number) => Math.round(n * 100) / 100;
  // Flip y (fonts are y-up; the page is y-down) and move to the box origin.
  const d = cmds.map(({ c, p }) => c + p.map((v, i) => r(i % 2 === 0 ? (v - minX) * k : (maxY - v) * k)).join(' ')).join('');
  return { d, aspect: (maxX - minX) / (maxY - minY) };
}
