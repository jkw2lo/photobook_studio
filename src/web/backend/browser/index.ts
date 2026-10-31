import { UnknownSizeError, createBook, createPoster, fontFilePath, migrateDocument, posterSize, type BookDocument, type PhotoAsset } from '../../../core';
import { ApiError, type Backend, type ImportJob, type LinkedFolder, type ShelfFolder, type ShelfListing, type StorageInfo, type WebExtras } from '../types';
import { backupProject, restoreProject } from './backup';
import { BrowserStore, toPhotoAsset, type ProjectAssetRow } from './db';
import type { WorkerAsset } from './export.worker';
import { BrowserExporter } from './exporter';
import { canPickDirectories, containsFile, folderDisplayName, folderRef, Folders, parseFolder, registerPick } from './folders';
import { fontBytes } from './fonts';
import { BrowserImporter } from './importer';

// The web version's backend: everything src/server/app.ts does, in the page. Same methods and
// response shapes as the HTTP client, so the editor doesn't know the difference. Errors carry the
// status codes the server would send (the editor checks 409 for save conflicts).

interface Context {
  store: BrowserStore;
  folders: Folders;
  importer: BrowserImporter;
  exporter: BrowserExporter;
}

const DB_NAME = 'photobook-studio';

let ctxPromise: Promise<Context> | null = null;
const ctx = () =>
  (ctxPromise ??= (async () => {
    const store = await BrowserStore.open(DB_NAME);
    const folders = new Folders(store);
    const importer = new BrowserImporter(store, folders);
    // Recently deleted: kept for 30 days, then purged (as the server does on start-up).
    await store.purgeOldDeleted(30).catch(() => 0);
    return { store, folders, importer, exporter: new BrowserExporter() };
  })());

/** Transparent pixel for photos whose thumbnail isn't loaded (yet). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const thumbUrls = new Map<string, string>();
const shelfPreviews = new Map<string, Promise<string | null>>();

async function loadThumbs(store: BrowserStore, ids: string[]) {
  for (const id of ids) {
    for (const size of ['s', 'm'] as const) {
      const key = `${id}_${size}`;
      if (thumbUrls.has(key)) continue;
      const blob = await store.getThumb(id, size);
      if (blob) thumbUrls.set(key, URL.createObjectURL(blob));
    }
  }
}

function forgetThumbs(ids: string[]) {
  for (const id of ids) {
    for (const size of ['s', 'm']) {
      const u = thumbUrls.get(`${id}_${size}`);
      if (u) URL.revokeObjectURL(u);
      thumbUrls.delete(`${id}_${size}`);
    }
  }
}

const notFound = (what: string) => new ApiError(404, what);

async function requireProject(c: Context, id: string) {
  const p = await c.store.getProject(id);
  if (!p) throw notFound('Project not found');
  return p;
}

/** Saved folders this project's photos, links (and the shelf) live in. */
async function projectDirs(c: Context, projectId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const r of await c.store.projectAssetRows(projectId)) if (r.source.kind === 'dir') ids.add(r.source.dirId);
  for (const l of await c.store.listLinks(projectId)) {
    const f = parseFolder(l.folder);
    if (f?.kind === 'dir') ids.add(f.id);
  }
  const shelf = parseFolder((await c.store.getSetting<string>('shelfRoot')) ?? '');
  if (shelf?.kind === 'dir') ids.add(shelf.id);
  return [...ids];
}

/** Whether each photo's original can be read now. Unknown (no permission yet) counts as present. */
async function missingMap(c: Context, rows: ProjectAssetRow[]): Promise<Map<string, boolean>> {
  const perm = new Map<string, string>();
  const out = new Map<string, boolean>();
  for (const r of rows) {
    if (r.source.kind === 'copy') {
      out.set(r.id, !(await c.store.hasOriginal(r.id)));
      continue;
    }
    const { dirId, path } = r.source;
    if (!perm.has(dirId)) perm.set(dirId, await c.folders.permission(dirId));
    out.set(r.id, perm.get(dirId) === 'granted' ? !(await c.folders.file(dirId, path)) : false);
  }
  return out;
}

