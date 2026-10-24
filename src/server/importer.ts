import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from './db';
import { analyze, fileStat, hashFile, isSupported, makeThumbnails, orientedSize, readMetadata, thumbPath, workingFile } from './media';

// Background import jobs. The HTTP request returns immediately with a job id; the UI polls progress
// and sees photos appear as they finish. A bounded worker pool keeps memory flat for large folders.

export interface ImportJob {
  id: string;
  projectId: string;
  folder: string;
  status: 'scanning' | 'running' | 'done' | 'failed';
  total: number;
  processed: number;
  imported: number;
  alreadyInLibrary: number;
  exactDuplicates: number;
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

export class Importer {
  private jobs = new Map<string, ImportJob>();

  constructor(private store: Store) {}

  get(id: string) {
    return this.jobs.get(id);
  }

  start(projectId: string, folderInput: string, recursive = true): ImportJob {
    const folder = resolve(folderInput.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    const job: ImportJob = {
      id: randomUUID(), projectId, folder, status: 'scanning', total: 0, processed: 0, imported: 0,
      alreadyInLibrary: 0, exactDuplicates: 0, failed: 0, errors: [], startedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    void this.run(job, recursive);
    return job;
  }

  /** Resolves when the job finishes (used by tests and scripts). */
  async wait(id: string): Promise<ImportJob> {
    for (;;) {
      const job = this.jobs.get(id)!;
      if (job.status === 'done' || job.status === 'failed') return job;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async run(job: ImportJob, recursive: boolean) {
    try {
      if (!existsSync(job.folder)) throw new Error(`Folder not found: ${job.folder}`);
      const files = await scanFolder(job.folder, recursive);
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
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.errors.push({ file: job.folder, error: e instanceof Error ? e.message : String(e) });
    }
    job.finishedAt = new Date().toISOString();
  }

  private async importOne(job: ImportJob, path: string) {
    const st = await fileStat(path);
    const existing = this.store.assetByPath(path);
    const dataDir = this.store.dataDir;
    // Unchanged file already catalogued: just add it to this project.
    if (existing && existing.file_size === st.size && existing.mtime_ms === st.mtimeMs && existsSync(thumbPath(dataDir, existing.id, 's'))) {
      this.store.linkAsset(job.projectId, existing.id);
      job.alreadyInLibrary++;
      return;
    }
    const contentHash = await hashFile(path);
    const id = existing?.id ?? randomUUID();
    const work = await workingFile(path, dataDir, contentHash);
    const [size, meta, analysis] = await Promise.all([orientedSize(work.path), readMetadata(path), analyze(work.path)]);
    await makeThumbnails(work.path, dataDir, id);
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
    if (dup) job.exactDuplicates++;
    job.imported++;
  }
}
