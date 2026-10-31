import type { ImportJob } from '../types';
import { sourceKey, type AssetRecord, type AssetSource, type BrowserStore } from './db';
import { containsFile, folderDisplayName, parseFolder, type Folders, type FoundFile } from './folders';
import type { ProcessedPhoto } from './media.worker';
import { WorkerPool } from './pool';

// Import jobs in the browser, following src/server/importer.ts: the call returns a job at once,
// the UI polls it, and photos appear as they finish. Decoding and analysis run in a few workers.

export interface BrowserImportJob extends ImportJob {
  projectId: string;
  folders: string[];
  startedAt: string;
  finishedAt?: string;
}

const formatOf = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'jpg' ? 'jpeg' : ext;
};

export class BrowserImporter {
  private jobs = new Map<string, BrowserImportJob>();
  private queues = new Map<string, Promise<void>>();
  private syncing = new Map<string, BrowserImportJob>();
  private pool: WorkerPool | null = null;
  /** Duplicate checks and catalogue writes happen one at a time, so two copies are always flagged. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private store: BrowserStore, private folders: Folders, private onAssetsChanged: (ids: string[]) => void = () => undefined) {}

  private workers() {
    const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    return (this.pool ??= new WorkerPool(() => new Worker(new URL('./media.worker.ts', import.meta.url), { type: 'module' }), size));
  }

  /** Run in a media worker (also used for shelf previews). */
  media<T>(method: string, ...args: unknown[]) {
    return this.workers().call<T>(method, ...args);
  }

  get(id: string): ImportJob | undefined {
    const j = this.jobs.get(id);
    return j && structuredClone(j);
  }

  start(projectId: string, folder: string): ImportJob {
    const job = this.newJob(projectId, 'import', [folder]);
    this.enqueue(job, () => this.run(job));
    return structuredClone(job);
  }

  /**
   * Re-read the project's linked folders: add new photos, follow moved ones, drop photos whose file
   * is gone unless they're on a page (`inUse`). Folders this browser can't read right now (no
   * permission yet after a restart, or deleted) are reported in `missingFolders` and left alone.
   */
  sync(projectId: string, folders: string[], inUse: Set<string>): ImportJob {
    const pending = this.syncing.get(projectId);
    if (pending && pending.status !== 'done' && pending.status !== 'failed') return structuredClone(pending);
    const job = this.newJob(projectId, 'sync', folders);
    this.syncing.set(projectId, job);
    this.enqueue(job, async () => {
      const readable = await Promise.all(folders.map((f) => this.folders.readable(f)));
      job.missingFolders = folders.filter((_, i) => !readable[i]);
      await this.run(job, async () => {
        for (const f of folders) if (!job.missingFolders.includes(f)) await this.store.markLinkSynced(projectId, f);
        await this.dropGone(job, inUse);
      });
    });
    return structuredClone(job);
  }

