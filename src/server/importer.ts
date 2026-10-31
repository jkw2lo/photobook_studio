import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './db';
import { analyze, existingThumb, fileStat, hashFile, isSupported, makeThumbnails, orientedSize, readMetadata, workingFile } from './media';

// Background import jobs. The HTTP request returns immediately with a job id; the UI polls progress
// and sees photos appear as they finish. A bounded worker pool keeps memory flat for large folders.

export interface ImportJob {
  id: string;
  projectId: string;
  /** 'import' reads one folder; 'sync' re-reads the project's linked folders. */
  kind: 'import' | 'sync';
  folder: string;
  folders: string[];
  status: 'scanning' | 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  imported: number;
  alreadyInLibrary: number;
  /** Exact copies of a photo already in the library (or met earlier in this job): skipped, not imported. */
  exactDuplicates: number;
  /** Photos taken out of this library earlier: a refresh leaves them out. */
  dismissed: number;
  /** Photos found at a new path (moved or renamed): same photo, nothing re-imported. */
  moved: number;
  /** Photos whose file left a linked folder and that aren't on any page: taken out of the library. */
  removed: number;
  /** Linked folders that weren't there (renamed, deleted, or on a drive that isn't plugged in). */
  missingFolders: string[];
  failed: number;
  errors: { file: string; error: string }[];
  startedAt: string;
  finishedAt?: string;
}

const CONCURRENCY = 4;

export async function scanFolder(folder: string, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory() && recursive) await walk(p);
      else if (e.isFile() && isSupported(p)) out.push(p);
    }
  };
  await walk(folder);
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export const resolveFolder = (input: string) => resolve(input.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));

/** Whether `path` is inside `folder` (or is it). */
export const isInside = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

export class Importer {
  private jobs = new Map<string, ImportJob>();
  /** One job at a time per project, so an import and a sync never catalogue the same file twice. */
  private queues = new Map<string, Promise<void>>();
  private syncing = new Map<string, ImportJob>();
  /** Per running job: the project's photos when it began, and what it added by contents (copies
   * inside one job are settled when it ends, so the choice doesn't depend on which file is read first). */
  private jobState = new Map<string, { before: Set<string>; added: Map<string, { id: string; path: string; how: 'imported' | 'linked' }[]> }>();
  /** Content hashes by path, so unchanged duplicates skipped on every refresh aren't re-read each time. */
  private hashes = new Map<string, { size: number; mtimeMs: number; hash: string }>();

  constructor(private store: Store) {}

  get(id: string) {
    return this.jobs.get(id);
  }

  start(projectId: string, folderInput: string, recursive = true): ImportJob {
    const folder = resolveFolder(folderInput);
    // Importing on purpose brings back photos taken out of the library from this folder.
    this.store.undismissFolder(projectId, folder);
    const job = this.newJob(projectId, 'import', [folder]);
    this.enqueue(job, () => this.run(job, recursive));
    return job;
  }

  /**
   * Re-read the project's linked folders: add new photos, follow moved ones, and drop photos whose
   * file is gone — unless they're on a page (`inUse`), where they stay and show as missing.
   * A sync of the same folders already queued or running for the project is returned instead of
   * starting another.
   */
  sync(projectId: string, folders: string[], inUse: Set<string>): ImportJob {
    const pending = this.syncing.get(projectId);
    if (pending && pending.status !== 'done' && pending.status !== 'failed' && folders.every((f) => pending.folders.includes(f))) return pending;
    const job = this.newJob(projectId, 'sync', folders);
    this.syncing.set(projectId, job);
    this.enqueue(job, async () => {
      job.missingFolders = folders.filter((f) => !existsSync(f));
      await this.run(job, true, () => {
        for (const f of folders) if (!job.missingFolders.includes(f)) this.store.markLinkSynced(projectId, f);
        this.dropGone(job, inUse);
      });
    });
    return job;
  }

