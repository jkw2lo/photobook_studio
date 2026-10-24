import type { BookDocument, TextRole, TextStyle } from './model';
import { SCHEMA_VERSION } from './model';
import { defaultSettings } from './book';
import { styleFromPreset } from './styles';

// Loading saved documents: migrate older schema versions forward, then validate the shape.
// Each migration takes version N and returns version N+1. There are none yet; v1 is the first format.

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: printer presets and covers. v1 books were laid out with generic sizes and bleed on
  // all sides, so they become 'custom' printer books; they get a cover when the user adds one.
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    settings: {
      ...(doc.settings as object),
      printerId: 'custom',
      bindingId: 'hardcover',
      bleedMode: 'all',
      coverOverrides: { spineMm: null, wrapMm: null, panelWidthMm: null, panelHeightMm: null },
    },
  }),
  // v2 → v3: three fonts (heading/body/caption) become per-role text styles. Sizes and line heights
  // reproduce v2's exactly, so nothing on the page moves; text that matched its role's font stays
  // linked to the style, anything hand-picked stays as it was.
  2: (doc) => {
    const st = (doc.style ?? {}) as Record<string, { family: string; weight: number } | undefined>;
    const font = (k: string, fallback: string) => st[k] ?? { family: fallback, weight: 400 };
    const heading = font('headingFont', 'Playfair Display');
    const body = font('bodyFont', 'Source Serif 4');
    const caption = font('captionFont', 'Inter');
    const v2size = (f: { family: string }, pt: number) => pt * (f.family === 'Caveat' ? 1.35 : 1);
    const mk = (f: { family: string; weight: number }, pt: number, lh: number, extra: Partial<TextStyle> = {}): TextStyle => ({
      family: f.family, weight: f.weight, sizePt: v2size(f, pt), lineHeight: lh, letterSpacingEm: 0, uppercase: false, tone: 'text', ...extra,
    });
    const textStyles: Record<TextRole, TextStyle> = {
      title: mk(heading, 30, 1.1),
      subtitle: mk(body, 11, 1.3),
      heading: mk(heading, 22, 1.1),
      body: mk(body, 10, 1.3),
      caption: mk(caption, 8.5, 1.3),
      quote: mk(body, 18, 1.25),
      label: mk(caption, 7.5, 1.3, { uppercase: true, letterSpacingEm: 0.15 }),
    };
    const fixText = (e: Record<string, unknown>) => {
      if (e.type !== 'text') return e;
      const ts = textStyles[(e.role as TextRole) ?? 'body'] ?? textStyles.body;
      return { ...e, letterSpacingEm: 0, uppercase: false, styleLinked: e.fontFamily === ts.family && e.fontWeight === ts.weight };
    };
    const fixSurface = (s: Record<string, unknown>) => ({ ...s, elements: ((s.elements as Record<string, unknown>[]) ?? []).map(fixText) });
    const { headingFont: _h, bodyFont: _b, captionFont: _c, ...restStyle } = doc.style as Record<string, unknown>;
    return {
      ...doc,
      schemaVersion: 3,
      style: { ...restStyle, typePackId: 'custom', textStyles },
      spreads: ((doc.spreads as Record<string, unknown>[]) ?? []).map(fixSurface),
      ...(doc.cover ? { cover: fixSurface(doc.cover as Record<string, unknown>) } : {}),
    };
  },
};

export class SchemaError extends Error {}

export function migrateDocument(raw: unknown): BookDocument {
  if (!raw || typeof raw !== 'object') throw new SchemaError('Project document is not an object');
  let doc = raw as Record<string, unknown>;
  let v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new SchemaError(`Project was saved by a newer version (schema ${v}); this app reads up to ${SCHEMA_VERSION}.`);
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new SchemaError(`No migration from schema ${v}`);
    doc = m(doc);
    v++;
  }
  return validateDocument(doc);
}

export function validateDocument(doc: Record<string, unknown>): BookDocument {
  const fail = (msg: string): never => {
    throw new SchemaError(`Invalid project document: ${msg}`);
  };
  if (typeof doc.id !== 'string') fail('missing id');
  const isPoster = (doc.settings as { product?: string } | undefined)?.product === 'poster';
  if (!Array.isArray(doc.spreads) || doc.spreads.length < (isPoster ? 1 : 2)) fail(isPoster ? 'a poster needs its sheet' : 'a book needs at least two spreads');
  const settings = { ...defaultSettings(), ...(doc.settings as object) };
  const style = { ...styleFromPreset(((doc.style as { presetId?: string }) ?? {}).presetId ?? 'editorial'), ...(doc.style as object) };
  const ids = new Set<string>();
  const surfaces = [...(doc.spreads as Record<string, unknown>[]), ...(doc.cover ? [doc.cover as Record<string, unknown>] : [])];
  if (doc.cover && typeof (doc.cover as { spineMm?: unknown }).spineMm !== 'number') fail('cover is missing spineMm');
  for (const s of surfaces) {
    if (typeof s.id !== 'string') fail('spread without id');
    if (!Array.isArray(s.elements)) fail(`spread ${s.id} has no elements array`);
    for (const e of s.elements as Record<string, unknown>[]) {
      if (typeof e.id !== 'string' || ids.has(e.id)) fail('element ids must be unique strings');
      ids.add(e.id as string);
      if (e.type !== 'image' && e.type !== 'text' && e.type !== 'shape') fail(`unknown element type ${String(e.type)}`);
      for (const k of ['xMm', 'yMm', 'widthMm', 'heightMm', 'rotationDeg']) {
        if (typeof e[k] !== 'number' || !Number.isFinite(e[k])) fail(`element ${e.id} has invalid ${k}`);
      }
      if ((e.widthMm as number) <= 0 || (e.heightMm as number) <= 0) fail(`element ${e.id} has non-positive size`);
    }
  }
  return {
    ...(doc as unknown as BookDocument),
    schemaVersion: SCHEMA_VERSION,
    title: typeof doc.title === 'string' ? doc.title : 'Untitled book',
    subtitle: typeof doc.subtitle === 'string' ? doc.subtitle : '',
    settings,
    style,
    chapters: Array.isArray(doc.chapters) ? (doc.chapters as BookDocument['chapters']) : [],
  };
}
