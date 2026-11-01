import type { BookDocument, SavedTextLook, TextElement } from './model';
import { findSurface } from './surface';
import { updateElement } from './commands';
import { nearestWeight } from './fonts';
import { estimateTextHeightMm } from './quickStyles';
import { pageScale } from './typography';
import { MM_PER_PT } from './units';
import { newId } from './random';

// Text looks: finished title treatments in the spirit of real posters and magazines — retro signs,
// fashion mastheads, gig posters, 3D and neon letters. A look sets the font and every letter effect
// (and clears the ones it doesn't use); effect sizes are fractions of the type size, so a look
// works at any size. Documents can also save their own looks to reuse on every page.

type Tone = 'text' | 'paper';
type Colour = string | Tone;

export type TextLookCategory = 'Retro' | 'Vintage' | 'Editorial' | 'Bold' | 'Neon' | 'Y2K' | 'Playful';

export interface TextLookDef {
  id: string;
  name: string;
  category: TextLookCategory;
  sample: string;
  family: string;
  weight: number;
  /** Points on an 8 in page (scales with the page). */
  sizePt: number;
  italic?: boolean;
  uppercase?: boolean;
  letterSpacingEm?: number;
  lineHeight?: number;
  color: Colour;
  gradient?: { from: string; to: string; angleDeg: number };
  /** Widths and offsets below are in em (fractions of the type size). */
  stroke?: { color: Colour; em: number };
  outline2?: { color: Colour; em: number };
  shadow?: { color: Colour; em: number; opacity: number };
  extrude?: { color: Colour; em: number; angleDeg: number };
  glow?: { color: string; em: number };
  skewDeg?: number;
  arch?: number;
  background?: { color: Colour; opacity: number };
}

export const TEXT_LOOK_CATEGORIES: TextLookCategory[] = ['Retro', 'Vintage', 'Editorial', 'Bold', 'Neon', 'Y2K', 'Playful'];

