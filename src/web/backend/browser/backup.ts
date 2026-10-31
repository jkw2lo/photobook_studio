import { migrateDocument, type BookDocument } from '../../../core';
import { sourceKey, type AssetRecord, type BrowserStore, type ProjectAssetRow } from './db';

// One-file project backups for the web version (browsers can clear site data, and nothing here
// lives on a server). The file is a short text line, a JSON header, then the photos and thumbnails
// back to back:
//
//   photobook-backup 1 <header bytes>\n<header JSON><blob><blob>…
//
// Built as a Blob from parts, so even a book with gigabytes of photos never sits in memory twice.

const MAGIC = 'photobook-backup';
const VERSION = 1;

type Part = [offset: number, length: number, type: string];

interface BackupHeader {
  app: 'Photobook Studio';
  version: number;
  exportedAt: string;
  project: { doc: BookDocument; createdAt: string };
  assets: { record: Omit<AssetRecord, 'source' | 'sourceKey'>; excluded: boolean; thumbS?: Part; thumbM?: Part; original?: Part }[];
}

export interface BackupResult {
  blob: Blob;
  file: string;
  photos: number;
  /** Photos whose original couldn't be read (folder not accessible): only their thumbnails are in the backup. */
  withoutOriginal: number;
}

/** `original(row)` reads a photo's original, or null when it can't be read now. */
export async function backupProject(store: BrowserStore, projectId: string, original: (row: ProjectAssetRow) => Promise<Blob | null>): Promise<BackupResult> {
  const p = await store.getProject(projectId);
  if (!p) throw new Error('Project not found');
  const parts: Blob[] = [];
  let offset = 0;
  const add = (b: Blob | null | undefined): Part | undefined => {
    if (!b) return undefined;
    parts.push(b);
    const part: Part = [offset, b.size, b.type];
    offset += b.size;
    return part;
  };
  const header: BackupHeader = { app: 'Photobook Studio', version: VERSION, exportedAt: new Date().toISOString(), project: { doc: p.doc, createdAt: p.createdAt }, assets: [] };
  let withoutOriginal = 0;
  for (const row of await store.projectAssetRows(projectId)) {
    const { source: _s, sourceKey: _k, excluded, ...record } = row;
    const orig = await original(row);
    if (!orig) withoutOriginal++;
    header.assets.push({ record, excluded, thumbS: add(await store.getThumb(row.id, 's')), thumbM: add(await store.getThumb(row.id, 'm')), original: add(orig) });
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const first = new TextEncoder().encode(`${MAGIC} ${VERSION} ${json.byteLength}\n`);
  const safeTitle = p.doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'photobook';
  return {
    blob: new Blob([first, json, ...parts], { type: 'application/octet-stream' }),
    file: `${safeTitle}-${new Date().toISOString().slice(0, 10)}.photobook`,
    photos: header.assets.length,
    withoutOriginal,
  };
}

async function readHeader(file: Blob): Promise<{ header: BackupHeader; dataStart: number }> {
  const head = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer());
  const m = head.match(/^photobook-backup (\d+) (\d+)\n/);
  if (!m) throw new Error('This isn’t a Photobook Studio backup file.');
  if (Number(m[1]) > VERSION) throw new Error('This backup was made by a newer version of Photobook Studio.');
  const start = new TextEncoder().encode(m[0]).byteLength;
  const len = Number(m[2]);
  const header = JSON.parse(new TextDecoder().decode(await file.slice(start, start + len).arrayBuffer())) as BackupHeader;
  return { header, dataStart: start + len };
}

/**
 * Restore a backup as a project. Photos already in this browser's library are reused; the others
 * come back as copies kept in browser storage. If the project is still here, the backup comes
 * back as a separate copy.
 */
export async function restoreProject(store: BrowserStore, file: Blob): Promise<{ projectId: string; title: string; photos: number }> {
  const { header, dataStart } = await readHeader(file);
  const part = (p?: Part) => (p ? file.slice(dataStart + p[0], dataStart + p[0] + p[1], p[2]) : undefined);
  let doc = migrateDocument(header.project.doc);
  const clash = (await store.getProject(doc.id)) || (await store.listDeleted()).some((d) => d.id === doc.id);
  if (clash) doc = { ...doc, id: crypto.randomUUID(), title: `${doc.title} (restored)` };
  await store.createProject(doc, { createdAt: header.project.createdAt });
  for (const a of header.assets) {
    const existing = await store.assetById(a.record.id);
    if (existing) {
      await store.linkAsset(doc.id, existing.id);
    } else {
      const rec: AssetRecord = { ...a.record, source: { kind: 'copy' }, sourceKey: sourceKey(a.record.id, { kind: 'copy' }) };
      const s = part(a.thumbS);
      const m = part(a.thumbM);
      // Slices of the picked file are copied into IndexedDB as they are stored.
      await store.saveImported(doc.id, rec, { thumbs: { s: s ?? m ?? new Blob(), m: m ?? s ?? new Blob() }, original: part(a.original) });
    }
    if (a.excluded) await store.setExcluded(doc.id, a.record.id, true);
  }
  return { projectId: doc.id, title: doc.title, photos: header.assets.length };
}
