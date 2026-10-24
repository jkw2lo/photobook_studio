import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { API_VERSION, SCHEMA_VERSION, UnknownSizeError, createBook, migrateDocument, type BookDocument, type PhotoAsset } from '../core';
import { Store, toPhotoAsset, type AssetRow } from './db';
import { Importer, scanFolder } from './importer';
import { hashFile, isSupported, thumbPath, THUMB_SIZES, type ThumbSize } from './media';
import { exportCoverPdf, exportPdf, type ExportAsset, type ExportOptions } from './pdf';

// HTTP API. Bound to 127.0.0.1 by main.ts — never reachable from the network.

export interface AppContext {
  store: Store;
  importer: Importer;
}

export function createApp(dataDir: string, opts: { staticDir?: string } = {}) {
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
  const projectAssets = (projectId: string): PhotoAsset[] => store.projectAssetRows(projectId).map((r) => toPhotoAsset(r, isMissing(r)));
  const requireProject = (id: string) => {
    const p = store.getProject(id);
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, dataDir, apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION }));

  // ---- projects
  app.get('/api/projects', (_req, res) => res.json(store.listProjects()));

  app.post('/api/projects', wrap((req, res) => {
    const { title, sizeId, stylePresetId, pages, printerId, bindingId } = req.body ?? {};
    let doc;
    try {
      doc = createBook({ title: String(title || 'Untitled book'), sizeId, stylePresetId, pages, printerId, bindingId });
    } catch (e) {
      if (e instanceof UnknownSizeError) throw new HttpError(400, e.message);
      throw e;
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
  app.get('/api/projects/:id/assets', wrap((req, res) => {
    requireProject(P(req).id);
    res.json(projectAssets(P(req).id));
  }));

  app.patch('/api/projects/:id/assets/:assetId', wrap((req, res) => {
    const { rating, favorite, tags, excluded } = req.body ?? {};
    store.updateAssetUserFields(P(req).assetId, { rating, favorite, tags });
    if (excluded !== undefined) store.setExcluded(P(req).id, P(req).assetId, !!excluded);
    const row = store.projectAssetRows(P(req).id).find((r) => r.id === P(req).assetId);
    if (!row) throw new HttpError(404, 'Photo not in project');
    res.json(toPhotoAsset(row, isMissing(row)));
  }));

  app.get('/api/assets/:id/thumb', wrap((req, res) => {
    const size = (req.query.size === 'm' ? 'm' : 's') as ThumbSize;
    const path = thumbPath(dataDir, P(req).id, size);
    if (!existsSync(path)) throw new HttpError(404, 'No thumbnail');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(path);
  }));

  // ---- import
  app.post('/api/projects/:id/import', wrap((req, res) => {
    requireProject(P(req).id);
    const { folder, recursive } = req.body ?? {};
    if (!folder || typeof folder !== 'string') throw new HttpError(400, 'Choose a folder to import');
    const job = importer.start(P(req).id, folder, recursive !== false);
    res.status(202).json(job);
  }));

  app.get('/api/jobs/:id', (req, res) => {
    const job = importer.get(P(req).id);
    if (!job) return void res.status(404).json({ error: 'Job not found' });
    res.json(job);
  });

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
  app.post('/api/projects/:id/export', wrap(async (req, res) => {
    const p = requireProject(P(req).id);
    const doc = req.body?.doc ? migrateDocument(req.body.doc) : p.doc;
    const options: ExportOptions = req.body?.bleedMode === 'outer' || req.body?.bleedMode === 'all' ? { bleedMode: req.body.bleedMode } : {};
    const rows = new Map(store.projectAssetRows(P(req).id).map((r) => [r.id, r]));
    const assets = new Map<string, ExportAsset>();
    for (const [id, r] of rows) {
      const missing = isMissing(r);
      const workPath = r.derived_path && existsSync(r.derived_path) ? r.derived_path : r.original_path;
      if (!missing || (r.derived_path && existsSync(r.derived_path))) assets.set(id, { asset: toPhotoAsset(r, missing), workPath });
    }
    const safeTitle = doc.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'photobook';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
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
