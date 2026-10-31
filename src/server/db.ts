import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BookDocument, PhotoAnalysis, PhotoAsset } from '../core';
import { migrateDocument } from '../core';

// SQLite catalog + project store. All writes are synchronous transactions, so a crash
// mid-save leaves the previous committed state intact (WAL journaling).

const DB_SCHEMA_VERSION = 4;

export interface AssetRow {
  id: string;
  original_path: string;
  file_name: string;
  format: string;
  file_size: number;
  mtime_ms: number;
  content_hash: string;
  width: number;
  height: number;
  captured_at: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  rating: number;
  favorite: number;
  tags: string;
  analysis: string | null;
  derived_path: string | null;
  exact_duplicate_of: string | null;
  imported_at: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
  photoCount: number;
  pageCount: number;
  product: 'book' | 'poster';
  trimWidthMm: number;
  trimHeightMm: number;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    for (const d of ['thumbs', 'derived', 'exports']) mkdirSync(join(dataDir, d), { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'photobook.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    const current = row ? Number(row.value) : 0;
    if (current > DB_SCHEMA_VERSION) throw new Error(`Database schema ${current} is newer than this app (${DB_SCHEMA_VERSION}).`);
    if (current < 1) {
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE assets (
            id TEXT PRIMARY KEY,
            original_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            format TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            width INTEGER NOT NULL CHECK (width > 0),
            height INTEGER NOT NULL CHECK (height > 0),
            captured_at TEXT,
            gps_lat REAL,
            gps_lon REAL,
            rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
            favorite INTEGER NOT NULL DEFAULT 0,
            tags TEXT NOT NULL DEFAULT '[]',
            analysis TEXT,
            derived_path TEXT,
            exact_duplicate_of TEXT REFERENCES assets(id) ON DELETE SET NULL,
            imported_at TEXT NOT NULL
          );
          CREATE UNIQUE INDEX assets_path ON assets(original_path);
          CREATE INDEX assets_hash ON assets(content_hash);
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            doc TEXT NOT NULL,
            schema_version INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE project_assets (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
            excluded INTEGER NOT NULL DEFAULT 0,
            added_at TEXT NOT NULL,
            PRIMARY KEY (project_id, asset_id)
          );
          CREATE TABLE project_revisions (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL,
            doc TEXT NOT NULL,
            saved_at TEXT NOT NULL,
            PRIMARY KEY (project_id, revision)
          );
        `);
        this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1')`).run();
      });
    }
    if (current < 2) {
      // v2: "Recently deleted" — a deleted project is kept (hidden) until restored or purged.
      this.tx(() => {
        this.db.exec(`ALTER TABLE projects ADD COLUMN deleted_at TEXT`);
        this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')`).run();
      });
    }
    if (current < 3) {
      // v3: linked folders — a project keeps these in sync (new photos added, deleted ones dropped).
      this.tx(() => {
        this.db.exec(`
          CREATE TABLE project_links (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            folder TEXT NOT NULL,
            added_at TEXT NOT NULL,
            synced_at TEXT,
            PRIMARY KEY (project_id, folder)
          );
        `);
        this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')`).run();
      });
    }
    if (current < 4) {
      // v4: folders imported once are remembered too (auto = 0: refreshed only when asked), and
      // photos taken out of a library are remembered so refreshing their folder doesn't bring them back.
      this.tx(() => {
        this.db.exec(`
          ALTER TABLE project_links ADD COLUMN auto INTEGER NOT NULL DEFAULT 1;
          CREATE TABLE project_dismissed (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            original_path TEXT NOT NULL,
            dismissed_at TEXT NOT NULL,
            PRIMARY KEY (project_id, original_path)
          );
        `);
        this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '4')`).run();
      });
    }
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(`setting:${key}`) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(`setting:${key}`, value);
  }

  // ---- projects --------------------------------------------------------------------------

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.title, p.revision, p.updated_at, p.created_at, p.doc,
                (SELECT COUNT(*) FROM project_assets pa WHERE pa.project_id = p.id) AS photo_count
         FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
      )
      .all() as { id: string; title: string; revision: number; updated_at: string; created_at: string; doc: string; photo_count: number }[];
    return rows.map((r) => {
      const doc = JSON.parse(r.doc);
      return {
        id: r.id,
        title: r.title,
        revision: r.revision,
        updatedAt: r.updated_at,
        createdAt: r.created_at,
        photoCount: r.photo_count,
        pageCount: (doc.spreads.length - 1) * 2,
        product: doc.settings?.product === 'poster' ? 'poster' : 'book',
        trimWidthMm: doc.settings?.trimWidthMm ?? 0,
        trimHeightMm: doc.settings?.trimHeightMm ?? 0,
      };
    });
  }

  createProject(doc: BookDocument): { revision: number } {
    const now = new Date().toISOString();
    this.tx(() => {
      this.db
        .prepare(`INSERT INTO projects (id, title, doc, schema_version, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .run(doc.id, doc.title, JSON.stringify(doc), doc.schemaVersion, now, now);
      this.db.prepare(`INSERT INTO project_revisions (project_id, revision, doc, saved_at) VALUES (?, 1, ?, ?)`).run(doc.id, JSON.stringify(doc), now);
    });
    return { revision: 1 };
  }

  /** Projects in "Recently deleted", newest first. */
  listDeleted(): { id: string; title: string; deletedAt: string; product: 'book' | 'poster' }[] {
    const rows = this.db.prepare(`SELECT id, title, deleted_at, doc FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as { id: string; title: string; deleted_at: string; doc: string }[];
    return rows.map((r) => ({ id: r.id, title: r.title, deletedAt: r.deleted_at, product: JSON.parse(r.doc).settings?.product === 'poster' ? 'poster' : 'book' }));
  }

  /** Move to Recently deleted (nothing is removed yet). */
  trashProject(id: string): boolean {
    return Number(this.db.prepare(`UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(new Date().toISOString(), id).changes) > 0;
  }

  restoreProject(id: string): boolean {
    return Number(this.db.prepare(`UPDATE projects SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(id).changes) > 0;
  }

  /**
   * Delete a project for good: its pages, history and photo links. Photos no other project uses
   * leave the catalogue too, with their thumbnails and converted copies. Original files are never
   * touched.
   */
  purgeProject(id: string): { removedPhotos: number } {
    return this.tx(() => {
      this.db.prepare(`DELETE FROM project_revisions WHERE project_id = ?`).run(id);
      this.db.prepare(`DELETE FROM project_assets WHERE project_id = ?`).run(id);
      this.db.prepare(`DELETE FROM project_links WHERE project_id = ?`).run(id);
      this.db.prepare(`DELETE FROM project_dismissed WHERE project_id = ?`).run(id);
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
      return { removedPhotos: this.removeOrphans() };
    });
  }

  /** Photos no project uses any more leave the catalogue, with their thumbnails and converted copies. */
  private removeOrphans(): number {
    const orphans = this.db.prepare(`SELECT id, derived_path FROM assets WHERE id NOT IN (SELECT asset_id FROM project_assets)`).all() as { id: string; derived_path: string | null }[];
    for (const o of orphans) {
      this.db.prepare(`DELETE FROM assets WHERE id = ?`).run(o.id);
      for (const f of ['s.jpg', 'm.jpg', 's.webp', 'm.webp']) rmSync(join(this.dataDir, 'thumbs', `${o.id}_${f}`), { force: true });
      if (o.derived_path && o.derived_path.startsWith(join(this.dataDir, 'derived'))) rmSync(o.derived_path, { force: true });
    }
    return orphans.length;
  }

  /**
   * Take photos out of a project's library (original files are never touched). Refreshing their
   * folder won't bring them back; importing the folder again will.
   */
  removeFromProject(projectId: string, assetIds: string[]): number {
    return this.tx(() => {
      let removed = 0;
      const now = new Date().toISOString();
      for (const id of assetIds) {
        const row = this.assetById(id);
        if (!row) continue;
        if (Number(this.db.prepare(`DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?`).run(projectId, id).changes) === 0) continue;
        this.db.prepare(`INSERT OR REPLACE INTO project_dismissed (project_id, original_path, dismissed_at) VALUES (?, ?, ?)`).run(projectId, row.original_path, now);
        removed++;
      }
      this.removeOrphans();
      return removed;
    });
  }

  /** Exact copies an import added twice: out of the project (not remembered as removed). */
  dropCopies(projectId: string, assetIds: string[]) {
    this.tx(() => {
      for (const id of assetIds) this.db.prepare(`DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?`).run(projectId, id);
      this.removeOrphans();
    });
  }

  isDismissed(projectId: string, path: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM project_dismissed WHERE project_id = ? AND original_path = ?`).get(projectId, path);
  }

  /** Importing a folder on purpose brings back photos taken out of the library from it. */
  undismissFolder(projectId: string, folder: string) {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    this.db.prepare(`DELETE FROM project_dismissed WHERE project_id = ? AND (original_path = ? OR substr(original_path, 1, ?) = ?)`).run(projectId, folder, prefix.length, prefix);
  }

  /** Purge projects that have been in Recently deleted for more than `days` days. */
  purgeOldDeleted(days = 30): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const ids = (this.db.prepare(`SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?`).all(cutoff) as { id: string }[]).map((r) => r.id);
    for (const id of ids) this.purgeProject(id);
    return ids.length;
  }

  getProject(id: string): { doc: BookDocument; revision: number; updatedAt: string } | null {
    const row = this.db.prepare(`SELECT doc, revision, updated_at FROM projects WHERE id = ? AND deleted_at IS NULL`).get(id) as
      | { doc: string; revision: number; updated_at: string }
      | undefined;
    if (!row) return null;
    return { doc: migrateDocument(JSON.parse(row.doc)), revision: row.revision, updatedAt: row.updated_at };
  }

  /**
   * Save with optimistic concurrency: the caller states which revision it edited.
   * A mismatch means another window saved in between; nothing is overwritten.
   */
  saveProject(doc: BookDocument, baseRevision: number): { ok: true; revision: number } | { ok: false; currentRevision: number } {
    const validated = migrateDocument(doc);
    return this.tx(() => {
      const row = this.db.prepare(`SELECT revision FROM projects WHERE id = ?`).get(doc.id) as { revision: number } | undefined;
      if (!row) throw new Error('Project not found');
      if (row.revision !== baseRevision) return { ok: false as const, currentRevision: row.revision };
      const revision = row.revision + 1;
      const now = new Date().toISOString();
      const json = JSON.stringify(validated);
      this.db.prepare(`UPDATE projects SET doc = ?, title = ?, revision = ?, updated_at = ? WHERE id = ?`).run(json, validated.title, revision, now, doc.id);
      this.db.prepare(`INSERT INTO project_revisions (project_id, revision, doc, saved_at) VALUES (?, ?, ?, ?)`).run(doc.id, revision, json, now);
      this.db.prepare(`DELETE FROM project_revisions WHERE project_id = ? AND revision <= ?`).run(doc.id, revision - 50);
      return { ok: true as const, revision };
    });
  }

  listRevisions(projectId: string) {
    return this.db
      .prepare(`SELECT revision, saved_at AS savedAt, length(doc) AS bytes FROM project_revisions WHERE project_id = ? ORDER BY revision DESC`)
      .all(projectId) as { revision: number; savedAt: string; bytes: number }[];
  }

  getRevision(projectId: string, revision: number): BookDocument | null {
    const row = this.db.prepare(`SELECT doc FROM project_revisions WHERE project_id = ? AND revision = ?`).get(projectId, revision) as { doc: string } | undefined;
    return row ? migrateDocument(JSON.parse(row.doc)) : null;
  }

  // ---- assets ----------------------------------------------------------------------------

  assetByPath(path: string): AssetRow | undefined {
    return this.db.prepare(`SELECT * FROM assets WHERE original_path = ?`).get(path) as AssetRow | undefined;
  }

  assetById(id: string): AssetRow | undefined {
    return this.db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow | undefined;
  }

  firstAssetWithHash(hash: string, notId?: string): AssetRow | undefined {
    return this.db.prepare(`SELECT * FROM assets WHERE content_hash = ? AND id != ? ORDER BY imported_at LIMIT 1`).get(hash, notId ?? '') as AssetRow | undefined;
  }

  upsertAsset(row: AssetRow) {
    this.db
      .prepare(
        `INSERT INTO assets (id, original_path, file_name, format, file_size, mtime_ms, content_hash, width, height, captured_at,
           gps_lat, gps_lon, rating, favorite, tags, analysis, derived_path, exact_duplicate_of, imported_at)
         VALUES (:id, :original_path, :file_name, :format, :file_size, :mtime_ms, :content_hash, :width, :height, :captured_at,
           :gps_lat, :gps_lon, :rating, :favorite, :tags, :analysis, :derived_path, :exact_duplicate_of, :imported_at)
         ON CONFLICT(id) DO UPDATE SET original_path = excluded.original_path, file_name = excluded.file_name,
           format = excluded.format, file_size = excluded.file_size, mtime_ms = excluded.mtime_ms,
           content_hash = excluded.content_hash, width = excluded.width, height = excluded.height,
           captured_at = excluded.captured_at, gps_lat = excluded.gps_lat, gps_lon = excluded.gps_lon,
           analysis = excluded.analysis, derived_path = excluded.derived_path, exact_duplicate_of = excluded.exact_duplicate_of`,
      )
      .run({ ...row } as unknown as Record<string, string | number | null>);
  }

  linkAsset(projectId: string, assetId: string) {
    this.db
      .prepare(`INSERT OR IGNORE INTO project_assets (project_id, asset_id, excluded, added_at) VALUES (?, ?, 0, ?)`)
      .run(projectId, assetId, new Date().toISOString());
  }

  projectAssetRows(projectId: string): (AssetRow & { excluded: number })[] {
    return this.db
      .prepare(`SELECT a.*, pa.excluded FROM assets a JOIN project_assets pa ON pa.asset_id = a.id WHERE pa.project_id = ? ORDER BY a.captured_at, a.file_name`)
      .all(projectId) as unknown as (AssetRow & { excluded: number })[];
  }

  updateAssetUserFields(id: string, patch: { rating?: number; favorite?: boolean; tags?: string[] }) {
    if (patch.rating !== undefined) this.db.prepare(`UPDATE assets SET rating = ? WHERE id = ?`).run(Math.max(0, Math.min(5, Math.round(patch.rating))), id);
    if (patch.favorite !== undefined) this.db.prepare(`UPDATE assets SET favorite = ? WHERE id = ?`).run(patch.favorite ? 1 : 0, id);
    if (patch.tags !== undefined) this.db.prepare(`UPDATE assets SET tags = ? WHERE id = ?`).run(JSON.stringify(patch.tags), id);
  }

  updateAnalysis(id: string, analysis: object) {
    this.db.prepare(`UPDATE assets SET analysis = ? WHERE id = ?`).run(JSON.stringify(analysis), id);
  }

  setExcluded(projectId: string, assetId: string, excluded: boolean) {
    this.db.prepare(`UPDATE project_assets SET excluded = ? WHERE project_id = ? AND asset_id = ?`).run(excluded ? 1 : 0, projectId, assetId);
  }

  relocateAsset(id: string, newPath: string) {
    this.db.prepare(`UPDATE assets SET original_path = ?, file_name = ? WHERE id = ?`).run(newPath, basename(newPath), id);
  }

  /** This project's photos with the given contents (to recognise a file that was moved). */
  projectAssetsWithHash(projectId: string, hash: string): AssetRow[] {
    return this.db
      .prepare(`SELECT a.* FROM assets a JOIN project_assets pa ON pa.asset_id = a.id WHERE pa.project_id = ? AND a.content_hash = ?`)
      .all(projectId, hash) as unknown as AssetRow[];
  }

  inProject(projectId: string, assetId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM project_assets WHERE project_id = ? AND asset_id = ?`).get(projectId, assetId);
  }

  unlinkAsset(projectId: string, assetId: string) {
    this.db.prepare(`DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?`).run(projectId, assetId);
  }

  // ---- linked folders --------------------------------------------------------------------

  /** `auto`: kept in sync on its own (a linked folder). Otherwise imported once, refreshed when asked. */
  listLinks(projectId: string): { folder: string; addedAt: string; syncedAt: string | null; auto: boolean }[] {
    const rows = this.db
      .prepare(`SELECT folder, added_at AS addedAt, synced_at AS syncedAt, auto FROM project_links WHERE project_id = ? ORDER BY added_at`)
      .all(projectId) as { folder: string; addedAt: string; syncedAt: string | null; auto: number }[];
    return rows.map((r) => ({ ...r, auto: !!r.auto }));
  }

  /** Remember a folder. Linking a folder that was only imported turns syncing on; importing never turns it off. */
  addLink(projectId: string, folder: string, auto = true) {
    this.db
      .prepare(`INSERT INTO project_links (project_id, folder, added_at, auto) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, folder) DO UPDATE SET auto = MAX(auto, excluded.auto)`)
      .run(projectId, folder, new Date().toISOString(), auto ? 1 : 0);
  }

  removeLink(projectId: string, folder: string): boolean {
    return Number(this.db.prepare(`DELETE FROM project_links WHERE project_id = ? AND folder = ?`).run(projectId, folder).changes) > 0;
  }

  markLinkSynced(projectId: string, folder: string) {
    this.db.prepare(`UPDATE project_links SET synced_at = ? WHERE project_id = ? AND folder = ?`).run(new Date().toISOString(), projectId, folder);
  }
}

/**
 * Exact duplicates within one project: of each set of identical files, the copy on a page (else one
 * whose file is there, else the first imported) is the original and the rest point at it. Decided
 * per project, so a copy is never flagged against a photo this project doesn't have, and two copies
 * never point at each other.
 */
export function projectDuplicates(rows: AssetRow[], inUse: Set<string>, isMissing: (r: AssetRow) => boolean): Map<string, string> {
  const byHash = new Map<string, AssetRow[]>();
  for (const r of rows) byHash.set(r.content_hash, [...(byHash.get(r.content_hash) ?? []), r]);
  const dupOf = new Map<string, string>();
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const rank = (r: AssetRow) => [inUse.has(r.id) ? 0 : 1, isMissing(r) ? 1 : 0] as const;
    const [original] = [...group].sort((a, b) => {
      const [ua, ma] = rank(a);
      const [ub, mb] = rank(b);
      return ua - ub || ma - mb || a.imported_at.localeCompare(b.imported_at) || a.id.localeCompare(b.id);
    });
    for (const r of group) if (r.id !== original.id) dupOf.set(r.id, original.id);
  }
  return dupOf;
}

export function toPhotoAsset(r: AssetRow & { excluded?: number }, missing: boolean): PhotoAsset {
  return {
    id: r.id,
    fileName: r.file_name,
    format: r.format,
    fileSizeBytes: r.file_size,
    widthPx: r.width,
    heightPx: r.height,
    capturedAt: r.captured_at,
    gpsLat: r.gps_lat,
    gpsLon: r.gps_lon,
    rating: r.rating,
    favorite: !!r.favorite,
    tags: JSON.parse(r.tags) as string[],
    contentHash: r.content_hash,
    exactDuplicateOf: r.exact_duplicate_of,
    analysis: r.analysis ? (JSON.parse(r.analysis) as PhotoAnalysis) : null,
    excluded: !!r.excluded,
    missing,
  };
}