export const TEXT_LOOKS: TextLookDef[] = [
  // Retro
  { id: 'groovy', name: '70s groovy', category: 'Retro', sample: 'Far out', family: 'Shrikhand', weight: 400, sizePt: 46, lineHeight: 1, color: '#f08a24', extrude: { color: '#7a2e12', em: 0.09, angleDeg: 50 }, outline2: { color: '#fff3d6', em: 0.03 } },
  { id: 'diner', name: 'Diner sign', category: 'Retro', sample: 'Open late', family: 'Righteous', weight: 400, sizePt: 40, lineHeight: 1, color: '#fffaf0', stroke: { color: '#d7263d', em: 0.07 }, shadow: { color: '#1b1b1d', em: 0.06, opacity: 0.9 } },
  { id: 'retro-script', name: 'Retro script', category: 'Retro', sample: 'Sunset Drive', family: 'Lobster', weight: 400, sizePt: 42, lineHeight: 1.05, color: '#f4d35e', extrude: { color: '#1d3557', em: 0.07, angleDeg: 60 }, skewDeg: 4 },
  { id: 'arcade', name: 'Arcade', category: 'Retro', sample: 'High score', family: 'Bungee', weight: 400, sizePt: 36, uppercase: true, lineHeight: 1, color: '#ffd23f', extrude: { color: '#ee4266', em: 0.1, angleDeg: 45 }, outline2: { color: '#1b1b1d', em: 0.04 } },
  { id: 'deco', name: 'Art deco', category: 'Retro', sample: 'Grand Hotel', family: 'Limelight', weight: 400, sizePt: 34, uppercase: true, letterSpacingEm: 0.12, lineHeight: 1.05, color: '#c9a227', gradient: { from: '#f5e199', to: '#9c7a1a', angleDeg: 180 } },
  { id: 'postcard', name: 'Postcard', category: 'Retro', sample: 'Greetings', family: 'Pacifico', weight: 400, sizePt: 40, lineHeight: 1.1, color: '#ffffff', stroke: { color: '#2b4c7e', em: 0.08 }, shadow: { color: '#2b4c7e', em: 0.07, opacity: 1 }, arch: 18 },
  { id: 'riso', name: 'Riso misprint', category: 'Retro', sample: 'Zine', family: 'Bebas Neue', weight: 400, sizePt: 60, uppercase: true, letterSpacingEm: 0.02, lineHeight: 0.92, color: '#2b59c3', shadow: { color: '#ff4f79', em: 0.05, opacity: 0.85 } },
  { id: 'disco', name: 'Disco', category: 'Retro', sample: 'Boogie', family: 'Shrikhand', weight: 400, sizePt: 44, lineHeight: 1, color: '#ffd23f', gradient: { from: '#ffe680', to: '#ff7b54', angleDeg: 180 }, extrude: { color: '#8a2be2', em: 0.08, angleDeg: 90 }, skewDeg: 6 },
  // Vintage
  { id: 'western', name: 'Western', category: 'Vintage', sample: 'Wild West', family: 'Cinzel', weight: 900, sizePt: 40, uppercase: true, letterSpacingEm: 0.06, lineHeight: 1, color: '#9a3b14', outline2: { color: '#f4e3c3', em: 0.04 }, extrude: { color: '#3d1a0b', em: 0.07, angleDeg: 60 } },
  { id: 'stamp', name: 'Stamp', category: 'Vintage', sample: 'Air mail', family: 'Oswald', weight: 600, sizePt: 30, uppercase: true, letterSpacingEm: 0.22, lineHeight: 1.05, color: '#c0392b', stroke: { color: '#c0392b', em: 0.012 } },
  { id: 'badge-arch', name: 'Retro badge', category: 'Vintage', sample: 'Since 1987', family: 'Righteous', weight: 400, sizePt: 30, uppercase: true, letterSpacingEm: 0.1, lineHeight: 1, color: '#2f4858', arch: 40 },
  { id: 'typewriter-tag', name: 'Typed label', category: 'Vintage', sample: 'No. 04 — Lisbon', family: 'Courier Prime', weight: 700, sizePt: 16, uppercase: true, letterSpacingEm: 0.08, color: '#1b1b1d', background: { color: '#f2e8cf', opacity: 1 } },
  { id: 'old-hollywood', name: 'Old Hollywood', category: 'Vintage', sample: 'Premiere', family: 'Limelight', weight: 400, sizePt: 40, lineHeight: 1, color: '#f6e7b4', shadow: { color: '#3a2b18', em: 0.06, opacity: 0.9 }, outline2: { color: '#8c6d2c', em: 0.025 } },
  // Editorial
  { id: 'vogue', name: 'Fashion masthead', category: 'Editorial', sample: 'MAISON', family: 'Bodoni Moda', weight: 800, sizePt: 60, uppercase: true, letterSpacingEm: -0.02, lineHeight: 0.95, color: 'text' },
  { id: 'thin-luxe', name: 'Thin luxe', category: 'Editorial', sample: 'The Edit', family: 'Italiana', weight: 400, sizePt: 38, uppercase: true, letterSpacingEm: 0.28, lineHeight: 1.1, color: 'text' },
  { id: 'deck', name: 'Serif italic deck', category: 'Editorial', sample: 'Notes on summer', family: 'Playfair Display', weight: 400, sizePt: 30, italic: true, lineHeight: 1.1, color: 'text' },
  { id: 'gold-caps', name: 'Gold caps', category: 'Editorial', sample: 'Anniversary', family: 'Cinzel', weight: 600, sizePt: 30, uppercase: true, letterSpacingEm: 0.16, lineHeight: 1.1, color: '#b8860b', gradient: { from: '#f6e27a', to: '#a67c00', angleDeg: 160 } },
  { id: 'coverline', name: 'Coverline', category: 'Editorial', sample: '10 places to go now', family: 'Oswald', weight: 500, sizePt: 22, uppercase: true, letterSpacingEm: 0.08, lineHeight: 1.05, color: '#e63946' },
  { id: 'swash', name: 'Italic swash', category: 'Editorial', sample: 'Summer', family: 'Playfair Display', weight: 900, sizePt: 58, italic: true, letterSpacingEm: -0.03, lineHeight: 0.95, color: 'text' },
  { id: 'wide', name: 'Wide gallery', category: 'Editorial', sample: 'Exhibition', family: 'Syne', weight: 800, sizePt: 34, uppercase: true, letterSpacingEm: 0.04, lineHeight: 1, color: 'text' },
  // Bold
  { id: 'gig', name: 'Gig poster', category: 'Bold', sample: 'Live tonight', family: 'Bebas Neue', weight: 400, sizePt: 64, uppercase: true, letterSpacingEm: 0.03, lineHeight: 0.92, color: 'text' },
  { id: 'shout', name: 'Bold shadow', category: 'Bold', sample: 'Big news', family: 'Anton', weight: 400, sizePt: 52, uppercase: true, lineHeight: 0.95, color: '#ffffff', stroke: { color: '#111111', em: 0.05 }, shadow: { color: '#111111', em: 0.08, opacity: 1 } },
  { id: 'pop3d', name: '3D pop', category: 'Bold', sample: 'Wow', family: 'Archivo Black', weight: 400, sizePt: 56, uppercase: true, lineHeight: 0.95, color: '#ffffff', stroke: { color: '#111111', em: 0.045 }, extrude: { color: '#111111', em: 0.14, angleDeg: 45 } },
  { id: 'long', name: 'Long shadow', category: 'Bold', sample: 'Road trip', family: 'Oswald', weight: 700, sizePt: 46, uppercase: true, lineHeight: 1, color: '#ffffff', extrude: { color: '#3d405b', em: 0.35, angleDeg: 45 } },
  { id: 'hollow', name: 'Hollow', category: 'Bold', sample: 'Outline', family: 'Anton', weight: 400, sizePt: 56, uppercase: true, lineHeight: 0.95, color: 'paper', stroke: { color: 'text', em: 0.05 } },
  { id: 'chrome', name: 'Chrome', category: 'Bold', sample: 'Metal', family: 'Archivo Black', weight: 400, sizePt: 54, uppercase: true, lineHeight: 0.95, color: '#c0c6d0', gradient: { from: '#f4f6fa', to: '#69707c', angleDeg: 180 }, stroke: { color: '#22252b', em: 0.035 }, extrude: { color: '#22252b', em: 0.08, angleDeg: 70 } },
  { id: 'brutal', name: 'Brutalist', category: 'Bold', sample: 'RAW', family: 'Archivo Black', weight: 400, sizePt: 60, uppercase: true, letterSpacingEm: -0.04, lineHeight: 0.9, color: '#111111', background: { color: '#ffe600', opacity: 1 } },
  { id: 'comic', name: 'Comic pop', category: 'Bold', sample: 'Pow!', family: 'Bungee', weight: 400, sizePt: 50, uppercase: true, lineHeight: 1, color: '#ffde00', stroke: { color: '#111111', em: 0.06 }, extrude: { color: '#111111', em: 0.1, angleDeg: 50 }, skewDeg: 8 },
  // Neon
  { id: 'neon-pink', name: 'Neon pink', category: 'Neon', sample: 'Night out', family: 'Pacifico', weight: 400, sizePt: 40, lineHeight: 1.1, color: '#ffe3f4', glow: { color: '#ff3cac', em: 0.22 } },
  { id: 'neon-tube', name: 'Neon tube', category: 'Neon', sample: 'Open', family: 'Monoton', weight: 400, sizePt: 48, uppercase: true, lineHeight: 1, color: '#d9fbff', glow: { color: '#18c8ff', em: 0.2 } },
  { id: 'neon-sign', name: 'Neon sign', category: 'Neon', sample: 'Motel', family: 'Righteous', weight: 400, sizePt: 44, uppercase: true, letterSpacingEm: 0.06, lineHeight: 1, color: '#fff7c2', glow: { color: '#ffb000', em: 0.18 } },
  { id: 'neon-green', name: 'Neon green', category: 'Neon', sample: 'Arcade', family: 'Bungee', weight: 400, sizePt: 40, uppercase: true, lineHeight: 1, color: '#e9ffd9', glow: { color: '#39ff14', em: 0.2 } },
  { id: 'cyber', name: 'Cyber', category: 'Neon', sample: 'Future', family: 'Syne', weight: 800, sizePt: 46, uppercase: true, letterSpacingEm: 0.06, lineHeight: 1, color: '#f3e8ff', glow: { color: '#a855f7', em: 0.18 }, outline2: { color: '#22d3ee', em: 0.02 } },
  // Y2K
  { id: 'y2k-chrome', name: 'Bubble chrome', category: 'Y2K', sample: 'Millennium', family: 'Righteous', weight: 400, sizePt: 44, lineHeight: 1, color: '#dfe7ff', gradient: { from: '#ffffff', to: '#8aa4ff', angleDeg: 180 }, stroke: { color: '#5b4bdb', em: 0.05 }, glow: { color: '#b8c6ff', em: 0.15 } },
  { id: 'y2k-pink', name: 'Pink pop', category: 'Y2K', sample: 'Babe', family: 'Syne', weight: 800, sizePt: 52, lineHeight: 0.95, color: '#ff6ec7', gradient: { from: '#ff9ad5', to: '#b46bff', angleDeg: 135 }, outline2: { color: '#ffffff', em: 0.07 }, shadow: { color: '#b46bff', em: 0.06, opacity: 0.6 } },
  { id: 'y2k-sticker', name: 'Holo sticker', category: 'Y2K', sample: 'Cyber girl', family: 'Archivo Black', weight: 400, sizePt: 40, lineHeight: 1, color: '#9ef0ff', gradient: { from: '#9ef0ff', to: '#ff9ad5', angleDeg: 90 }, stroke: { color: '#5b4bdb', em: 0.04 }, extrude: { color: '#5b4bdb', em: 0.07, angleDeg: 60 } },
  // Playful
  { id: 'surf', name: 'Surf sunset', category: 'Playful', sample: 'Aloha', family: 'Pacifico', weight: 400, sizePt: 44, lineHeight: 1.1, color: '#ff7e5f', gradient: { from: '#feb47b', to: '#ff5e62', angleDeg: 180 }, arch: 30 },
  { id: 'sticker', name: 'Sticker', category: 'Playful', sample: 'Yay!', family: 'Archivo Black', weight: 400, sizePt: 44, lineHeight: 1, color: '#ff5a5f', outline2: { color: '#ffffff', em: 0.12 }, shadow: { color: '#000000', em: 0.05, opacity: 0.35 } },
  { id: 'bubblegum', name: 'Bubblegum', category: 'Playful', sample: 'Sweet', family: 'Shrikhand', weight: 400, sizePt: 46, lineHeight: 1, color: '#ff7ab6', outline2: { color: '#ffffff', em: 0.1 }, shadow: { color: '#c2185b', em: 0.08, opacity: 0.8 } },
  { id: 'candy', name: 'Candy stripe', category: 'Playful', sample: 'Party!', family: 'Lobster', weight: 400, sizePt: 46, lineHeight: 1, color: '#ff5a5f', gradient: { from: '#ffd23f', to: '#ff5a5f', angleDeg: 90 }, stroke: { color: '#ffffff', em: 0.05 }, shadow: { color: '#2b2d42', em: 0.06, opacity: 1 } },
  { id: 'tag', name: 'Marker tag', category: 'Playful', sample: 'was here', family: 'Permanent Marker', weight: 400, sizePt: 36, lineHeight: 1.05, color: '#1b1b1d', skewDeg: -6 },
  { id: 'label', name: 'Label band', category: 'Playful', sample: 'Chapter one', family: 'Bebas Neue', weight: 400, sizePt: 22, uppercase: true, letterSpacingEm: 0.18, color: 'paper', background: { color: 'text', opacity: 0.9 } },
];