  private newJob(projectId: string, kind: ImportJob['kind'], folders: string[]): BrowserImportJob {
    const job: BrowserImportJob = {
      id: crypto.randomUUID(), projectId, kind, folder: folders.length === 1 ? folderDisplayName(folders[0]) : `${folders.length} linked folders`, folders,
      status: 'scanning', total: 0, processed: 0, imported: 0, alreadyInLibrary: 0, exactDuplicates: 0, moved: 0, removed: 0,
      missingFolders: [], failed: 0, errors: [], startedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  private enqueue(job: BrowserImportJob, work: () => Promise<void>) {
    const next = (this.queues.get(job.projectId) ?? Promise.resolve()).then(work, work);
    this.queues.set(job.projectId, next.catch(() => undefined));
  }

  /** Resolves when the job finishes (tests). */
  async wait(id: string): Promise<ImportJob> {
    for (;;) {
      const job = this.jobs.get(id)!;
      if (job.status === 'done' || job.status === 'failed') return structuredClone(job);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async run(job: BrowserImportJob, finish?: () => Promise<void>) {
    try {
      const files: { folder: string; f: FoundFile }[] = [];
      for (const folder of job.folders) {
        if (job.missingFolders.includes(folder)) continue;
        files.push(...(await this.folders.list(folder)).map((f) => ({ folder, f })));
      }
      job.total = files.length;
      job.status = 'running';
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const { folder, f } = files[next++];
          try {
            await this.importOne(job, folder, f);
          } catch (e) {
            job.failed++;
            job.errors.push({ file: f.name, error: e instanceof Error ? e.message : String(e) });
          }
          job.processed++;
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      await finish?.();
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.errors.push({ file: job.folder, error: e instanceof Error ? e.message : String(e) });
    }
    job.finishedAt = new Date().toISOString();
  }

  private async importOne(job: BrowserImportJob, folder: string, found: FoundFile) {
    const ref = parseFolder(folder)!;
    const file = await found.file();
    // A saved folder is referenced in place; files handed over by the file input are copied in.
    const source: AssetSource = ref.kind === 'dir' ? { kind: 'dir', dirId: ref.id, path: found.path } : { kind: 'copy' };
    const existing = source.kind === 'dir' ? await this.store.assetBySourceKey(sourceKey('', source)) : undefined;
    const mtimeMs = Math.round(file.lastModified);
    // Unchanged file already catalogued: just add it to this project.
    if (existing && existing.fileSize === file.size && existing.mtimeMs === mtimeMs && (await this.store.getThumb(existing.id, 's'))) {
      await this.store.linkAsset(job.projectId, existing.id);
      job.alreadyInLibrary++;
      return;
    }
    const contentHash = await this.media<string>('hash', file);
    if (source.kind === 'copy') {
      // The same file copied in before (same name and contents): nothing new to store.
      const twin = (await this.store.assetsWithHash(contentHash)).find((a) => a.source.kind === 'copy' && a.fileName === found.name);
      if (twin) {
        await this.store.linkAsset(job.projectId, twin.id);
        job.alreadyInLibrary++;
        return;
      }
    } else if (!existing) {
      // The same photo whose old file is gone: it was moved or renamed. Follow it, keeping its place on pages.
      for (const a of await this.store.projectAssetsWithHash(job.projectId, contentHash)) {
        if (a.source.kind !== 'dir' || (await this.exists(a))) continue;
        await this.store.relocateAsset(a.id, source, found.name);
        job.moved++;
        return;
      }
    }
    const id = existing?.id ?? crypto.randomUUID();
    const format = formatOf(found.name);
    const p = await this.media<ProcessedPhoto>('process', file, found.name, format);
    const save = async () => {
      const dup = await this.store.firstAssetWithHash(contentHash, id);
      const rec: AssetRecord = {
        id,
        source,
        sourceKey: sourceKey(id, source),
        fileName: found.name,
        format,
        fileSize: file.size,
        mtimeMs,
        contentHash,
        width: p.width,
        height: p.height,
        capturedAt: p.capturedAt,
        gpsLat: p.gpsLat,
        gpsLon: p.gpsLon,
        rating: existing?.rating ?? 0,
        favorite: existing?.favorite ?? false,
        tags: existing?.tags ?? [],
        analysis: p.analysis,
        exactDuplicateOf: dup?.id ?? null,
        importedAt: existing?.importedAt ?? new Date().toISOString(),
      };
      await this.store.saveImported(job.projectId, rec, { thumbs: { s: p.thumbS, m: p.thumbM }, original: source.kind === 'copy' ? file : undefined });
      this.onAssetsChanged([id]);
      if (dup) job.exactDuplicates++;
      job.imported++;
    };
    const turn = this.writing.then(save);
    this.writing = turn.catch(() => undefined);
    await turn;
  }

  /** Whether a photo's original can be read (unknown → assumed present). */
  async exists(a: AssetRecord): Promise<boolean> {
    if (a.source.kind === 'copy') return this.store.hasOriginal(a.id);
    if ((await this.folders.permission(a.source.dirId)) !== 'granted') return true;
    return !!(await this.folders.file(a.source.dirId, a.source.path));
  }

  private async dropGone(job: BrowserImportJob, inUse: Set<string>) {
    const folders = job.folders.filter((f) => !job.missingFolders.includes(f));
    const gone: string[] = [];
    for (const r of await this.store.projectAssetRows(job.projectId)) {
      if (inUse.has(r.id) || r.source.kind !== 'dir') continue;
      const { dirId, path } = r.source;
      if (!folders.some((f) => containsFile(f, dirId, path))) continue;
      if (await this.folders.file(dirId, path)) continue;
      gone.push(r.id);
    }
    for (const id of gone) await this.store.unlinkAsset(job.projectId, id);
    job.removed += gone.length;
  }
}