  private newJob(projectId: string, kind: ImportJob['kind'], folders: string[]): ImportJob {
    const job: ImportJob = {
      id: randomUUID(), projectId, kind, folder: folders.length === 1 ? folders[0] : `${folders.length} linked folders`, folders,
      status: 'scanning', total: 0, processed: 0, imported: 0, alreadyInLibrary: 0, exactDuplicates: 0, dismissed: 0, moved: 0, removed: 0,
      missingFolders: [], failed: 0, errors: [], startedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private enqueue(job: ImportJob, work: () => Promise<void>) {
    const next = (this.queues.get(job.projectId) ?? Promise.resolve()).then(work, work);
    this.queues.set(job.projectId, next.catch(() => undefined));
  }

  /** Resolves when the job finishes (used by tests and scripts). */
  async wait(id: string): Promise<ImportJob> {
    for (;;) {
      const job = this.jobs.get(id)!;
      if (job.status === 'done' || job.status === 'failed') return job;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** `finish` runs after every file is read, before the job reports done. */
  private async run(job: ImportJob, recursive: boolean, finish?: () => void) {
    this.jobState.set(job.id, { before: new Set(this.store.projectAssetRows(job.projectId).map((r) => r.id)), added: new Map() });
    try {
      const files: string[] = [];
      for (const folder of job.folders) {
        if (!existsSync(folder)) {
          if (job.kind === 'sync') continue;
          throw new Error(`Folder not found: ${folder}`);
        }
        files.push(...(await scanFolder(folder, recursive)));
      }
      job.total = files.length;
      job.status = 'running';
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const file = files[next++];
          try {
            await this.importOne(job, file);
          } catch (e) {
            job.failed++;
            job.errors.push({ file: basename(file), error: e instanceof Error ? e.message : String(e) });
          }
          job.processed++;
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      this.settleCopies(job);
      finish?.();
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.errors.push({ file: job.folder, error: e instanceof Error ? e.message : String(e) });
    }
    this.jobState.delete(job.id);
    job.finishedAt = new Date().toISOString();
  }

  private async hashOf(path: string, st: { size: number; mtimeMs: number }): Promise<string> {
    const cached = this.hashes.get(path);
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.hash;
    const hash = await hashFile(path);
    this.hashes.set(path, { size: st.size, mtimeMs: st.mtimeMs, hash });
    return hash;
  }

  private async importOne(job: ImportJob, path: string) {
    if (job.kind === 'sync' && this.store.isDismissed(job.projectId, path)) {
      job.dismissed++;
      return;
    }
    const st = await fileStat(path);
    const existing = this.store.assetByPath(path);
    const dataDir = this.store.dataDir;
    const unchanged = !!existing && existing.file_size === st.size && existing.mtime_ms === st.mtimeMs && !!existingThumb(dataDir, existing.id, 's');
    const inProject = !!existing && this.store.inProject(job.projectId, existing.id);
    // Already in this library: nothing to do.
    if (unchanged && inProject) {
      job.alreadyInLibrary++;
      return;
    }
    const contentHash = unchanged ? existing!.content_hash : await this.hashOf(path, st);
    // The same picture was already in this library from another file (a copy): show it once, don't
    // import it again.
    const state = this.jobState.get(job.id)!;
    const copyInProject = !inProject && this.store.projectAssetsWithHash(job.projectId, contentHash).some((a) => state.before.has(a.id) && a.original_path !== path && existsSync(a.original_path));
    if (copyInProject) {
      job.exactDuplicates++;
      return;
    }
    const added = (id: string, how: 'imported' | 'linked') => {
      if (!inProject) state.added.set(contentHash, [...(state.added.get(contentHash) ?? []), { id, path, how }]);
    };
    if (unchanged) {
      this.store.linkAsset(job.projectId, existing!.id);
      job.alreadyInLibrary++;
      added(existing!.id, 'linked');
      return;
    }
    if (!existing) {
      // The same photo whose old file is gone: it was moved or renamed. Follow it, keeping its place on pages.
      const moved = this.store.projectAssetsWithHash(job.projectId, contentHash).find((a) => !existsSync(a.original_path));
      if (moved) {
        this.store.relocateAsset(moved.id, path);
        job.moved++;
        return;
      }
    }
    const id = existing?.id ?? randomUUID();
    const work = await workingFile(path, dataDir, contentHash);
    const [size, meta, analysis] = await Promise.all([orientedSize(work.path), readMetadata(path), analyze(work.path)]);
    await makeThumbnails(work.path, dataDir, id, !!analysis.transparent);
    const dup = this.store.firstAssetWithHash(contentHash, id);
    this.store.tx(() => {
      this.store.upsertAsset({
        id,
        original_path: path,
        file_name: basename(path),
        format: extname(path).slice(1).toLowerCase() === 'jpg' ? 'jpeg' : extname(path).slice(1).toLowerCase(),
        file_size: st.size,
        mtime_ms: st.mtimeMs,
        content_hash: contentHash,
        width: size.width,
        height: size.height,
        captured_at: meta.capturedAt,
        gps_lat: meta.gpsLat,
        gps_lon: meta.gpsLon,
        rating: existing?.rating ?? 0,
        favorite: existing?.favorite ?? 0,
        tags: existing?.tags ?? '[]',
        analysis: JSON.stringify(analysis),
        derived_path: work.derived,
        exact_duplicate_of: dup?.id ?? null,
        imported_at: existing?.imported_at ?? new Date().toISOString(),
      });
      this.store.linkAsset(job.projectId, id);
    });
    job.imported++;
    added(id, existing ? 'linked' : 'imported');
  }

  /**
   * Copies of one photo added by this job: keep one — already catalogued first, then the shorter
   * name ("IMG_1.jpg" over "IMG_1 copy.jpg"), then by path — and drop the rest.
   */
  private settleCopies(job: ImportJob) {
    const state = this.jobState.get(job.id);
    if (!state) return;
    const drop: string[] = [];
    for (const group of state.added.values()) {
      if (group.length < 2) continue;
      const [, ...rest] = [...group].sort((a, b) => Number(a.how === 'imported') - Number(b.how === 'imported') || basename(a.path).length - basename(b.path).length || a.path.localeCompare(b.path));
      for (const r of rest) {
        drop.push(r.id);
        job.exactDuplicates++;
        if (r.how === 'imported') job.imported--;
        else job.alreadyInLibrary--;
      }
    }
    if (drop.length) this.store.dropCopies(job.projectId, drop);
  }

  private dropGone(job: ImportJob, inUse: Set<string>) {
    const folders = job.folders.filter((f) => !job.missingFolders.includes(f));
    this.store.tx(() => {
      for (const r of this.store.projectAssetRows(job.projectId)) {
        if (inUse.has(r.id) || !folders.some((f) => isInside(r.original_path, f)) || existsSync(r.original_path)) continue;
        this.store.unlinkAsset(job.projectId, r.id);
        job.removed++;
      }
    });
  }
}
