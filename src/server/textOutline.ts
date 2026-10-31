import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync, type Font } from 'fontkit';
import { fontFilePath } from '../core';
import { textOutline as outline, type OutlineRequest } from '../shared/textOutline';

// Text → vector outline (see src/shared/textOutline.ts), with the font files read from disk.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fonts = new Map<string, Font>();

function font(family: string, weight: number, italic: boolean): Font {
  const file = fontFilePath(family, weight, italic);
  let f = fonts.get(file);
  if (!f) {
    f = openSync(join(ROOT, file));
    fonts.set(file, f);
  }
  return f;
}

export type { OutlineRequest };

export const textOutline = (req: OutlineRequest) => outline(font(req.fontFamily, req.fontWeight, !!req.italic), req);
