import type { BrowserStore } from './db';

// Folder access in the browser. Two ways in:
//  - Chrome/Edge: `showDirectoryPicker()`. The handle is saved in IndexedDB, so photos stay in
//    their folder (referenced, not copied), folders can be linked and kept in sync, and missing
//    originals can be relinked. Browsers ask for permission again after a restart.
//  - Safari/Firefox: `<input type="file" webkitdirectory>`. The browser hands over the files once;
//    they are copied into browser storage on import.
//
// The rest of the app passes folders around as strings, so a chosen folder becomes a reference:
//   dir:<dirId>:<root name>[/<sub/path>]   a saved handle (and optionally a folder inside it)
//   pick:<pickId>:<name>                   files handed over by the file input (this session only)

export const SUPPORTED = /\.(jpe?g|png|heic|heif|webp)$/i;
export const isSupported = (name: string) => SUPPORTED.test(name) && !name.startsWith('._') && !name.startsWith('.');

// The File System Access API isn't in TypeScript's DOM library yet.
type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionHandle {
  queryPermission?(opts: { mode: 'read' }): Promise<Permission>;
  requestPermission?(opts: { mode: 'read' }): Promise<Permission>;
}
interface DirEntries {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}

export const canPickDirectories = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export interface FolderRef {
  kind: 'dir' | 'pick';
  id: string;
  rootName: string;
  /** Path inside the root ('' for the root itself). */
  sub: string;
}

export function parseFolder(ref: string): FolderRef | null {
  const m = ref.match(/^(dir|pick):([\w-]+):([^/]*)(?:\/(.*))?$/);
  if (!m) return null;
  return { kind: m[1] as 'dir' | 'pick', id: m[2], rootName: m[3], sub: (m[4] ?? '').replace(/\/+$/, '') };
}

export const folderRef = (f: FolderRef) => `${f.kind}:${f.id}:${f.rootName}${f.sub ? `/${f.sub}` : ''}`;

/** The folder's display name (its last path segment). */
export const folderDisplayName = (ref: string) => {
  const f = parseFolder(ref);
  if (!f) return ref;
  return f.sub ? f.sub.split('/').pop()! : f.rootName;
};

/** Whether a photo at `path` inside saved folder `dirId` is inside folder `ref`. */
export function containsFile(ref: string, dirId: string, path: string): boolean {
  const f = parseFolder(ref);
  if (!f || f.kind !== 'dir' || f.id !== dirId) return false;
  return !f.sub || path === f.sub || path.startsWith(`${f.sub}/`);
}

/** One photo file found in a folder. `path` is relative to the saved folder's root. */
export interface FoundFile {
  name: string;
  path: string;
  file: () => Promise<File>;
}

// Files the file input handed over, by pick id. They live as long as the page.
const picks = new Map<string, { name: string; files: File[] }>();
let pickCounter = 0;

/** Register files from `<input webkitdirectory>` (or a drop) and get a folder reference for them. */
export function registerPick(files: File[]): string {
  const photos = files.filter((f) => isSupported(f.name));
  const first = files[0] as (File & { webkitRelativePath?: string }) | undefined;
  const name = first?.webkitRelativePath?.split('/')[0] || (files.length === 1 ? first!.name : `${photos.length} photos`);
  const id = `p${Date.now().toString(36)}${(pickCounter++).toString(36)}`;
  picks.set(id, { name, files: photos });
  return folderRef({ kind: 'pick', id, rootName: name.replace(/[/]/g, '-'), sub: '' });
}

export class Folders {
  constructor(private store: BrowserStore) {}

  /** Ask for a folder with the browser's picker and save the handle. Null if cancelled. */
  async pickDirectory(): Promise<string | null> {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: 'photobook-photos', mode: 'read' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
    return this.saveHandle(handle);
  }

  /** Save a directory handle (reusing the record if this folder was chosen before). */
  async saveHandle(handle: FileSystemDirectoryHandle): Promise<string> {
    for (const d of await this.store.listDirs()) {
      if (await d.handle.isSameEntry(handle).catch(() => false)) return folderRef({ kind: 'dir', id: d.id, rootName: d.name, sub: '' });
    }
    const id = crypto.randomUUID();
    await this.store.putDir({ id, name: handle.name, handle, addedAt: new Date().toISOString() });
    return folderRef({ kind: 'dir', id, rootName: handle.name, sub: '' });
  }

