import type { BookDocument, ShapeElement } from './model';
import { addElement, updateElement } from './commands';
import { makeShapeElement } from './layout';
import { shapeDef } from './shapes';

// Sticker packs: shapes and icons in the same spirit as the text looks — a retro pack with warm
// colours and a hard drop shadow, neon with glowing tubes, playful die-cut stickers with a white
// border, bold ones outlined in black. Each sticker cycles through its pack's colours; effect sizes
// follow the sticker's size, so they look the same large or small. Everything stays editable.

export type StickerPackId = 'retro' | 'editorial' | 'bold' | 'neon' | 'playful' | 'y2k';

export interface StickerPack {
  id: StickerPackId;
  name: string;
  /** Shown behind the previews (neon needs the dark). */
  backdrop: string;
  palette: string[];
  /** Effects in fractions of the sticker's shorter side. */
  style: {
    stroke?: { color: string; f: number };
    shadow?: { color: string; f: number; opacity: number };
    glow?: { f: number; tint?: boolean };
    extrude?: { color: string; f: number; angleDeg: number };
    outline2?: { color: string; f: number };
  };
  shapes: string[];
}

export const STICKER_PACKS: StickerPack[] = [
  {
    id: 'retro', name: 'Retro', backdrop: '#f4e9d4', palette: ['#f08a24', '#e94f37', '#f4d35e', '#2b4c7e', '#3d8b6d'],
    style: { shadow: { color: '#5a2a12', f: 0.06, opacity: 1 } },
    shapes: ['s-rainbow', 's-bolt', 's-smiley', 'i-flower', 'i-sun', 'burst', 's-checker', 's-star-line'],
  },
  {
    id: 'editorial', name: 'Editorial', backdrop: '#f7f5f0', palette: ['#1b1b1d', '#a67c00', '#7f6a55'],
    style: {},
    shapes: ['s-ornament', 's-badge', 's-quote', 's-asterisk', 'frame', 'corners', 'double', 'i-star'],
  },
  {
    id: 'bold', name: 'Bold', backdrop: '#ffffff', palette: ['#ffd23f', '#ee4266', '#3bceac', '#ffffff'],
    style: { stroke: { color: '#111111', f: 0.05 }, shadow: { color: '#111111', f: 0.07, opacity: 1 } },
    shapes: ['burst', 's-exclaim', 's-x', 'i-arrow', 'i-check', 'seal', 's-bolt', 'i-heart'],
  },
  {
    id: 'neon', name: 'Neon', backdrop: '#14121c', palette: ['#ff3cac', '#18c8ff', '#ffb000', '#7cff6b'],
    style: { glow: { f: 0.12, tint: true } },
    shapes: ['s-heart-line', 's-star-line', 's-bolt', 'i-sparkle', 'i-moon', 's-arrow', 'ring', 's-scribble'],
  },
  {
    id: 'playful', name: 'Playful', backdrop: '#e9f3f1', palette: ['#ff5a5f', '#3bceac', '#ffd23f', '#5b8def', '#b07cff'],
    style: { outline2: { color: '#ffffff', f: 0.08 }, shadow: { color: '#000000', f: 0.04, opacity: 0.3 } },
    shapes: ['s-squiggle', 's-sparkles', 'i-heart', 'bubble', 's-smiley', 'i-cloud', 's-arrow', 'i-star'],
  },
  {
    id: 'y2k', name: 'Y2K', backdrop: '#efe6ff', palette: ['#c9c9ff', '#ff9ad5', '#9ef0ff', '#e6e6e6'],
    style: { stroke: { color: '#5b4bdb', f: 0.035 }, extrude: { color: '#5b4bdb', f: 0.07, angleDeg: 60 } },
    shapes: ['s-sparkles', 'i-star', 's-heart-line', 'i-sparkle', 's-bolt', 'blob', 's-badge', 'i-flower'],
  },
];

export const stickerPack = (id: string) => STICKER_PACKS.find((p) => p.id === id) ?? STICKER_PACKS[0];

/** A light tint of a colour (neon tubes are pale in the middle). */
function tint(hex: string, t: number): string {
  const x = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  return `#${ch.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The look of sticker number `i` from a pack, for a sticker `w` × `h` mm. */
export function stickerFields(pack: StickerPack, i: number, w: number, h: number): Partial<ShapeElement> {
  const colour = pack.palette[i % pack.palette.length];
  const s = Math.min(w, h);
  const r = (f: number) => Math.round(f * s * 100) / 100;
  const st = pack.style;
  return {
    fill: st.glow?.tint ? tint(colour, 0.55) : colour,
    opacity: 1,
    strokeColor: st.stroke?.color,
    strokeWidthMm: st.stroke ? r(st.stroke.f) : undefined,
    shadow: st.shadow ? { color: st.shadow.color, dxMm: r(st.shadow.f), dyMm: r(st.shadow.f), opacity: st.shadow.opacity } : undefined,
    glow: st.glow ? { color: colour, sizeMm: r(st.glow.f) } : undefined,
    extrude: st.extrude ? { color: st.extrude.color, depthMm: r(st.extrude.f), angleDeg: st.extrude.angleDeg } : undefined,
    outline2: st.outline2 ? { color: st.outline2.color, widthMm: r(st.outline2.f) } : undefined,
  };
}

/** Add a sticker from a pack, centred on a point and sized for the page. */
export function addSticker(doc: BookDocument, surfaceId: string, packId: string, shapeId: string, x: number, y: number): { doc: BookDocument; newId: string } {
  const pack = stickerPack(packId);
  const def = shapeDef(shapeId);
  const i = Math.max(0, pack.shapes.indexOf(shapeId));
  const short = Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm);
  const base = (def.category === 'line' ? 0.5 : def.aspect > 2.5 ? 0.42 : 0.18) * short;
  const w = def.aspect >= 1 ? base : base * def.aspect;
  const h = w / def.aspect;
  const el: ShapeElement = { ...makeShapeElement({ x: x - w / 2, y: y - h / 2, w, h }, '#000000'), shape: def.id };
  const next = addElement(doc, surfaceId, el);
  return { doc: updateElement(next, surfaceId, el.id, stickerFields(pack, i, w, h)), newId: el.id };
}