export const textLook = (id: string) => TEXT_LOOKS.find((l) => l.id === id);

const colour = (doc: Pick<BookDocument, 'style'>, c: Colour): string => (c === 'text' ? doc.style.textColor : c === 'paper' ? doc.style.background : c);

/** Every field a look sets on a text box, sized for this page; effects it doesn't use are cleared. */
export function textLookFields(doc: Pick<BookDocument, 'style' | 'settings'>, look: TextLookDef): Partial<TextElement> {
  const sizePt = Math.round(look.sizePt * pageScale(doc) * 2) / 2;
  const em = sizePt * MM_PER_PT;
  const mm = (v: number) => Math.round(v * em * 100) / 100;
  return {
    fontFamily: look.family,
    fontWeight: nearestWeight(look.family, look.weight),
    fontSizePt: sizePt,
    italic: !!look.italic,
    uppercase: !!look.uppercase,
    letterSpacingEm: look.letterSpacingEm ?? 0,
    lineHeight: look.lineHeight ?? 1.15,
    color: colour(doc, look.color),
    gradient: look.gradient,
    strokeColor: look.stroke ? colour(doc, look.stroke.color) : undefined,
    strokeWidthMm: look.stroke ? mm(look.stroke.em) : undefined,
    outline2: look.outline2 ? { color: colour(doc, look.outline2.color), widthMm: mm(look.outline2.em) } : undefined,
    shadow: look.shadow ? { color: colour(doc, look.shadow.color), dxMm: mm(look.shadow.em), dyMm: mm(look.shadow.em), opacity: look.shadow.opacity } : undefined,
    extrude: look.extrude ? { color: colour(doc, look.extrude.color), depthMm: mm(look.extrude.em), angleDeg: look.extrude.angleDeg } : undefined,
    glow: look.glow ? { color: look.glow.color, sizeMm: mm(look.glow.em) } : undefined,
    skewDeg: look.skewDeg,
    arch: look.arch,
    backgroundColor: look.background ? colour(doc, look.background.color) : undefined,
    backgroundOpacity: look.background?.opacity,
    paddingMm: look.background ? Math.round(em * 0.4 * 10) / 10 : 0,
    vertical: undefined,
    styleLinked: false,
  };
}

