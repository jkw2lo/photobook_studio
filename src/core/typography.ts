import type { BookDocument, BookStyle, Element, TextElement, TextRole, TextStyle } from './model';
import { nearestWeight } from './fonts';

// Type packs: coordinated text styles (title, subtitle, heading, body, caption, quote, label).
// Text boxes follow their role's style while `styleLinked` is true, so switching packs restyles a
// whole book in one step; editing a box's font or size by hand makes it custom.
//
// Sizes are in points for an 8 in (203.2 mm) page and scale with the page's short side.

export const REFERENCE_MM = 203.2;

export const TEXT_ROLES: { role: TextRole; label: string; sample: string }[] = [
  { role: 'title', label: 'Title', sample: 'Summer in Lisbon' },
  { role: 'subtitle', label: 'Subtitle', sample: 'June 2026' },
  { role: 'heading', label: 'Heading', sample: 'Day One' },
  { role: 'body', label: 'Body', sample: 'We walked the old town until the light turned gold.' },
  { role: 'caption', label: 'Caption', sample: 'Alfama, early morning' },
  { role: 'quote', label: 'Quote', sample: '“Best trip yet.”' },
  { role: 'label', label: 'Label', sample: 'Day 1 · Lisbon' },
];

export const roleLabel = (role: TextRole) => TEXT_ROLES.find((r) => r.role === role)?.label ?? role;

export interface TypePack {
  id: string;
  name: string;
  description: string;
  roles: Record<TextRole, TextStyle>;
}

const s = (family: string, weight: number, sizePt: number, extra: Partial<TextStyle> = {}): TextStyle => ({
  family, weight, sizePt, lineHeight: 1.25, letterSpacingEm: 0, uppercase: false, tone: 'text', ...extra,
});