/** The project's photos that can be drawn, with their files, for the export worker. */
async function exportAssets(c: Context, projectId: string): Promise<WorkerAsset[]> {
  // Exporting starts from a click, so the browser may ask for folder access here.
  for (const dirId of await projectDirs(c, projectId)) await c.folders.permission(dirId, true);
  const out: WorkerAsset[] = [];
  for (const r of await c.store.projectAssetRows(projectId)) {
    const file = r.source.kind === 'copy' ? await c.store.getOriginal(r.id) : await c.folders.file(r.source.dirId, r.source.path);
    if (file) out.push({ asset: toPhotoAsset(r, false), file });
  }
  return out;
}

/** Every photo placed on a page, the cover or as a background. */
function assetIdsInUse(doc: BookDocument): Set<string> {
  const ids = new Set<string>();
  for (const s of doc.cover ? [doc.cover, ...doc.spreads] : doc.spreads) {
    for (const e of s.elements) if (e.type === 'image' && e.assetId) ids.add(e.assetId);
    if (s.backgroundImage) ids.add(s.backgroundImage.assetId);
  }
  return ids;
}

async function linksOf(c: Context, projectId: string): Promise<LinkedFolder[]> {
  const rows = await c.store.projectAssetRows(projectId);
  const shelf = (await c.store.getSetting<string>('shelfRoot')) ?? null;
  return Promise.all(
    (await c.store.listLinks(projectId)).map(async (l) => {
      const f = parseFolder(l.folder);
      const permission = f?.kind === 'dir' ? await c.folders.permission(f.id) : 'denied';
      const needsAccess = permission === 'prompt';
      return {
        folder: l.folder,
        name: folderDisplayName(l.folder),
        exists: needsAccess || (await c.folders.readable(l.folder)),
        onShelf: !!shelf && (l.folder === shelf || l.folder.startsWith(`${shelf}/`)),
        syncedAt: l.syncedAt,
        assetIds: rows.filter((r) => r.source.kind === 'dir' && containsFile(l.folder, r.source.dirId, r.source.path)).map((r) => r.id),
        ...(needsAccess ? { needsAccess: true } : {}),
      };
    }),
  );
}

const PREVIEWABLE = /\.(jpe?g|png|webp)$/i;

async function shelfListing(c: Context, pathInput?: string): Promise<ShelfListing> {
  const empty = { exists: false, parent: null, folders: [], loosePhotos: 0 };
  if (!canPickDirectories()) return { root: '', path: '', ...empty, unsupported: true };
  const root = (await c.store.getSetting<string>('shelfRoot')) ?? '';
  const r = parseFolder(root);
  if (!r) return { root: '', path: '', ...empty };
  const permission = await c.folders.permission(r.id);
  if (permission === 'prompt') return { root, path: root, ...empty, exists: true, needsAccess: true };
  if (!(await c.folders.readable(root))) return { root, path: root, ...empty };
  const path = pathInput ?? root;
  if (path !== root && !path.startsWith(`${root}/`)) throw notFound('That folder is not on the shelf');
  const { folders: subs, photos } = await c.folders.children(path);
  const folders: ShelfFolder[] = [];
  for (const s of subs) {
    const [all, inner] = await Promise.all([c.folders.list(s.ref, true), c.folders.children(s.ref)]);
    const candidates = await Promise.all(all.filter((f) => PREVIEWABLE.test(f.name)).slice(0, 60).map(async (f) => ({ f, file: await f.file() })));
    const newest = candidates.sort((a, b) => b.file.lastModified - a.file.lastModified).slice(0, 3);
    const previews = (await Promise.all(newest.map(({ f, file }) => shelfPreview(c, `${s.ref}|${f.path}|${file.size}|${file.lastModified}`, file, f.name)))).filter((u): u is string => !!u);
    folders.push({ name: s.name, path: s.ref, photos: all.length, subfolders: inner.folders.length, previews });
  }
  const p = parseFolder(path)!;
  const parent = path === root ? null : folderRef({ ...p, sub: p.sub.split('/').slice(0, -1).join('/') });
  return { root, exists: true, path, parent, folders, loosePhotos: photos.length };
}

function shelfPreview(c: Context, key: string, file: File, name: string): Promise<string | null> {
  let p = shelfPreviews.get(key);
  if (!p) {
    p = c.importer.media<Blob>('preview', file, name, 160).then((b) => URL.createObjectURL(b), () => null);
    shelfPreviews.set(key, p);
  }
  return p;
}

