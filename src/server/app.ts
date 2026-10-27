import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { API_VERSION, SCHEMA_VERSION, UnknownSizeError, createBook, createPoster, posterSize, migrateDocument, type BookDocument, type PhotoAnalysis, type PhotoAsset } from '../core';
import { Store, toPhotoAsset, type AssetRow } from './db';
import { Importer, scanFolder } from './importer';
import { textOutline } from './textOutline';
import { listPlaces, placeOutline, suggestPlaces } from './places';
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
  const projectAssets = (projectId: string): PhotoAsset[] => store.projectAssetRows(projectId).map((r) => toPhotoAsset(r, isMissing(r)));
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
    const row = store.projectAssetRows(P(req).id).find((r) => r.id === P(req).assetId);
    if (!row) throw new HttpError(404, 'Photo not in project');
    res.json(toPhotoAsset(row, isMissing(row)));
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
    const assets = new Map<string, ExportAsset>();
    for (const r of store.projectAssetRows(P(req).id)) {
      const missing = isMissing(r);
      const workPath = r.derived_path && existsSync(r.derived_path) ? r.derived_path : r.original_path;
      if (!missing || (r.derived_path && existsSync(r.derived_path))) assets.set(r.id, { asset: toPhotoAsset(r, missing), workPath });
    }
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
