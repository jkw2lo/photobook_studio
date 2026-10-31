import { migrateDocument, type BookDocument, type PhotoAnalysis, type PhotoAsset } from '../../../core';
import type { ProjectSummary } from '../types';

// The web version's catalogue and project store, in IndexedDB. Mirrors src/server/db.ts (the
// SQLite store) table for table, so the in-browser backend can follow the server's logic closely.
// Every multi-record write is one transaction: an interrupted save leaves the previous state.

const DB_VERSION = 1;
const REVISIONS_KEPT = 50;

/** Where a photo's original lives: inside a folder the user granted, or copied into this browser. */
export type AssetSource = { kind: 'dir'; dirId: string; path: string } | { kind: 'copy' };

export interface AssetRecord {
  id: string;
  source: AssetSource;
  /** `dir:<dirId>/<path>` or `copy:<id>`: unique, like the server's original_path. */
  sourceKey: string;
  fileName: string;
  format: string;
  fileSize: number;
  mtimeMs: number;
  contentHash: string;
  width: number;
  height: number;
  capturedAt: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  rating: number;
  favorite: boolean;
  tags: string[];
  analysis: PhotoAnalysis | null;
  exactDuplicateOf: string | null;
  importedAt: string;
}

export type ProjectAssetRow = AssetRecord & { excluded: boolean };

interface ProjectRecord {
  id: string;
  title: string;
  doc: string;
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface RevisionRecord {
  projectId: string;
  revision: number;
  doc: string;
  savedAt: string;
}

interface ProjectAssetRecord {
  projectId: string;
  assetId: string;
  excluded: boolean;
  addedAt: string;
}

export interface DirRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: string;
}

export interface LinkRecord {
  projectId: string;
  /** A folder reference (see folders.ts): `dir:<dirId>` or `dir:<dirId>/<sub/path>`. */
  folder: string;
  addedAt: string;
  syncedAt: string | null;
}

export const sourceKey = (id: string, source: AssetSource) => (source.kind === 'dir' ? `dir:${source.dirId}/${source.path}` : `copy:${id}`);

const STORES = ['projects', 'revisions', 'assets', 'projectAssets', 'thumbs', 'originals', 'dirs', 'links', 'settings'] as const;
type StoreName = (typeof STORES)[number];

export function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export function openDatabase(name = 'photobook-studio'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      // v1
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('revisions', { keyPath: ['projectId', 'revision'] }).createIndex('projectId', 'projectId');
      const assets = db.createObjectStore('assets', { keyPath: 'id' });
      assets.createIndex('sourceKey', 'sourceKey', { unique: true });
      assets.createIndex('contentHash', 'contentHash');
      const pa = db.createObjectStore('projectAssets', { keyPath: ['projectId', 'assetId'] });
      pa.createIndex('projectId', 'projectId');
      pa.createIndex('assetId', 'assetId');
      db.createObjectStore('thumbs');
      db.createObjectStore('originals');
      db.createObjectStore('dirs', { keyPath: 'id' });
      db.createObjectStore('links', { keyPath: ['projectId', 'folder'] }).createIndex('projectId', 'projectId');
      db.createObjectStore('settings');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Photobook Studio is open in another tab with an older version. Close the other tabs and reload.'));
  });
}

const byCaptureThenName = (a: ProjectAssetRow, b: ProjectAssetRow) => {
  // SQLite's ORDER BY captured_at, file_name: undated photos first.
  if (a.capturedAt !== b.capturedAt) {
    if (a.capturedAt === null) return -1;
    if (b.capturedAt === null) return 1;
    return a.capturedAt < b.capturedAt ? -1 : 1;
  }
  return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
};

export class BrowserStore {
  constructor(readonly db: IDBDatabase) {}

  static async open(name?: string) {
    return new BrowserStore(await openDatabase(name));
  }

  close() {
    this.db.close();
  }