/** The letter-look fields of a text box (everything but its words, place and size on the page). */
export function lookFieldsOf(el: TextElement): Partial<TextElement> {
  const keys = [
    'fontFamily', 'fontWeight', 'fontSizePt', 'italic', 'uppercase', 'letterSpacingEm', 'lineHeight', 'color', 'gradient', 'strokeColor', 'strokeWidthMm',
    'outline2', 'shadow', 'extrude', 'glow', 'skewDeg', 'arch', 'backgroundColor', 'backgroundOpacity', 'backgroundRadiusMm', 'paddingMm', 'align',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = el[k];
  return { ...(out as Partial<TextElement>), styleLinked: false };
}

/** Give a text box a look (from the library or saved); its height grows or shrinks to fit. */
export function applyTextLook(doc: BookDocument, spreadId: string, elementId: string, fields: Partial<TextElement>): BookDocument {
  const el = findSurface(doc, spreadId)?.surface.elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'text') return doc;
  const f = { ...el, ...fields };
  const archRoom = f.arch ? ((Math.abs(f.arch) / 100) * el.widthMm) / 2 : 0;
  const heightMm = estimateTextHeightMm(el.text, el.widthMm, f.fontSizePt, f.lineHeight, f.letterSpacingEm ?? 0, f.paddingMm ?? 0) + archRoom;
  return updateElement(doc, spreadId, elementId, { ...fields, heightMm });
}

