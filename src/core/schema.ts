import type { BookDocument } from './model';
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
  if (!Array.isArray(doc.spreads) || doc.spreads.length < 2) fail('a book needs at least two spreads');
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
