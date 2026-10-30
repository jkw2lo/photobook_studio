import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import sharp from 'sharp';
import { isInside, resolveFolder, scanFolder } from './importer';
import type { Store } from './db';

// The Shelf: one folder shared with other tools (Background Studio sorts and cuts out into it).
// Its subfolders are offered in every book's library, ready to link. Nothing here writes to it
// except "Create", which makes the folder itself.

export const DEFAULT_SHELF = '~/Pictures/Studio Shelf';

export interface ShelfFolder {
  name: string;
  path: string;
  /** Photos inside, subfolders included. */
  photos: number;
  subfolders: number;
  /** A few of the newest photos, for the folder's preview. */
  previews: string[];
}

export interface ShelfListing {
  root: string;
  exists: boolean;
  path: string;
  /** null at the shelf's top level. */
  parent: string | null;
  folders: ShelfFolder[];
  /** Photos directly in `path`, not in a subfolder. */
  loosePhotos: number;
}

const PREVIEW_COUNT = 3;
const PREVIEW_PX = 160;
// sharp's bundled libvips can't decode HEIC; those still import (via sips), they just aren't previewed.
const PREVIEWABLE = /\.(jpe?g|png|webp)$/i;

export function shelfRoot(store: Store): string {
  return resolveFolder(store.getSetting('shelf_root') ?? process.env.PHOTOBOOK_SHELF_DIR ?? DEFAULT_SHELF);
}

export function setShelfRoot(store: Store, input: string): string {
  const root = resolveFolder(input);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Folder not found');
  store.setSetting('shelf_root', root);
  return root;
}

export function createShelf(store: Store): string {
  const root = shelfRoot(store);
  mkdirSync(root, { recursive: true });
  return root;
}

export async function listShelf(store: Store, pathInput?: string): Promise<ShelfListing> {
  const root = shelfRoot(store);
  if (!existsSync(root)) return { root, exists: false, path: root, parent: null, folders: [], loosePhotos: 0 };
  const path = pathInput ? resolveFolder(pathInput) : root;
  if (!isInside(path, root) || !existsSync(path)) throw new Error('That folder is not on the shelf');
  const entries = await readdir(path, { withFileTypes: true });
  const folders: ShelfFolder[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const p = join(path, e.name);
    const [files, inner] = await Promise.all([scanFolder(p, true), readdir(p, { withFileTypes: true })]);
    const dated = await Promise.all(files.filter((f) => PREVIEWABLE.test(f)).map(async (f) => ({ f, t: (await stat(f)).mtimeMs })));
    folders.push({
      name: e.name,
      path: p,
      photos: files.length,
      subfolders: inner.filter((d) => d.isDirectory() && !d.name.startsWith('.')).length,
      previews: dated.sort((a, b) => b.t - a.t).slice(0, PREVIEW_COUNT).map((d) => d.f),
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const loosePhotos = (await scanFolder(path, false)).length;
  return { root, exists: true, path, parent: path === root ? null : dirname(path), folders, loosePhotos };
}

/** A small preview of a photo on the shelf (only files inside the shelf are served). */
export async function shelfPreview(store: Store, dataDir: string, pathInput: string): Promise<string> {
  const root = shelfRoot(store);
  const path = resolveFolder(pathInput);
  if (!PREVIEWABLE.test(path) || !existsSync(path) || !existsSync(root)) throw new Error('No preview');
  // Follow symlinks before checking, so a link inside the shelf can't reach outside it.
  if (!isInside(realpathSync(path), realpathSync(root))) throw new Error('No preview');
  const st = statSync(path);
  const key = createHash('sha1').update(`${path}\0${st.size}\0${st.mtimeMs}`).digest('hex');
  const dir = join(dataDir, 'shelf-previews');
  const out = join(dir, `${key}.webp`);
  if (!existsSync(out)) {
    mkdirSync(dir, { recursive: true });
    await sharp(path, { failOn: 'none' }).rotate().resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72, alphaQuality: 80 }).toFile(out);
  }
  return out;
}

export const folderName = (path: string) => basename(path) || path;
