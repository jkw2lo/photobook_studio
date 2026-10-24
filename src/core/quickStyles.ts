import type { BookDocument, TextElement } from './model';
import { findSurface } from './surface';
import { updateElement } from './commands';
import { nearestWeight } from './fonts';
import { mixColor, pageScale } from './typography';
import { MM_PER_PT } from './units';

// Quick styles: one-click looks for a text box (font, weight, size, case, and sometimes a band of
// colour behind it). Unlike type-pack roles they are a starting point — the box becomes custom and
// every setting stays editable. Sizes are points on an 8 in page and scale with the page.

type Tone = 'text' | 'paper' | 'muted';

export interface TextQuickStyle {
  id: string;
  name: string;
  /** Short text to show the style off in the picker (and to fill a new box). */
  sample: string;
  family: string;
  weight: number;
  sizePt: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacingEm?: number;
  lineHeight?: number;
  color?: Tone;
  /** A fill behind the text. */
  background?: { tone: Tone; opacity: number };
}

export const TEXT_QUICK_STYLES: TextQuickStyle[] = [
  { id: 'headline', name: 'Big headline', sample: 'Summer', family: 'Abril Fatface', weight: 400, sizePt: 44, lineHeight: 1.0 },
  { id: 'elegant', name: 'Elegant', sample: 'Our Wedding', family: 'Cormorant Garamond', weight: 300, sizePt: 40, italic: true, lineHeight: 1.05 },
  { id: 'magazine', name: 'Magazine', sample: 'The Issue', family: 'Playfair Display', weight: 900, sizePt: 38, italic: true, lineHeight: 1.0 },
  { id: 'modern', name: 'Modern bold', sample: 'Road trip', family: 'Inter', weight: 800, sizePt: 32, letterSpacingEm: -0.02, lineHeight: 1.05 },
  { id: 'script', name: 'Script', sample: 'Hello there', family: 'Dancing Script', weight: 700, sizePt: 36, lineHeight: 1.1 },
  { id: 'marker', name: 'Marker', sample: 'Best day!', family: 'Permanent Marker', weight: 400, sizePt: 26, lineHeight: 1.1 },
  { id: 'caps', name: 'Tracked caps', sample: 'Lisbon · 2026', family: 'Montserrat', weight: 600, sizePt: 12, uppercase: true, letterSpacingEm: 0.3 },
  { id: 'note', name: 'Handwritten', sample: 'remember this', family: 'Caveat', weight: 600, sizePt: 22, lineHeight: 1.15 },
  { id: 'typewriter', name: 'Typewriter', sample: 'Day 3, 6:40 am', family: 'Courier Prime', weight: 400, sizePt: 11, lineHeight: 1.35 },
  { id: 'soft', name: 'Soft caption', sample: 'Early morning light', family: 'Source Serif 4', weight: 400, sizePt: 10, italic: true, color: 'muted' },
  { id: 'band', name: 'Label band', sample: 'Chapter one', family: 'Inter', weight: 700, sizePt: 11, uppercase: true, letterSpacingEm: 0.2, color: 'paper', background: { tone: 'text', opacity: 0.85 } },
  { id: 'frosted', name: 'Frosted box', sample: 'Notes from the coast', family: 'Raleway', weight: 500, sizePt: 14, lineHeight: 1.3, background: { tone: 'paper', opacity: 0.75 } },
];

export function quickStyle(id: string): TextQuickStyle | undefined {
  return TEXT_QUICK_STYLES.find((q) => q.id === id);
}

function toneColor(doc: Pick<BookDocument, 'style'>, tone: Tone | undefined): string {
  if (tone === 'paper') return doc.style.background;
  if (tone === 'muted') return mixColor(doc.style.textColor, doc.style.background, 0.4);
  return doc.style.textColor;
}

/** Height that fits `text` in a box `widthMm` wide, estimated from average glyph width. */
export function estimateTextHeightMm(text: string, widthMm: number, sizePt: number, lineHeight: number, letterSpacingEm: number, paddingMm: number): number {
  const sizeMm = sizePt * MM_PER_PT;
  const perLine = Math.max(1, Math.floor((widthMm - 2 * paddingMm) / (sizeMm * (0.55 + letterSpacingEm))));
  const lines = text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
  return lines * sizeMm * lineHeight + 2 * paddingMm + 1;
}

/** The fields a quick style sets on a text box (sized for this page). */
export function quickStyleFields(doc: Pick<BookDocument, 'style' | 'settings'>, q: TextQuickStyle): Partial<TextElement> {
  const sizePt = Math.round(q.sizePt * pageScale(doc) * 2) / 2;
  return {
    fontFamily: q.family,
    fontWeight: nearestWeight(q.family, q.weight),
    fontSizePt: sizePt,
    italic: !!q.italic,
    uppercase: !!q.uppercase,
    letterSpacingEm: q.letterSpacingEm ?? 0,
    lineHeight: q.lineHeight ?? 1.25,
    color: toneColor(doc, q.color),
    backgroundColor: q.background ? toneColor(doc, q.background.tone) : undefined,
    backgroundOpacity: q.background?.opacity,
    paddingMm: q.background ? Math.round(sizePt * MM_PER_PT * 0.45 * 10) / 10 : 0,
    styleLinked: false,
  };
}

/** Give a text box a quick style; its height grows (or shrinks) to fit the new size. */
export function applyQuickStyle(doc: BookDocument, spreadId: string, elementId: string, styleId: string): BookDocument {
  const q = quickStyle(styleId);
  const el = findSurface(doc, spreadId)?.surface.elements.find((e) => e.id === elementId);
  if (!q || !el || el.type !== 'text') return doc;
  const f = quickStyleFields(doc, q);
  const heightMm = estimateTextHeightMm(el.text, el.widthMm, f.fontSizePt!, f.lineHeight!, f.letterSpacingEm!, f.paddingMm!);
  return updateElement(doc, spreadId, elementId, { ...f, heightMm });
}
