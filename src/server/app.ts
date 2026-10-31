import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { API_VERSION, SCHEMA_VERSION, UnknownSizeError, createBook, createPoster, posterSize, migrateDocument, type BookDocument, type PhotoAnalysis, type PhotoAsset } from '../core';
import { Store, projectDuplicates, toPhotoAsset, type AssetRow } from './db';
import { Importer, isInside, resolveFolder, scanFolder } from './importer';
import { createShelf, folderName, listShelf, setShelfRoot, shelfPreview, shelfRoot } from './shelf';
import { textOutline } from './textOutline';
import { listPlaces, placeOutline, suggestPlaces } from './places';
import { exportFlipbook, type FlipbookSize } from './flipbook';
import { exportPosterImage } from './imageExport';
import { ALPHA_FORMATS, colorFeatures, existingThumb, hashFile, hasTransparency, isSupported, makeThumbnails, THUMB_SIZES, type ThumbSize } from './media';
import { exportCoverPdf, exportPdf, exportPosterPdf, type ExportAsset, type ExportOptions } from './pdf';

// HTTP API. Bound to 127.0.0.1 by main.ts — never reachable from the network.

export interface AppContext {
  store: Store;
  importer: Importer;
}

export function createApp(dataDir: string, opts: { staticDir?: string; devWebUrl?: string; restart?: () => void } = {}) {
  const store = new Store(dataDir);
  const importer = new Importer(store);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  // Defence in depth for the local-first guarantee: the page may only talk to this server.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; script-src 'self' 'unsafe-inline'",
    );
    next();
  });

  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

  const isMissing = (r: AssetRow) => !existsSync(r.original_path);
  const projectAssets = (projectId: string): PhotoAsset[] => {
    const rows = store.projectAssetRows(projectId);
    const saved = store.getProject(projectId);
    const dupOf = projectDuplicates(rows, saved ? assetIdsInUse(saved.doc) : new Set(), isMissing);
    return rows.map((r) => ({ ...toPhotoAsset(r, isMissing(r)), exactDuplicateOf: dupOf.get(r.id) ?? null }));
  };
  const requireProject = (id: string) => {
    const p = store.getProject(id);
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, dataDir, apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION, canRestart: !!opts.restart }));

  // Restart onto the latest code (the editor's "server is out of date" banner). The custom header
  // can't be sent cross-site without a CORS preflight, which this server never grants.
  app.post('/api/restart', (req, res) => {
    if (req.get('x-photobook') !== '1') return void res.status(403).json({ error: 'Not allowed' });
    if (!opts.restart) return void res.status(409).json({ error: 'This server was started for development: restart it from its terminal.' });
    res.status(202).json({ ok: true });
    setTimeout(opts.restart, 150);
  });

  // ---- projects
  app.get('/api/projects', (_req, res) => res.json(store.listProjects()));
  // Recently deleted: kept for 30 days (restore or delete for good), then purged on start-up.
  store.purgeOldDeleted(30);
  app.get('/api/projects-deleted', (_req, res) => res.json(store.listDeleted()));
  app.delete('/api/projects/:id', wrap((req, res) => {
    if (req.query.forever) {
      if (!store.listDeleted().some((p) => p.id === P(req).id)) throw new HttpError(409, 'Move the project to Recently deleted first');
      return void res.json(store.purgeProject(P(req).id));
    }
    if (!store.trashProject(P(req).id)) throw new HttpError(404, 'Project not found');
    res.json({ ok: true });
  }));
  app.post('/api/projects/:id/restore', wrap((req, res) => {
    if (!store.restoreProject(P(req).id)) throw new HttpError(404, 'Not in Recently deleted');
    res.json({ ok: true });
  }));

  app.post('/api/projects', wrap((req, res) => {
    const { title, sizeId, stylePresetId, pages, printerId, bindingId, product, landscape } = req.body ?? {};
    let doc;
    if (product === 'poster') {
      if (!posterSize(String(sizeId))) throw new HttpError(400, `Unknown poster size “${sizeId}”.`);
      doc = createPoster({ title: String(title || 'Untitled poster'), sizeId: String(sizeId), landscape: !!landscape });
    } else {
      try {
        doc = createBook({ title: String(title || 'Untitled book'), sizeId, stylePresetId, pages, printerId, bindingId });
      } catch (e) {
        if (e instanceof UnknownSizeError) throw new HttpError(400, e.message);
        throw e;
      }
    }
    const { revision } = store.createProject(doc);
    res.status(201).json({ doc, revision });
  }));

  app.get('/api/projects/:id', wrap((req, res) => {
    const p = requireProject(P(req).id);
    res.json({ doc: p.doc, revision: p.revision, updatedAt: p.updatedAt });
  }));

  app.put('/api/projects/:id', wrap((req, res) => {
    const { doc, baseRevision } = req.body ?? {};
    if (!doc || doc.id !== P(req).id) throw new HttpError(400, 'Document id does not match');
    const result = store.saveProject(doc as BookDocument, Number(baseRevision));
    if (!result.ok) throw new HttpError(409, `This book was saved elsewhere (revision ${result.currentRevision}). Reload to continue.`);
    res.json({ revision: result.revision });
  }));

  app.get('/api/projects/:id/revisions', wrap((req, res) => {
    requireProject(P(req).id);
    res.json(store.listRevisions(P(req).id));
  }));

  app.get('/api/projects/:id/revisions/:rev', wrap((req, res) => {
    const doc = store.getRevision(P(req).id, Number(P(req).rev));
    if (!doc) throw new HttpError(404, 'Revision not found');
    res.json({ doc });
  }));

  // ---- library
  app.get('/api/projects/:id/assets', wrap(async (req, res) => {
    requireProject(P(req).id);
    await backfill(P(req).id);
    res.json(projectAssets(P(req).id));
  }));

  /**
   * Photos imported before an analysis existed get it once, here: colour features from their
   * thumbnails, and — for PNG/WebP — whether they have transparency (then their thumbnails are
   * remade as WebP so the see-through parts stay see-through).
   */
  const backfill = async (projectId: string) => {
    for (const r of store.projectAssetRows(projectId)) {
      if (!r.analysis) continue;
      let analysis = JSON.parse(r.analysis) as PhotoAnalysis;
      const before = r.analysis;
      if (!analysis.colorGrid) {
        const thumb = existingThumb(dataDir, r.id, 's');
        try {
          if (thumb) analysis = { ...analysis, ...(await colorFeatures(thumb, false)) };
        } catch {
          // unreadable thumbnail: leave it; ordering falls back to time for this photo
        }
      }
      if (analysis.transparent === undefined && ALPHA_FORMATS.has(r.format) && existsSync(r.original_path)) {
        try {
          const transparent = await hasTransparency(r.original_path);
          if (transparent) await makeThumbnails(r.original_path, dataDir, r.id, true);
          analysis = { ...analysis, transparent };
        } catch {
          // unreadable original: treat as opaque for now and try again next time
        }
      }
      if (JSON.stringify(analysis) !== before) store.updateAnalysis(r.id, analysis);
    }
  };

  app.patch('/api/projects/:id/assets/:assetId', wrap((req, res) => {
    const { rating, favorite, tags, excluded } = req.body ?? {};
    store.updateAssetUserFields(P(req).assetId, { rating, favorite, tags });
    if (excluded !== undefined) store.setExcluded(P(req).id, P(req).assetId, !!excluded);
    const asset = projectAssets(P(req).id).find((a) => a.id === P(req).assetId);
    if (!asset) throw new HttpError(404, 'Photo not in project');
    res.json(asset);
  }));

  /**
   * Take photos out of this book's library. Photos on a page (saved, or `inUse` from edits not saved
   * yet) stay. Original files are never touched.
   */
  app.post('/api/projects/:id/assets/remove', wrap((req, res) => {
    const { doc } = requireProject(P(req).id);
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const inUse = assetIdsInUse(doc);
    if (Array.isArray(req.body?.inUse)) for (const id of req.body.inUse) if (typeof id === 'string') inUse.add(id);
    const removable = ids.filter((id) => !inUse.has(id));
    const removed = store.removeFromProject(P(req).id, removable);
    res.json({ removed, keptOnPages: ids.length - removable.length });
  }));

  app.get('/api/assets/:id/thumb', wrap((req, res) => {
    const size = (req.query.size === 'm' ? 'm' : 's') as ThumbSize;
    const path = existingThumb(dataDir, P(req).id, size);
    if (!path) throw new HttpError(404, 'No thumbnail');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(path);
  }));

  // ---- text outlines (photos cut to the shape of a word)
  app.post('/api/text-outline', wrap((req, res) => {
    const b = req.body ?? {};
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'Type some text for the photo to fill');
    if (b.text.length > 200) throw new HttpError(400, 'That is a lot of text for a cut-out — keep it to a few words');
    try {
      res.json(textOutline({ text: b.text, fontFamily: String(b.fontFamily), fontWeight: Number(b.fontWeight) || 400, italic: !!b.italic, uppercase: !!b.uppercase, letterSpacingEm: Number(b.letterSpacingEm) || 0 }));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
  }));

  // ---- place outlines (map stickers)
  app.get('/api/places', (_req, res) => res.json(listPlaces()));
  app.get('/api/places/:id/outline', wrap((req, res) => {
    try {
      res.json(placeOutline(P(req).id));
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }));
  app.post('/api/places/suggest', wrap((req, res) => {
    const pts = Array.isArray(req.body?.points) ? (req.body.points as unknown[]).filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) : [];
    res.json(suggestPlaces(pts));
  }));

  // ---- import
  app.post('/api/projects/:id/import', wrap((req, res) => {
    requireProject(P(req).id);
    const { folder, recursive } = req.body ?? {};
    if (!folder || typeof folder !== 'string') throw new HttpError(400, 'Choose a folder to import');
    const resolved = resolveFolder(folder);
    // Remembered (not synced on its own) so it can be refreshed later.
    if (existsSync(resolved) && statSync(resolved).isDirectory()) store.addLink(P(req).id, resolved, false);
    const job = importer.start(P(req).id, resolved, recursive !== false);
    res.status(202).json(job);
  }));

  app.get('/api/jobs/:id', (req, res) => {
    const job = importer.get(P(req).id);
    if (!job) return void res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

  // ---- linked folders: kept in sync with the library (new photos added, deleted ones dropped)
  const linksOf = (projectId: string) => {
    const rows = store.projectAssetRows(projectId);
    const root = shelfRoot(store);
    return store.listLinks(projectId).map((l) => ({
      folder: l.folder,
      name: folderName(l.folder),
      exists: existsSync(l.folder),
      onShelf: isInside(l.folder, root),
      auto: l.auto,
      syncedAt: l.syncedAt,
      assetIds: rows.filter((r) => isInside(r.original_path, l.folder)).map((r) => r.id),
    }));
  };

  app.get('/api/projects/:id/links', wrap((req, res) => {
    requireProject(P(req).id);
    res.json(linksOf(P(req).id));
  }));

  /** Link a folder and import it now. */
  app.post('/api/projects/:id/links', wrap((req, res) => {
    requireProject(P(req).id);
    if (typeof req.body?.folder !== 'string' || !req.body.folder) throw new HttpError(400, 'Choose a folder to link');
    const folder = resolveFolder(req.body.folder);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new HttpError(400, `Folder not found: ${folder}`);
    store.addLink(P(req).id, folder);
    res.status(202).json(importer.start(P(req).id, folder));
  }));

  /** Stop syncing (or forget) a folder. Its photos stay in the library. */
  app.delete('/api/projects/:id/links', wrap((req, res) => {
    requireProject(P(req).id);
    const folder = resolveFolder(String(req.query.folder ?? ''));
    if (!store.removeLink(P(req).id, folder)) throw new HttpError(404, 'That folder is not linked');
    res.json(linksOf(P(req).id));
  }));

  /**
   * Re-read every linked folder, or the given ones (refreshing a folder that was imported once).
   * `inUse` adds photos placed in edits not saved yet.
   */
  app.post('/api/projects/:id/links/sync', wrap((req, res) => {
    const { doc } = requireProject(P(req).id);
    const known = store.listLinks(P(req).id);
    const asked = Array.isArray(req.body?.folders) ? new Set((req.body.folders as unknown[]).filter((f): f is string => typeof f === 'string').map(resolveFolder)) : null;
    const folders = known.filter((l) => (asked ? asked.has(l.folder) : l.auto)).map((l) => l.folder);
    if (!folders.length) return void res.json({ job: null });
    const inUse = assetIdsInUse(doc);
    if (Array.isArray(req.body?.inUse)) for (const id of req.body.inUse) if (typeof id === 'string') inUse.add(id);
    res.status(202).json({ job: importer.sync(P(req).id, folders, inUse) });
  }));

  // ---- the shelf (a shared folder of ready-sorted photos, offered to every book)
  app.get('/api/shelf', wrap(async (req, res) => {
    try {
      res.json(await listShelf(store, typeof req.query.path === 'string' && req.query.path ? req.query.path : undefined));
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  }));

  app.put('/api/shelf', wrap(async (req, res) => {
    try {
      setShelfRoot(store, String(req.body?.root ?? ''));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }
    res.json(await listShelf(store));
  }));

  app.post('/api/shelf/create', wrap(async (_req, res) => {
    createShelf(store);
    res.json(await listShelf(store));
  }));

  app.get('/api/shelf/preview', wrap(async (req, res) => {
    let file: string;
    try {
      file = await shelfPreview(store, dataDir, String(req.query.path ?? ''));
    } catch {
      throw new HttpError(404, 'No preview');
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(file);
  }));

  /** Minimal folder browser so import works with real paths (originals are referenced, not copied). */
  app.get('/api/fs', wrap(async (req, res) => {
    const raw = typeof req.query.path === 'string' && req.query.path ? req.query.path : (process.env.HOME ?? '/');
    const path = resolve(raw.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new HttpError(404, 'Folder not found');
    const entries = await readdir(path, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
    const photos = entries.filter((e) => e.isFile() && isSupported(e.name)).length;
    res.json({ path, parent: dirname(path) === path ? null : dirname(path), folders, photos });
  }));

  // ---- relink missing originals
  app.post('/api/projects/:id/relink', wrap(async (req, res) => {
    requireProject(P(req).id);
    const folder = resolve(String(req.body?.folder ?? '').replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!existsSync(folder)) throw new HttpError(400, 'Folder not found');
    const missing = store.projectAssetRows(P(req).id).filter(isMissing);
    const files = await scanFolder(folder, true);
    const byName = new Map<string, string[]>();
    for (const f of files) byName.set(basename(f).toLowerCase(), [...(byName.get(basename(f).toLowerCase()) ?? []), f]);
    let relinked = 0;
    for (const a of missing) {
      for (const candidate of byName.get(a.file_name.toLowerCase()) ?? []) {
        if (statSync(candidate).size !== a.file_size) continue;
        if ((await hashFile(candidate)) !== a.content_hash) continue;
        store.relocateAsset(a.id, candidate);
        relinked++;
        break;
      }
    }
    res.json({ relinked, stillMissing: missing.length - relinked });
  }));

  // ---- export
  /** The project's photos that can be drawn: originals, or their converted copy when the original is missing. */
  const exportAssets = (projectId: string) => {
    const assets = new Map<string, ExportAsset>();
    for (const r of store.projectAssetRows(projectId)) {
      const missing = isMissing(r);
      const workPath = r.derived_path && existsSync(r.derived_path) ? r.derived_path : r.original_path;
      if (!missing || (r.derived_path && existsSync(r.derived_path))) assets.set(r.id, { asset: toPhotoAsset(r, missing), workPath });
    }
    return assets;
  };

  app.post('/api/projects/:id/export', wrap(async (req, res) => {
    const p = requireProject(P(req).id);
    const doc = req.body?.doc ? migrateDocument(req.body.doc) : p.doc;
    const options: ExportOptions = req.body?.bleedMode === 'outer' || req.body?.bleedMode === 'all' ? { bleedMode: req.body.bleedMode } : {};
    const assets = exportAssets(P(req).id);
    const safeTitle = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'photobook';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (doc.settings.product === 'poster') {
      const file = `${safeTitle}-${stamp}-poster.pdf`;
      const result = await exportPosterPdf(doc, assets, join(dataDir, 'exports', file));
      return void res.json({ ...result, file, url: `/api/exports/${encodeURIComponent(file)}`, cover: null });
    }
    const file = `${safeTitle}-${stamp}-interior.pdf`;
    const result = await exportPdf(doc, assets, join(dataDir, 'exports', file), options);
    let cover = null;
    if (doc.cover) {
      const coverFile = `${safeTitle}-${stamp}-cover.pdf`;
      const c = await exportCoverPdf(doc, assets, join(dataDir, 'exports', coverFile));
      cover = { ...c, file: coverFile, url: `/api/exports/${encodeURIComponent(coverFile)}` };
    }
    res.json({ ...result, file, url: `/api/exports/${encodeURIComponent(file)}`, cover });
  }));

  // Poster as a PNG or JPEG (sharing, printing at home).
  app.post('/api/projects/:id/export-image', wrap(async (req, res) => {
    const p = requireProject(P(req).id);
    const doc = req.body?.doc ? migrateDocument(req.body.doc) : p.doc;
    if (doc.settings.product !== 'poster') throw new HttpError(400, 'Image export is for posters');
    const format = req.body?.format === 'jpeg' ? 'jpeg' : 'png';
    const dpi = Math.max(36, Math.min(600, Number(req.body?.dpi) || 150));
    const assets = exportAssets(P(req).id);
    const safeTitle = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'poster';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${safeTitle}-${stamp}-${dpi}dpi.${format === 'jpeg' ? 'jpg' : 'png'}`;
    try {
      const result = await exportPosterImage(doc, assets, join(dataDir, 'exports', file), { format, dpi });
      res.json({ ...result, file, url: `/api/exports/${encodeURIComponent(file)}` });
    } catch (e) {
      throw new HttpError(500, e instanceof Error ? e.message : String(e));
    }
  }));

  // Book as a shareable web flipbook: one HTML file with every page in it.
  app.post('/api/projects/:id/export-flipbook', wrap(async (req, res) => {
    const p = requireProject(P(req).id);
    const doc = req.body?.doc ? migrateDocument(req.body.doc) : p.doc;
    if (doc.settings.product === 'poster') throw new HttpError(400, 'The flipbook is for books');
    const size: FlipbookSize = req.body?.size === 'sharp' ? 'sharp' : 'standard';
    const safeTitle = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'photobook';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${safeTitle}-${stamp}-flipbook.html`;
    try {
      const result = await exportFlipbook(doc, exportAssets(P(req).id), join(dataDir, 'exports', file), { size });
      res.json({ ...result, file, url: `/api/exports/${encodeURIComponent(file)}` });
    } catch (e) {
      throw new HttpError(500, e instanceof Error ? e.message : String(e));
    }
  }));

  app.get('/api/exports/:file', wrap((req, res) => {
    const file = basename(P(req).file);
    const path = join(dataDir, 'exports', file);
    if (!existsSync(path)) throw new HttpError(404, 'Export not found');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.sendFile(path);
  }));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(opts.staticDir!, 'index.html')));
  } else if (opts.devWebUrl) {
    // Dev mode: this port is only the API; the editor is served by Vite. Send people there.
    app.get(/^\/(?!api\/).*/, (req, res) => res.redirect(302, opts.devWebUrl + req.originalUrl.slice(1)));
  } else if (opts.staticDir) {
    app.get(/^\/(?!api\/).*/, (_req, res) =>
      res.status(503).type('text').send('The editor has not been built yet. Stop the server, run `npm run build`, then `npm start` again.'));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });

  return { app, store, importer };
}

/** Express 5 types params as string | string[]; our routes only use simple string params. */
const P = (req: Request) => req.params as Record<string, string>;

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export { THUMB_SIZES };

/** Every photo placed on a page, the cover or as a background. */
function assetIdsInUse(doc: BookDocument): Set<string> {
  const ids = new Set<string>();
  for (const s of doc.cover ? [doc.cover, ...doc.spreads] : doc.spreads) {
    for (const e of s.elements) if (e.type === 'image' && e.assetId) ids.add(e.assetId);
    if (s.backgroundImage) ids.add(s.backgroundImage.assetId);
  }
  return ids;
}