let placesCache: Promise<import('../../../shared/places').Place[]> | null = null;
const places = () =>
  (placesCache ??= Promise.all([import('../../../shared/places'), import('world-atlas/countries-10m.json')]).then(([m, topo]) =>
    m.placesFromTopology((topo as { default?: unknown }).default as import('../../../shared/places').PlacesTopology ?? (topo as unknown as import('../../../shared/places').PlacesTopology)),
  ));

const outlineFonts = new Map<string, Promise<import('fontkit').Font>>();
function outlineFont(file: string) {
  let f = outlineFonts.get(file);
  if (!f) {
    f = Promise.all([import('fontkit'), fontBytes(file)]).then(([fk, bytes]) => fk.create(bytes));
    outlineFonts.set(file, f);
  }
  return f;
}

async function storageInfo(): Promise<StorageInfo> {
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  return { persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false, usageBytes: est?.usage ?? 0, quotaBytes: est?.quota ?? 0 };
}

const persist = async () => (await navigator.storage?.persist?.().catch(() => false)) ?? false;

const web: WebExtras = {
  get canPickDirectories() {
    return canPickDirectories();
  },
  pickDirectory: async () => (await ctx()).folders.pickDirectory(),
  registerFiles: (files) => registerPick(files),
  async foldersNeedingAccess(projectId) {
    const c = await ctx();
    let n = 0;
    for (const id of await projectDirs(c, projectId)) if ((await c.folders.permission(id)) === 'prompt') n++;
    return n;
  },
  async requestFolderAccess(projectId) {
    const c = await ctx();
    let n = 0;
    for (const id of await projectDirs(c, projectId)) if ((await c.folders.permission(id, true)) === 'granted') n++;
    return n;
  },
  async backupProject(projectId) {
    const c = await ctx();
    for (const id of await projectDirs(c, projectId)) await c.folders.permission(id, true);
    const r = await backupProject(c.store, projectId, async (row) =>
      row.source.kind === 'copy' ? ((await c.store.getOriginal(row.id)) ?? null) : c.folders.file(row.source.dirId, row.source.path),
    );
    return { url: URL.createObjectURL(r.blob), file: r.file, bytes: r.blob.size, photos: r.photos, withoutOriginal: r.withoutOriginal };
  },
  async restoreBackup(file) {
    const c = await ctx();
    void persist();
    return restoreProject(c.store, file);
  },
  storage: storageInfo,
  persist,
  async eraseEverything() {
    const open = ctxPromise;
    ctxPromise = null;
    if (open) (await open.catch(() => null))?.store.close();
    forgetThumbs([...new Set([...thumbUrls.keys()].map((k) => k.replace(/_[sm]$/, '')))]);
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      // Another tab still has it open: it is deleted once that tab closes.
      r.onblocked = () => resolve();
    });
  },
};