/** Save a text box's look under a name, for any page of this document. */
export function saveTextLook(doc: BookDocument, name: string, el: TextElement): { doc: BookDocument; id: string } {
  const id = newId();
  const look: SavedTextLook = { id, name: name.trim() || 'My look', fields: lookFieldsOf(el) };
  return { doc: { ...doc, textLooks: [...(doc.textLooks ?? []), look] }, id };
}

export function deleteTextLook(doc: BookDocument, id: string): BookDocument {
  const rest = (doc.textLooks ?? []).filter((l) => l.id !== id);
  return { ...doc, textLooks: rest.length ? rest : undefined };
}

/** Apply a saved look to every text box in the document that already uses the same font and size
 * as `fromEl` — the quick way to keep titles consistent across pages. Returns how many changed. */
export function applyLookEverywhere(doc: BookDocument, fromEl: TextElement, fields: Partial<TextElement>): { doc: BookDocument; changed: number } {
  let changed = 0;
  let next = doc;
  for (const s of doc.cover ? [doc.cover, ...doc.spreads] : doc.spreads) {
    for (const e of s.elements) {
      if (e.type !== 'text' || e.id === fromEl.id || e.fontFamily !== fromEl.fontFamily || Math.abs(e.fontSizePt - fromEl.fontSizePt) > 0.01) continue;
      next = applyTextLook(next, s.id, e.id, fields);
      changed++;
    }
  }
  return { doc: next, changed };
}