  /** Run `fn` in one transaction over `stores`; resolves after it commits. */
  async tx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T>): Promise<T> {
    const t = this.db.transaction(stores, mode);
    const committed = done(t);
    let out: T;
    try {
      out = await fn(t);
    } catch (e) {
      try {
        t.abort();
      } catch {
        // already finished
      }
      committed.catch(() => undefined);
      throw e;
    }
    await committed;
    return out;
  }

  private get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.tx([store], 'readonly', (t) => request(t.objectStore(store).get(key)));
  }

  // ---- settings ---------------------------------------------------------------------------

  getSetting<T = string>(key: string): Promise<T | undefined> {
    return this.get<T>('settings', key);
  }

  setSetting(key: string, value: unknown) {
    return this.tx(['settings'], 'readwrite', (t) => request(t.objectStore('settings').put(value, key)));
  }

  // ---- projects ---------------------------------------------------------------------------

  async listProjects(): Promise<ProjectSummary[]> {
    return this.tx(['projects', 'projectAssets'], 'readonly', async (t) => {
      const rows = ((await request(t.objectStore('projects').getAll())) as ProjectRecord[]).filter((p) => !p.deletedAt);
      const idx = t.objectStore('projectAssets').index('projectId');
      const counts = await Promise.all(rows.map((r) => request(idx.count(r.id))));
      return rows
        .map((r, i) => {
          const doc = JSON.parse(r.doc);
          return {
            id: r.id,
            title: r.title,
            revision: r.revision,
            updatedAt: r.updatedAt,
            createdAt: r.createdAt,
            photoCount: counts[i],
            pageCount: (doc.spreads.length - 1) * 2,
            product: doc.settings?.product === 'poster' ? 'poster' : 'book',
            trimWidthMm: doc.settings?.trimWidthMm ?? 0,
            trimHeightMm: doc.settings?.trimHeightMm ?? 0,
          } satisfies ProjectSummary;
        })
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    });
  }

  async createProject(doc: BookDocument, opts: { revision?: number; createdAt?: string } = {}): Promise<{ revision: number }> {
    const now = new Date().toISOString();
    const json = JSON.stringify(doc);
    const revision = opts.revision ?? 1;
    await this.tx(['projects', 'revisions'], 'readwrite', async (t) => {
      const rec: ProjectRecord = { id: doc.id, title: doc.title, doc: json, schemaVersion: doc.schemaVersion, revision, createdAt: opts.createdAt ?? now, updatedAt: now, deletedAt: null };
      await request(t.objectStore('projects').add(rec));
      await request(t.objectStore('revisions').put({ projectId: doc.id, revision, doc: json, savedAt: now } satisfies RevisionRecord));
    });
    return { revision };
  }

  async listDeleted(): Promise<{ id: string; title: string; deletedAt: string; product: 'book' | 'poster' }[]> {
    const rows = ((await this.tx(['projects'], 'readonly', (t) => request(t.objectStore('projects').getAll()))) as ProjectRecord[]).filter((p) => p.deletedAt);
    return rows
      .sort((a, b) => (a.deletedAt! < b.deletedAt! ? 1 : -1))
      .map((r) => ({ id: r.id, title: r.title, deletedAt: r.deletedAt!, product: JSON.parse(r.doc).settings?.product === 'poster' ? 'poster' : 'book' }));
  }

  private setDeleted(id: string, deleted: boolean): Promise<boolean> {
    return this.tx(['projects'], 'readwrite', async (t) => {
      const s = t.objectStore('projects');
      const p = (await request(s.get(id))) as ProjectRecord | undefined;
      if (!p || !!p.deletedAt === deleted) return false;
      await request(s.put({ ...p, deletedAt: deleted ? new Date().toISOString() : null }));
      return true;
    });
  }

  trashProject(id: string) {
    return this.setDeleted(id, true);
  }

  restoreProject(id: string) {
    return this.setDeleted(id, false);
  }

  /**
   * Delete a project for good: pages, history, links. Photos no other project uses leave the
   * catalogue too, with their thumbnails and copied originals. Files in your folders are never touched.
   */
  async purgeProject(id: string): Promise<{ removedPhotos: number; removedIds: string[] }> {
    return this.tx(['projects', 'revisions', 'projectAssets', 'links', 'assets', 'thumbs', 'originals'], 'readwrite', async (t) => {
      const keyRange = IDBKeyRange.only(id);
      const revKeys = await request(t.objectStore('revisions').index('projectId').getAllKeys(keyRange));
      for (const k of revKeys) await request(t.objectStore('revisions').delete(k));
      const linkKeys = await request(t.objectStore('links').index('projectId').getAllKeys(keyRange));
      for (const k of linkKeys) await request(t.objectStore('links').delete(k));
      const pa = t.objectStore('projectAssets');
      const mine = (await request(pa.index('projectId').getAll(keyRange))) as ProjectAssetRecord[];
      for (const r of mine) await request(pa.delete([r.projectId, r.assetId]));
      await request(t.objectStore('projects').delete(id));
      const removedIds: string[] = [];
      for (const r of mine) {
        if ((await request(pa.index('assetId').count(r.assetId))) > 0) continue;
        await request(t.objectStore('assets').delete(r.assetId));
        for (const size of ['s', 'm']) await request(t.objectStore('thumbs').delete(`${r.assetId}_${size}`));
        await request(t.objectStore('originals').delete(r.assetId));
        removedIds.push(r.assetId);
      }
      return { removedPhotos: removedIds.length, removedIds };
    });
  }

  /** Purge projects that have been in Recently deleted for more than `days` days. */
  async purgeOldDeleted(days = 30): Promise<number> {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const old = (await this.listDeleted()).filter((p) => p.deletedAt < cutoff);
    for (const p of old) await this.purgeProject(p.id);
    return old.length;
  }

  async getProject(id: string): Promise<{ doc: BookDocument; revision: number; updatedAt: string; createdAt: string } | null> {
    const p = await this.get<ProjectRecord>('projects', id);
    if (!p || p.deletedAt) return null;
    return { doc: migrateDocument(JSON.parse(p.doc)), revision: p.revision, updatedAt: p.updatedAt, createdAt: p.createdAt };
  }

  /**
   * Save with optimistic concurrency: the caller states which revision it edited. A mismatch
   * means another tab saved in between; nothing is overwritten.
   */
  async saveProject(doc: BookDocument, baseRevision: number): Promise<{ ok: true; revision: number } | { ok: false; currentRevision: number }> {
    const validated = migrateDocument(doc);
    const json = JSON.stringify(validated);
    return this.tx(['projects', 'revisions'], 'readwrite', async (t) => {
      const s = t.objectStore('projects');
      const p = (await request(s.get(doc.id))) as ProjectRecord | undefined;
      if (!p) throw new Error('Project not found');
      if (p.revision !== baseRevision) return { ok: false as const, currentRevision: p.revision };
      const revision = p.revision + 1;
      const now = new Date().toISOString();
      await request(s.put({ ...p, doc: json, title: validated.title, schemaVersion: validated.schemaVersion, revision, updatedAt: now }));
      const revs = t.objectStore('revisions');
      await request(revs.put({ projectId: doc.id, revision, doc: json, savedAt: now } satisfies RevisionRecord));
      await request(revs.delete(IDBKeyRange.bound([doc.id, -Infinity], [doc.id, revision - REVISIONS_KEPT])));
      return { ok: true as const, revision };
    });
  }

  async listRevisions(projectId: string): Promise<{ revision: number; savedAt: string; bytes: number }[]> {
    const rows = (await this.tx(['revisions'], 'readonly', (t) => request(t.objectStore('revisions').index('projectId').getAll(IDBKeyRange.only(projectId))))) as RevisionRecord[];
    return rows.map((r) => ({ revision: r.revision, savedAt: r.savedAt, bytes: r.doc.length })).sort((a, b) => b.revision - a.revision);
  }

  async getRevision(projectId: string, revision: number): Promise<BookDocument | null> {
    const r = await this.get<RevisionRecord>('revisions', [projectId, revision]);
    return r ? migrateDocument(JSON.parse(r.doc)) : null;
  }

  // ---- assets -----------------------------------------------------------------------------

  assetById(id: string) {
    return this.get<AssetRecord>('assets', id);
  }

  assetBySourceKey(key: string): Promise<AssetRecord | undefined> {
    return this.tx(['assets'], 'readonly', (t) => request(t.objectStore('assets').index('sourceKey').get(key)));
  }

  async firstAssetWithHash(hash: string, notId?: string): Promise<AssetRecord | undefined> {
    const rows = (await this.tx(['assets'], 'readonly', (t) => request(t.objectStore('assets').index('contentHash').getAll(IDBKeyRange.only(hash))))) as AssetRecord[];
    return rows.filter((r) => r.id !== notId).sort((a, b) => (a.importedAt < b.importedAt ? -1 : 1))[0];
  }

  /** Add or update a photo and add it to the project, in one transaction. */
  saveImported(projectId: string, rec: AssetRecord, files: { thumbs: Record<'s' | 'm', Blob>; original?: Blob }) {
    return this.tx(['assets', 'projectAssets', 'thumbs', 'originals'], 'readwrite', async (t) => {
      await request(t.objectStore('assets').put(rec));
      await request(t.objectStore('thumbs').put(files.thumbs.s, `${rec.id}_s`));
      await request(t.objectStore('thumbs').put(files.thumbs.m, `${rec.id}_m`));
      if (files.original) await request(t.objectStore('originals').put(files.original, rec.id));
      await this.linkIn(t, projectId, rec.id);
    });
  }

  private async linkIn(t: IDBTransaction, projectId: string, assetId: string) {
    const pa = t.objectStore('projectAssets');
    if (!(await request(pa.get([projectId, assetId])))) await request(pa.put({ projectId, assetId, excluded: false, addedAt: new Date().toISOString() } satisfies ProjectAssetRecord));
  }

  linkAsset(projectId: string, assetId: string) {
    return this.tx(['projectAssets'], 'readwrite', (t) => this.linkIn(t, projectId, assetId));
  }

  unlinkAsset(projectId: string, assetId: string) {
    return this.tx(['projectAssets'], 'readwrite', (t) => request(t.objectStore('projectAssets').delete([projectId, assetId])));
  }

  async projectAssetRows(projectId: string): Promise<ProjectAssetRow[]> {
    const rows = await this.tx(['assets', 'projectAssets'], 'readonly', async (t) => {
      const links = (await request(t.objectStore('projectAssets').index('projectId').getAll(IDBKeyRange.only(projectId)))) as ProjectAssetRecord[];
      const assets = t.objectStore('assets');
      const out: ProjectAssetRow[] = [];
      for (const l of links) {
        const a = (await request(assets.get(l.assetId))) as AssetRecord | undefined;
        if (a) out.push({ ...a, excluded: l.excluded });
      }
      return out;
    });
    return rows.sort(byCaptureThenName);
  }

  private updateAsset(id: string, fn: (a: AssetRecord) => AssetRecord) {
    return this.tx(['assets'], 'readwrite', async (t) => {
      const s = t.objectStore('assets');
      const a = (await request(s.get(id))) as AssetRecord | undefined;
      if (a) await request(s.put(fn(a)));
    });
  }

  updateAssetUserFields(id: string, patch: { rating?: number; favorite?: boolean; tags?: string[] }) {
    return this.updateAsset(id, (a) => ({
      ...a,
      ...(patch.rating !== undefined ? { rating: Math.max(0, Math.min(5, Math.round(patch.rating))) } : {}),
      ...(patch.favorite !== undefined ? { favorite: !!patch.favorite } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    }));
  }

  updateAnalysis(id: string, analysis: PhotoAnalysis) {
    return this.updateAsset(id, (a) => ({ ...a, analysis }));
  }

  relocateAsset(id: string, source: AssetSource, fileName: string) {
    return this.updateAsset(id, (a) => ({ ...a, source, sourceKey: sourceKey(id, source), fileName }));
  }

  setExcluded(projectId: string, assetId: string, excluded: boolean) {
    return this.tx(['projectAssets'], 'readwrite', async (t) => {
      const s = t.objectStore('projectAssets');
      const r = (await request(s.get([projectId, assetId]))) as ProjectAssetRecord | undefined;
      if (r) await request(s.put({ ...r, excluded }));
    });
  }

  async projectAssetsWithHash(projectId: string, hash: string): Promise<AssetRecord[]> {
    return (await this.projectAssetRows(projectId)).filter((a) => a.contentHash === hash);
  }

  // ---- binary files -----------------------------------------------------------------------

  getThumb(assetId: string, size: 's' | 'm') {
    return this.get<Blob>('thumbs', `${assetId}_${size}`);
  }

  getOriginal(assetId: string) {
    return this.get<Blob>('originals', assetId);
  }

  async hasOriginal(assetId: string): Promise<boolean> {
    return (await this.tx(['originals'], 'readonly', (t) => request(t.objectStore('originals').count(assetId)))) > 0;
  }

  /** Copy a photo into browser storage (relink from a folder this browser can't keep access to). */
  putOriginal(assetId: string, blob: Blob) {
    return this.tx(['originals'], 'readwrite', (t) => request(t.objectStore('originals').put(blob, assetId)));
  }

  // ---- folders ----------------------------------------------------------------------------

  async listDirs(): Promise<DirRecord[]> {
    return (await this.tx(['dirs'], 'readonly', (t) => request(t.objectStore('dirs').getAll()))) as DirRecord[];
  }

  getDir(id: string) {
    return this.get<DirRecord>('dirs', id);
  }

  putDir(rec: DirRecord) {
    return this.tx(['dirs'], 'readwrite', (t) => request(t.objectStore('dirs').put(rec)));
  }

  async listLinks(projectId: string): Promise<LinkRecord[]> {
    const rows = (await this.tx(['links'], 'readonly', (t) => request(t.objectStore('links').index('projectId').getAll(IDBKeyRange.only(projectId))))) as LinkRecord[];
    return rows.sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
  }

  addLink(projectId: string, folder: string) {
    return this.tx(['links'], 'readwrite', async (t) => {
      const s = t.objectStore('links');
      if (!(await request(s.get([projectId, folder])))) await request(s.put({ projectId, folder, addedAt: new Date().toISOString(), syncedAt: null } satisfies LinkRecord));
    });
  }

  removeLink(projectId: string, folder: string): Promise<boolean> {
    return this.tx(['links'], 'readwrite', async (t) => {
      const s = t.objectStore('links');
      if (!(await request(s.get([projectId, folder])))) return false;
      await request(s.delete([projectId, folder]));
      return true;
    });
  }

  markLinkSynced(projectId: string, folder: string) {
    return this.tx(['links'], 'readwrite', async (t) => {
      const s = t.objectStore('links');
      const r = (await request(s.get([projectId, folder]))) as LinkRecord | undefined;
      if (r) await request(s.put({ ...r, syncedAt: new Date().toISOString() }));
    });
  }
}

export function toPhotoAsset(r: ProjectAssetRow, missing: boolean): PhotoAsset {
  return {
    id: r.id,
    fileName: r.fileName,
    format: r.format,
    fileSizeBytes: r.fileSize,
    widthPx: r.width,
    heightPx: r.height,
    capturedAt: r.capturedAt,
    gpsLat: r.gpsLat,
    gpsLon: r.gpsLon,
    rating: r.rating,
    favorite: r.favorite,
    tags: r.tags,
    contentHash: r.contentHash,
    exactDuplicateOf: r.exactDuplicateOf,
    analysis: r.analysis,
    excluded: r.excluded,
    missing,
  };
}