export const browserBackend: Backend = {
  kind: 'browser',
  web,

  // ---- projects
  listProjects: async () => (await ctx()).store.listProjects(),
  deletedProjects: async () => (await ctx()).store.listDeleted(),
  async trashProject(id) {
    if (!(await (await ctx()).store.trashProject(id))) throw notFound('Project not found');
    return { ok: true };
  },
  async restoreProject(id) {
    if (!(await (await ctx()).store.restoreProject(id))) throw notFound('Not in Recently deleted');
    return { ok: true };
  },
  async purgeProject(id) {
    const c = await ctx();
    if (!(await c.store.listDeleted()).some((p) => p.id === id)) throw new ApiError(409, 'Move the project to Recently deleted first');
    const r = await c.store.purgeProject(id);
    forgetThumbs(r.removedIds);
    return { removedPhotos: r.removedPhotos };
  },
  async createProject(body) {
    const c = await ctx();
    const { title, sizeId, stylePresetId, pages, printerId, bindingId, product, landscape } = body;
    let doc: BookDocument;
    if (product === 'poster') {
      if (!posterSize(String(sizeId))) throw new ApiError(400, `Unknown poster size “${sizeId}”.`);
      doc = createPoster({ title: String(title || 'Untitled poster'), sizeId: String(sizeId), landscape: !!landscape });
    } else {
      try {
        doc = createBook({ title: String(title || 'Untitled book'), sizeId, stylePresetId, pages, printerId, bindingId });
      } catch (e) {
        if (e instanceof UnknownSizeError) throw new ApiError(400, e.message);
        throw e;
      }
    }
    const { revision } = await c.store.createProject(doc);
    void persist();
    return { doc, revision };
  },
  async getProject(id) {
    const p = await requireProject(await ctx(), id);
    return { doc: p.doc, revision: p.revision, updatedAt: p.updatedAt };
  },
  async saveProject(doc, baseRevision) {
    const r = await (await ctx()).store.saveProject(doc, Number(baseRevision));
    if (!r.ok) throw new ApiError(409, `This book was saved elsewhere (revision ${r.currentRevision}). Reload to continue.`);
    return { revision: r.revision };
  },
  async revisions(id) {
    const c = await ctx();
    await requireProject(c, id);
    return c.store.listRevisions(id);
  },
  async revision(id, rev) {
    const doc = await (await ctx()).store.getRevision(id, Number(rev));
    if (!doc) throw notFound('Revision not found');
    return { doc };
  },

  // ---- library
  async assets(id) {
    const c = await ctx();
    await requireProject(c, id);
    const rows = await c.store.projectAssetRows(id);
    const missing = await missingMap(c, rows);
    await loadThumbs(c.store, rows.map((r) => r.id));
    return rows.map((r) => toPhotoAsset(r, missing.get(r.id) ?? false));
  },
  async patchAsset(projectId, assetId, patch): Promise<PhotoAsset> {
    const c = await ctx();
    const { rating, favorite, excluded } = patch;
    await c.store.updateAssetUserFields(assetId, { rating, favorite });
    if (excluded !== undefined) await c.store.setExcluded(projectId, assetId, !!excluded);
    const row = (await c.store.projectAssetRows(projectId)).find((r) => r.id === assetId);
    if (!row) throw notFound('Photo not in project');
    return toPhotoAsset(row, (await missingMap(c, [row])).get(row.id) ?? false);
  },

  // ---- import, links, relink
  async startImport(projectId, folder) {
    const c = await ctx();
    await requireProject(c, projectId);
    if (!folder) throw new ApiError(400, 'Choose a folder to import');
    void persist();
    return c.importer.start(projectId, folder);
  },
  async job(id) {
    const j = (await ctx()).importer.get(id);
    if (!j) throw notFound('Job not found');
    return j;
  },
  async listFolder() {
    throw new ApiError(501, 'The web version uses your browser’s folder picker.');
  },
  async links(projectId) {
    const c = await ctx();
    await requireProject(c, projectId);
    return linksOf(c, projectId);
  },
  async linkFolder(projectId, folder): Promise<ImportJob> {
    const c = await ctx();
    await requireProject(c, projectId);
    if (parseFolder(folder)?.kind !== 'dir') throw new ApiError(400, 'This browser can’t keep a folder linked. Import it instead.');
    await c.store.addLink(projectId, folder);
    void persist();
    return c.importer.start(projectId, folder);
  },
  async unlinkFolder(projectId, folder) {
    const c = await ctx();
    if (!(await c.store.removeLink(projectId, folder))) throw notFound('That folder is not linked');
    return linksOf(c, projectId);
  },
  async syncLinks(projectId, inUseIds) {
    const c = await ctx();
    const { doc } = await requireProject(c, projectId);
    const folders = (await c.store.listLinks(projectId)).map((l) => l.folder);
    if (!folders.length) return { job: null };
    const inUse = assetIdsInUse(doc);
    for (const id of inUseIds) inUse.add(id);
    const job = c.importer.sync(projectId, folders, inUse);
    return { job };
  },
  async relink(projectId, folder) {
    const c = await ctx();
    await requireProject(c, projectId);
    const ref = parseFolder(folder);
    if (!ref) throw new ApiError(400, 'Folder not found');
    const rows = await c.store.projectAssetRows(projectId);
    const missingNow = await missingMap(c, rows);
    const missing = rows.filter((r) => missingNow.get(r.id));
    const byName = new Map<string, Awaited<ReturnType<Folders['list']>>>();
    for (const f of await c.folders.list(folder, true)) byName.set(f.name.toLowerCase(), [...(byName.get(f.name.toLowerCase()) ?? []), f]);
    let relinked = 0;
    for (const a of missing) {
      for (const candidate of byName.get(a.fileName.toLowerCase()) ?? []) {
        const file = await candidate.file();
        if (file.size !== a.fileSize) continue;
        if ((await c.importer.media<string>('hash', file)) !== a.contentHash) continue;
        if (ref.kind === 'dir') await c.store.relocateAsset(a.id, { kind: 'dir', dirId: ref.id, path: candidate.path }, candidate.name);
        else {
          await c.store.putOriginal(a.id, file);
          await c.store.relocateAsset(a.id, { kind: 'copy' }, candidate.name);
        }
        relinked++;
        break;
      }
    }
    return { relinked, stillMissing: missing.length - relinked };
  },

  // ---- the shelf
  shelf: async (path) => shelfListing(await ctx(), path),
  async setShelfRoot(root) {
    const c = await ctx();
    if (parseFolder(root)?.kind !== 'dir') throw new ApiError(400, 'Choose a folder with the folder picker');
    await c.store.setSetting('shelfRoot', root);
    return shelfListing(c);
  },
  async createShelf() {
    throw new ApiError(501, 'Create the folder in Finder or Explorer, then choose it as your shelf.');
  },

  // ---- outlines
  async places() {
    const { listPlaces } = await import('../../../shared/places');
    return listPlaces(await places());
  },
  async placeOutline(id) {
    const { placeOutline } = await import('../../../shared/places');
    try {
      return placeOutline(await places(), id);
    } catch (e) {
      throw notFound(e instanceof Error ? e.message : String(e));
    }
  },
  async suggestPlaces(points) {
    const { suggestPlaces } = await import('../../../shared/places');
    const pts = points.filter((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)));
    return suggestPlaces(await places(), pts);
  },
  async textOutline(b) {
    if (typeof b.text !== 'string' || !b.text.trim()) throw new ApiError(400, 'Type some text for the photo to fill');
    if (b.text.length > 200) throw new ApiError(400, 'That is a lot of text for a cut-out — keep it to a few words');
    const { textOutline } = await import('../../../shared/textOutline');
    try {
      const font = await outlineFont(fontFilePath(String(b.fontFamily), Number(b.fontWeight) || 400, !!b.italic));
      return textOutline(font, { text: b.text, fontFamily: String(b.fontFamily), fontWeight: Number(b.fontWeight) || 400, italic: !!b.italic, uppercase: !!b.uppercase, letterSpacingEm: Number(b.letterSpacingEm) || 0 });
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : String(e));
    }
  },

  // ---- export
  async exportPdf(projectId, doc, bleedMode) {
    const c = await ctx();
    const p = await requireProject(c, projectId);
    return c.exporter.pdf(doc ? migrateDocument(doc) : p.doc, await exportAssets(c, projectId), bleedMode === 'outer' || bleedMode === 'all' ? bleedMode : undefined);
  },
  async exportImage(projectId, doc, format, dpi) {
    const c = await ctx();
    const p = await requireProject(c, projectId);
    const d = doc ? migrateDocument(doc) : p.doc;
    if (d.settings.product !== 'poster') throw new ApiError(400, 'Image export is for posters');
    return c.exporter.posterImage(d, await exportAssets(c, projectId), format === 'jpeg' ? 'jpeg' : 'png', Number(dpi) || 150);
  },
  async exportFlipbook(projectId, doc, size) {
    const c = await ctx();
    const p = await requireProject(c, projectId);
    const d = doc ? migrateDocument(doc) : p.doc;
    if (d.settings.product === 'poster') throw new ApiError(400, 'The flipbook is for books');
    return c.exporter.flipbook(d, await exportAssets(c, projectId), size === 'sharp' ? 'sharp' : 'standard');
  },

  thumbUrl: (assetId, size = 's') => thumbUrls.get(`${assetId}_${size}`) ?? thumbUrls.get(`${assetId}_s`) ?? BLANK,
  shelfPreviewUrl: (path) => path,
  downloadUrl: (url) => url,
};

/** For tests: the store behind the backend. */
export const browserContext = ctx;