export const TYPE_PACKS: TypePack[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Garamond throughout, small tracked capitals for labels. Timeless and bookish.',
    roles: {
      title: s('EB Garamond', 400, 34, { lineHeight: 1.1 }),
      subtitle: s('EB Garamond', 400, 10, { uppercase: true, letterSpacingEm: 0.18 }),
      heading: s('EB Garamond', 600, 22, { lineHeight: 1.1 }),
      body: s('EB Garamond', 400, 11, { lineHeight: 1.4 }),
      caption: s('EB Garamond', 400, 9, { tone: 'muted' }),
      quote: s('Cormorant Garamond', 400, 22, { lineHeight: 1.2 }),
      label: s('Montserrat', 600, 7, { uppercase: true, letterSpacingEm: 0.2, tone: 'muted' }),
    },
  },
  {
    id: 'modern',
    name: 'Modern minimal',
    description: 'Light Inter titles, tracked capitals, lots of air. Clean and quiet.',
    roles: {
      title: s('Inter', 300, 30, { lineHeight: 1.1, letterSpacingEm: -0.01 }),
      subtitle: s('Inter', 400, 8.5, { uppercase: true, letterSpacingEm: 0.22, tone: 'muted' }),
      heading: s('Inter', 600, 18, { lineHeight: 1.15 }),
      body: s('Inter', 400, 9.5, { lineHeight: 1.45 }),
      caption: s('Inter', 400, 7.5, { tone: 'muted' }),
      quote: s('Inter', 300, 18, { lineHeight: 1.25 }),
      label: s('Inter', 600, 6.5, { uppercase: true, letterSpacingEm: 0.18, tone: 'muted' }),
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'High-contrast Bodoni with light sans labels. Fashion-magazine drama.',
    roles: {
      title: s('Bodoni Moda', 700, 36, { lineHeight: 1.05 }),
      subtitle: s('Montserrat', 300, 9, { uppercase: true, letterSpacingEm: 0.28 }),
      heading: s('Bodoni Moda', 400, 24, { lineHeight: 1.1 }),
      body: s('Source Serif 4', 400, 10, { lineHeight: 1.45 }),
      caption: s('Montserrat', 400, 7, { uppercase: true, letterSpacingEm: 0.12, tone: 'muted' }),
      quote: s('Bodoni Moda', 400, 24, { lineHeight: 1.15 }),
      label: s('Montserrat', 600, 7, { uppercase: true, letterSpacingEm: 0.28 }),
    },
  },
  {
    id: 'magazine',
    name: 'Bold magazine',
    description: 'Heavy display headlines with a friendly sans. Loud and graphic.',
    roles: {
      title: s('Abril Fatface', 400, 40, { lineHeight: 1.0 }),
      subtitle: s('Work Sans', 600, 9.5, { uppercase: true, letterSpacingEm: 0.12 }),
      heading: s('DM Serif Display', 400, 26, { lineHeight: 1.05 }),
      body: s('Work Sans', 400, 9.5, { lineHeight: 1.45 }),
      caption: s('Work Sans', 400, 7.5, { tone: 'muted' }),
      quote: s('DM Serif Display', 400, 24, { lineHeight: 1.15 }),
      label: s('Work Sans', 600, 7, { uppercase: true, letterSpacingEm: 0.14 }),
    },
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'Wide-tracked Raleway capitals with Lora text, like a museum wall label.',
    roles: {
      title: s('Raleway', 300, 26, { uppercase: true, letterSpacingEm: 0.3, lineHeight: 1.15 }),
      subtitle: s('Raleway', 400, 9, { uppercase: true, letterSpacingEm: 0.25, tone: 'muted' }),
      heading: s('Raleway', 700, 14, { uppercase: true, letterSpacingEm: 0.2 }),
      body: s('Lora', 400, 10, { lineHeight: 1.5 }),
      caption: s('Raleway', 400, 7.5, { tone: 'muted' }),
      quote: s('Lora', 400, 18, { lineHeight: 1.3 }),
      label: s('Raleway', 700, 6.5, { uppercase: true, letterSpacingEm: 0.3 }),
    },
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Typewriter titles and captions over Baskerville text. Field notes and archives.',
    roles: {
      title: s('Courier Prime', 700, 26, { uppercase: true, letterSpacingEm: 0.04, lineHeight: 1.15 }),
      subtitle: s('Courier Prime', 400, 9.5),
      heading: s('Libre Baskerville', 700, 18, { lineHeight: 1.15 }),
      body: s('Libre Baskerville', 400, 9.5, { lineHeight: 1.5 }),
      caption: s('Courier Prime', 400, 7.5, { tone: 'muted' }),
      quote: s('Libre Baskerville', 400, 17, { lineHeight: 1.3 }),
      label: s('Courier Prime', 700, 7, { uppercase: true, letterSpacingEm: 0.12 }),
    },
  },
  {
    id: 'romantic',
    name: 'Romantic',
    description: 'Flowing script titles with refined Cormorant. Weddings and celebrations.',
    roles: {
      title: s('Dancing Script', 700, 40, { lineHeight: 1.1 }),
      subtitle: s('Cormorant Garamond', 400, 10, { uppercase: true, letterSpacingEm: 0.3 }),
      heading: s('Cormorant Garamond', 600, 24, { lineHeight: 1.1 }),
      body: s('Cormorant Garamond', 400, 12, { lineHeight: 1.4 }),
      caption: s('Cormorant Garamond', 400, 10, { tone: 'muted' }),
      quote: s('Dancing Script', 400, 24, { lineHeight: 1.2 }),
      label: s('Cormorant Garamond', 600, 8, { uppercase: true, letterSpacingEm: 0.3, tone: 'muted' }),
    },
  },
  {
    id: 'retro',
    name: 'Retro',
    description: 'Geometric Josefin capitals with characterful Fraunces. Seventies postcard.',
    roles: {
      title: s('Josefin Sans', 600, 30, { uppercase: true, letterSpacingEm: 0.1, lineHeight: 1.1 }),
      subtitle: s('Josefin Sans', 300, 10, { uppercase: true, letterSpacingEm: 0.3 }),
      heading: s('Fraunces', 700, 22, { lineHeight: 1.1 }),
      body: s('Lora', 400, 10, { lineHeight: 1.45 }),
      caption: s('Josefin Sans', 400, 8, { tone: 'muted' }),
      quote: s('Fraunces', 400, 20, { lineHeight: 1.2 }),
      label: s('Josefin Sans', 600, 7, { uppercase: true, letterSpacingEm: 0.3 }),
    },
  },
  {
    id: 'journal',
    name: 'Journal',
    description: 'Handwritten notes with tall hand-drawn capitals. Travel diary.',
    roles: {
      title: s('Caveat', 700, 40, { lineHeight: 1.05 }),
      subtitle: s('Caveat', 400, 14),
      heading: s('Caveat', 700, 28, { lineHeight: 1.05 }),
      body: s('Caveat', 400, 14, { lineHeight: 1.3 }),
      caption: s('Caveat', 400, 12, { tone: 'muted' }),
      quote: s('Dancing Script', 400, 22, { lineHeight: 1.2 }),
      label: s('Amatic SC', 700, 12, { uppercase: true, letterSpacingEm: 0.08 }),
    },
  },
  {
    id: 'scrapbook',
    name: 'Scrapbook',
    description: 'Marker headlines and scribbled captions. Playful and loud.',
    roles: {
      title: s('Permanent Marker', 400, 34, { lineHeight: 1.1 }),
      subtitle: s('Caveat', 400, 15),
      heading: s('Permanent Marker', 400, 22, { lineHeight: 1.1 }),
      body: s('Caveat', 400, 14, { lineHeight: 1.3 }),
      caption: s('Caveat', 400, 12),
      quote: s('Caveat', 700, 22, { lineHeight: 1.2 }),
      label: s('Amatic SC', 700, 13, { uppercase: true, letterSpacingEm: 0.06 }),
    },
  },
];

export function typePack(id: string | undefined): TypePack {
  return TYPE_PACKS.find((p) => p.id === id) ?? TYPE_PACKS[0];
}

export const pageScale = (doc: Pick<BookDocument, 'settings'>) => Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm) / REFERENCE_MM;

/** A role's style, falling back to the Classic pack for roles a book doesn't define yet. */
export function roleStyle(style: BookStyle, role: TextRole): TextStyle {
  return style.textStyles?.[role] ?? typePack('classic').roles[role];
}