  async handle(dirId: string): Promise<FileSystemDirectoryHandle | null> {
    return (await this.store.getDir(dirId))?.handle ?? null;
  }

  /** Read permission on a saved folder. `ask` shows the browser's prompt (needs a click). */
  async permission(dirId: string, ask = false): Promise<Permission> {
    const h = (await this.handle(dirId)) as (FileSystemDirectoryHandle & PermissionHandle) | null;
    if (!h) return 'denied';
    if (!h.queryPermission) return 'granted';
    const state = await h.queryPermission({ mode: 'read' });
    if (state === 'granted' || !ask || !h.requestPermission) return state;
    try {
      return await h.requestPermission({ mode: 'read' });
    } catch {
      return state;
    }
  }

  /** The directory a reference points to, or null if it's gone or not readable now. */
  async directory(ref: FolderRef): Promise<FileSystemDirectoryHandle | null> {
    if (ref.kind !== 'dir') return null;
    if ((await this.permission(ref.id)) !== 'granted') return null;
    let dir = await this.handle(ref.id);
    try {
      for (const part of ref.sub ? ref.sub.split('/') : []) dir = await dir!.getDirectoryHandle(part);
      // Touch it: a deleted folder's handle only fails when used.
      for await (const _ of (dir as unknown as DirEntries).entries()) break;
      return dir;
    } catch {
      return null;
    }
  }

  /** Whether a folder can be read right now. */
  async readable(refString: string): Promise<boolean> {
    const ref = parseFolder(refString);
    if (!ref) return false;
    if (ref.kind === 'pick') return picks.has(ref.id);
    return !!(await this.directory(ref));
  }

  /** Every photo in a folder (and its subfolders when `recursive`), in name order. */
  async list(refString: string, recursive = true): Promise<FoundFile[]> {
    const ref = parseFolder(refString);
    if (!ref) throw new Error('Choose a folder to import');
    if (ref.kind === 'pick') {
      const pick = picks.get(ref.id);
      if (!pick) throw new Error('Those files are no longer available. Choose the folder again.');
      return pick.files
        .map((f) => {
          const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          return { name: f.name, path, file: async () => f };
        })
        .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    }
    const dir = await this.directory(ref);
    if (!dir) throw new Error(`Can't read the folder “${folderDisplayName(refString)}”. Allow access when the browser asks, or choose it again.`);
    const out: FoundFile[] = [];
    const walk = async (d: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, h] of (d as unknown as DirEntries).entries()) {
        if (name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${name}` : name;
        if (h.kind === 'directory' && recursive) await walk(h as FileSystemDirectoryHandle, path);
        else if (h.kind === 'file' && isSupported(name)) out.push({ name, path, file: () => (h as FileSystemFileHandle).getFile() });
      }
    };
    await walk(dir, ref.sub);
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  /** Subfolders directly inside a folder, and the photos directly in it. */
  async children(refString: string): Promise<{ folders: { name: string; ref: string }[]; photos: FoundFile[] }> {
    const ref = parseFolder(refString);
    const dir = ref && (await this.directory(ref));
    if (!ref || !dir) throw new Error('Folder not found');
    const folders: { name: string; ref: string }[] = [];
    const photos: FoundFile[] = [];
    for await (const [name, h] of (dir as unknown as DirEntries).entries()) {
      if (name.startsWith('.')) continue;
      const path = ref.sub ? `${ref.sub}/${name}` : name;
      if (h.kind === 'directory') folders.push({ name, ref: folderRef({ ...ref, sub: path }) });
      else if (isSupported(name)) photos.push({ name, path, file: () => (h as FileSystemFileHandle).getFile() });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { folders, photos };
  }

  /** A file inside a saved folder, or null if it's gone or the folder isn't readable now. */
  async file(dirId: string, path: string): Promise<File | null> {
    if ((await this.permission(dirId)) !== 'granted') return null;
    let dir = await this.handle(dirId);
    if (!dir) return null;
    const parts = path.split('/');
    try {
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      return await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    } catch {
      return null;
    }
  }
}
