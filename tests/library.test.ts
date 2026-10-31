// Library housekeeping: exact copies are shown once and never imported twice, photos can be taken
// out of the library (and stay out when their folder is refreshed), and folders imported once are
// remembered so they can be refreshed.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PhotoAsset } from '../src/core';
import { createApp } from '../src/server/app';
import type { Store } from '../src/server/db';

const FIXTURES = join(process.cwd(), 'fixtures', 'generated', 'trip');

describe.runIf(existsSync(FIXTURES))('library housekeeping (API)', () => {
  let dataDir: string;
  let tmp: string;
  let server: Server;
  let base: string;
  let store: Store;

  const api = async <T = any>(method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  };
  const finish = async (job: any) => {
    let st = job;
    while (st.status !== 'done' && st.status !== 'failed') {
      await new Promise((r) => setTimeout(r, 40));
      st = (await api('GET', `/api/jobs/${job.id}`)).body;
    }
    return st;
  };
  const newProject = async () => (await api('POST', '/api/projects', { title: 'Lib', product: 'poster', sizeId: 'p11x14' })).body.doc.id as string;
  const importDir = async (pid: string, folder: string) => finish((await api('POST', `/api/projects/${pid}/import`, { folder })).body);
  const assets = async (pid: string) => (await api<PhotoAsset[]>('GET', `/api/projects/${pid}/assets`)).body;
  const dir = (name: string, files: [string, string?][]) => {
    const d = join(tmp, name);
    mkdirSync(d, { recursive: true });
    for (const [f, as] of files) copyFileSync(join(FIXTURES, f), join(d, as ?? f));
    return d;
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'lib-data-'));
    tmp = mkdtempSync(join(tmpdir(), 'lib-'));
    const created = createApp(dataDir);
    store = created.store;
    await new Promise<void>((r) => (server = created.app.listen(0, '127.0.0.1', () => r())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server?.close();
    store?.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('skips copies of photos already in the library, from another folder or the same one', async () => {
    const pid = await newProject();
    const a = dir('a', [['day1-01-arrival.jpg'], ['day1-02-street.jpg']]);
    const b = dir('b', [['day1-01-arrival.jpg', 'arrival-copy.jpg'], ['day1-04-lunch.jpg']]);
    expect(await importDir(pid, a)).toMatchObject({ imported: 2, exactDuplicates: 0 });
    expect(await importDir(pid, b)).toMatchObject({ imported: 1, exactDuplicates: 1 });
    expect(await importDir(pid, a)).toMatchObject({ imported: 0, alreadyInLibrary: 2, exactDuplicates: 0 });
    const list = await assets(pid);
    expect(list.map((x) => x.fileName).sort()).toEqual(['day1-01-arrival.jpg', 'day1-02-street.jpg', 'day1-04-lunch.jpg']);
  });

  it('flags duplicates per project, never two copies against each other', async () => {
    // Two copies catalogued in one project (as older versions did), and a third project with only one.
    const both = await newProject();
    const only = await newProject();
    const d = dir('pair', [['day2-04-lake.jpg'], ['day2-04-lake.jpg', 'day2-04-lake copy.jpg']]);
    await importDir(both, d);
    const [orig] = await assets(both);
    // Simulate the old catalogue: the copy also imported, and each copy pointing at the other.
    const copyPath = join(d, 'day2-04-lake copy.jpg');
    const row = store.assetById(orig.id)!;
    store.upsertAsset({ ...row, id: 'copy-1', original_path: copyPath, file_name: 'day2-04-lake copy.jpg', exact_duplicate_of: orig.id });
    store.linkAsset(both, 'copy-1');
    store.upsertAsset({ ...row, exact_duplicate_of: 'copy-1' });
    store.linkAsset(only, 'copy-1');

    const listed = await assets(both);
    expect(listed).toHaveLength(2);
    expect(listed.filter((x) => x.exactDuplicateOf)).toHaveLength(1);
    // Alone in its project, the copy is not a duplicate of anything.
    expect((await assets(only)).map((x) => x.exactDuplicateOf)).toEqual([null]);
  });

  it('removes photos from the library, keeps ones on pages, and a refresh leaves them out', async () => {
    const pid = await newProject();
    const d = dir('trip-r', [['day1-01-arrival.jpg'], ['day1-02-street.jpg'], ['day1-04-lunch.jpg']]);
    await importDir(pid, d);
    const list = await assets(pid);
    const [keep, ...rest] = list;
    const res = await api('POST', `/api/projects/${pid}/assets/remove`, { ids: list.map((x) => x.id), inUse: [keep.id] });
    expect(res.body).toEqual({ removed: 2, keptOnPages: 1 });
    expect((await assets(pid)).map((x) => x.id)).toEqual([keep.id]);
    // The imported folder is remembered; refreshing it doesn't bring the removed photos back.
    const links = (await api('GET', `/api/projects/${pid}/links`)).body as { folder: string; auto: boolean }[];
    expect(links).toEqual([expect.objectContaining({ folder: d, auto: false })]);
    expect((await api('POST', `/api/projects/${pid}/links/sync`, { inUse: [] })).body.job).toBeNull();
    const refreshed = await finish((await api('POST', `/api/projects/${pid}/links/sync`, { inUse: [], folders: [d] })).body.job);
    expect(refreshed).toMatchObject({ imported: 0, dismissed: 2 });
    expect(await assets(pid)).toHaveLength(1);
    // Importing the folder on purpose brings them back.
    await importDir(pid, d);
    expect(await assets(pid)).toHaveLength(3);
    void rest;
  });

  it('refreshing an imported folder picks up new photos', async () => {
    const pid = await newProject();
    const d = dir('grow', [['day1-01-arrival.jpg']]);
    await importDir(pid, d);
    copyFileSync(join(FIXTURES, 'day2-04-lake.jpg'), join(d, 'day2-04-lake.jpg'));
    const job = await finish((await api('POST', `/api/projects/${pid}/links/sync`, { inUse: [], folders: [d] })).body.job);
    expect(job.imported).toBe(1);
    expect(await assets(pid)).toHaveLength(2);
  });
});