/** Role size on this page, in points (rounded to half points). */
export function roleSizePt(doc: Pick<BookDocument, 'settings' | 'style'>, role: TextRole): number {
  return Math.round(roleStyle(doc.style, role).sizePt * pageScale(doc) * 2) / 2;
}

/** Hex blend of two colours: t = 0 → a, 1 → b. */
export function mixColor(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    const full = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.padEnd(6, '0');
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  };
  const [ra, ga, ba] = p(a);
  const [rb, gb, bb] = p(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(ra + (rb - ra) * t)}${h(ga + (gb - ga) * t)}${h(ba + (bb - ba) * t)}`;
}

export function toneColor(style: BookStyle, tone: TextStyle['tone']): string {
  return tone === 'muted' ? mixColor(style.textColor, style.background, 0.42) : style.textColor;
}

/** Fields a text box takes from its role style (size passed in, since layouts may scale it). */
export function styleFields(style: BookStyle, role: TextRole, sizePt: number): Pick<TextElement, 'fontFamily' | 'fontWeight' | 'fontSizePt' | 'lineHeight' | 'letterSpacingEm' | 'uppercase' | 'color' | 'italic'> {
  const ts = roleStyle(style, role);
  return {
    fontFamily: ts.family,
    fontWeight: nearestWeight(ts.family, ts.weight),
    fontSizePt: sizePt,
    lineHeight: ts.lineHeight,
    letterSpacingEm: ts.letterSpacingEm,
    uppercase: ts.uppercase,
    color: toneColor(style, ts.tone),
    italic: false,
  };
}

const allSurfaces = (doc: BookDocument) => [...doc.spreads, ...(doc.cover ? [doc.cover] : [])];

/**
 * Restyle every linked text box after the role styles change. A box's size keeps its ratio to its
 * role size (so a poster title scaled up to fill its band stays proportionally large).
 */
export function restyleText(doc: BookDocument, nextStyle: BookStyle, roles?: Set<TextRole>): BookDocument {
  const scale = pageScale(doc);
  const mapEl = (el: Element): Element => {
    if (el.type !== 'text' || el.styleLinked === false || (roles && !roles.has(el.role))) return el;
    const oldSize = roleStyle(doc.style, el.role).sizePt * scale;
    const newSize = roleStyle(nextStyle, el.role).sizePt * scale;
    const ratio = oldSize > 0 ? Math.min(4, Math.max(0.25, el.fontSizePt / oldSize)) : 1;
    return { ...el, ...styleFields(nextStyle, el.role, Math.round(newSize * ratio * 2) / 2), styleLinked: true };
  };
  const mapSurface = <T extends { elements: Element[] }>(s: T): T => ({ ...s, elements: s.elements.map(mapEl) });
  return {
    ...doc,
    style: nextStyle,
    spreads: doc.spreads.map(mapSurface),
    ...(doc.cover ? { cover: mapSurface(doc.cover) } : {}),
  };
}

export function applyTypePack(doc: BookDocument, packId: string): BookDocument {
  const pack = typePack(packId);
  return restyleText(doc, { ...doc.style, typePackId: pack.id, textStyles: structuredClone(pack.roles) });
}

/** Edit one role's style; every text box following that role updates. */
export function setRoleStyle(doc: BookDocument, role: TextRole, patch: Partial<TextStyle>): BookDocument {
  const current = roleStyle(doc.style, role);
  const next: TextStyle = { ...current, ...patch };
  if (patch.family && patch.weight === undefined) next.weight = nearestWeight(patch.family, current.weight);
  return restyleText(doc, { ...doc.style, typePackId: 'custom', textStyles: { ...doc.style.textStyles, [role]: next } }, new Set([role]));
}

/** Re-apply colours after the book's text or paper colour changes (sizes untouched). */
export function recolorLinkedText(doc: BookDocument): BookDocument {
  const mapEl = (el: Element): Element =>
    el.type === 'text' && el.styleLinked !== false ? { ...el, color: toneColor(doc.style, roleStyle(doc.style, el.role).tone) } : el;
  return {
    ...doc,
    spreads: doc.spreads.map((s) => ({ ...s, elements: s.elements.map(mapEl) })),
    ...(doc.cover ? { cover: { ...doc.cover, elements: doc.cover.elements.map(mapEl) } } : {}),
  };
}

/** The style a text box would have if it followed its role exactly (for "is this custom?"). */
export function matchesRoleStyle(doc: Pick<BookDocument, 'style'>, el: TextElement): boolean {
  const f = styleFields(doc.style, el.role, el.fontSizePt);
  return f.fontFamily === el.fontFamily && f.fontWeight === el.fontWeight && f.uppercase === !!el.uppercase && !el.italic && Math.abs(f.letterSpacingEm - (el.letterSpacingEm ?? 0)) < 1e-6;
}

export function textElementsOf(doc: BookDocument): TextElement[] {
  return allSurfaces(doc).flatMap((s) => s.elements.filter((e): e is TextElement => e.type === 'text'));
}
