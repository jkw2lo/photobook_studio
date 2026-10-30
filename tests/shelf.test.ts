// The Shelf (a shared folder offered to every book) and linked folders: linking imports a folder,
// and every sync adds new photos, follows moved ones and drops deleted ones that aren't on a page.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';

const FIXTURES = join(process.cwd(), 'fixtures', 'generated', 'trip');

describe.runIf(existsSync(FIXTURES))('shelf and linked folders (API)', () => {
  let dataDir: string;
  let shelf: string;
  let outside: string;
  let server: Server;
  let base: string;
  let closeStore: () => void;
  let projectId: string;

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
  const sync = async (inUse: string[] = []) => finish((await api('POST', `/api/projects/${projectId}/links/sync`, { inUse })).body.job);
  const links = async () => (await api('GET', `/api/projects/${projectId}/links`)).body as { folder: string; name: string; exists: boolean; onShelf: boolean; assetIds: string[] }[];
  const put = (name: string, dir: string, as = name) => copyFileSync(join(FIXTURES, name), join(dir, as));

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'shelf-data-'));
    const tmp = mkdtempSync(join(tmpdir(), 'shelf-'));
    shelf = join(tmp, 'Studio Shelf');
    outside = join(tmp, 'elsewhere');
    mkdirSync(outside);
    put('day1-01-arrival.jpg', outside);
    const { app, store } = createApp(dataDir);
    // Point the shelf at a folder that doesn't exist yet (as on a first run).
    store.setSetting('shelf_root', shelf);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeStore = () => store.close();
    projectId = (await api('POST', '/api/projects', { title: 'Souvenirs', product: 'poster', sizeId: 'p11x14' })).body.doc.id;
  });
  afterAll(() => {
    server?.close();
    closeStore?.();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(join(shelf, '..'), { recursive: true, force: true });
  });

  it('lists the shelf, creating it on request, and only serves previews from inside it', async () => {
    const missing = (await api('GET', '/api/shelf')).body;
    expect(missing).toMatchObject({ root: shelf, exists: false, folders: [] });

    expect((await api('POST', '/api/shelf/create')).body.exists).toBe(true);
    mkdirSync(join(shelf, 'Receipts'));
    mkdirSync(join(shelf, 'Okinawa', 'Tickets'), { recursive: true });
    put('day1-02-street.jpg', join(shelf, 'Receipts'));
    put('day1-04-lunch.jpg', join(shelf, 'Receipts'));
    put('day2-04-lake.jpg', join(shelf, 'Okinawa', 'Tickets'));

    const top = (await api('GET', '/api/shelf')).body;
    expect(top.parent).toBeNull();
    expect(top.folders.map((f: any) => [f.name, f.photos, f.subfolders])).toEqual([['Okinawa', 1, 1], ['Receipts', 2, 0]]);
    expect(top.folders[1].previews).toHaveLength(2);

    const inner = (await api('GET', `/api/shelf?path=${encodeURIComponent(join(shelf, 'Okinawa'))}`)).body;
    expect(inner.parent).toBe(shelf);
    expect(inner.folders.map((f: any) => f.name)).toEqual(['Tickets']);

    expect((await api('GET', `/api/shelf?path=${encodeURIComponent(outside)}`)).status).toBe(404);
    const preview = await fetch(`${base}/api/shelf/preview?path=${encodeURIComponent(top.folders[1].previews[0])}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('image/webp');
    expect((await fetch(`${base}/api/shelf/preview?path=${encodeURIComponent(join(outside, 'day1-01-arrival.jpg'))}`)).status).toBe(404);
    expect((await fetch(`${base}/api/shelf/preview?path=${encodeURIComponent(join(shelf, '..', 'elsewhere', 'day1-01-arrival.jpg'))}`)).status).toBe(404);
  });

  it('links a folder, then each sync adds new photos, follows moved ones and drops deleted unused ones', async () => {
    const receipts = join(shelf, 'Receipts');
    const linked = await finish((await api('POST', `/api/projects/${projectId}/links`, { folder: receipts })).body);
    expect(linked.imported).toBe(2);
    let [l] = await links();
    expect(l).toMatchObject({ folder: receipts, name: 'Receipts', exists: true, onShelf: true });
    expect(l.assetIds).toHaveLength(2);

    // Nothing changed: nothing re-imported.
    expect(await sync()).toMatchObject({ kind: 'sync', imported: 0, alreadyInLibrary: 2, moved: 0, removed: 0 });

    put('day3-01-cafe.jpg', receipts);
    expect((await sync()).imported).toBe(1);

    // Renamed: the same photo (same id), not a new one plus a missing one.
    const before = (await api('GET', `/api/projects/${projectId}/assets`)).body as { id: string; fileName: string }[];
    const street = before.find((a) => a.fileName === 'day1-02-street.jpg')!;
    renameSync(join(receipts, 'day1-02-street.jpg'), join(receipts, 'receipt-street.jpg'));
    expect(await sync()).toMatchObject({ imported: 0, moved: 1, removed: 0 });
    let assets = (await api('GET', `/api/projects/${projectId}/assets`)).body as { id: string; fileName: string; missing: boolean }[];
    expect(assets.find((a) => a.id === street.id)).toMatchObject({ fileName: 'receipt-street.jpg', missing: false });
    expect(assets).toHaveLength(3);

    // Deleted: unused photos leave the library; one on a page stays and shows as missing.
    const lunch = assets.find((a) => a.fileName === 'day1-04-lunch.jpg')!;
    rmSync(join(receipts, 'day1-04-lunch.jpg'));
    rmSync(join(receipts, 'receipt-street.jpg'));
    expect((await sync([lunch.id])).removed).toBe(1);
    assets = (await api('GET', `/api/projects/${projectId}/assets`)).body;
    expect(assets.map((a) => a.fileName).sort()).toEqual(['day1-04-lunch.jpg', 'day3-01-cafe.jpg']);
    expect(assets.find((a) => a.id === lunch.id)!.missing).toBe(true);
  });

  it('never drops photos when a linked folder is missing, and unlinking keeps the photos', async () => {
    const receipts = join(shelf, 'Receipts');
    const away = join(shelf, 'Receipts (renamed)');
    renameSync(receipts, away);
    const job = await sync();
    expect(job.missingFolders).toEqual([receipts]);
    expect(job.removed).toBe(0);
    expect((await links())[0].exists).toBe(false);
    renameSync(away, receipts);

    // A folder off the shelf can be linked too.
    await finish((await api('POST', `/api/projects/${projectId}/links`, { folder: outside })).body);
    expect((await links()).map((l) => [l.name, l.onShelf])).toEqual([['Receipts', true], ['elsewhere', false]]);

    const count = (await api('GET', `/api/projects/${projectId}/assets`)).body.length;
    const after = (await api('DELETE', `/api/projects/${projectId}/links?folder=${encodeURIComponent(receipts)}`)).body;
    expect(after.map((l: { name: string }) => l.name)).toEqual(['elsewhere']);
    expect((await api('GET', `/api/projects/${projectId}/assets`)).body).toHaveLength(count);
    expect((await api('DELETE', `/api/projects/${projectId}/links?folder=${encodeURIComponent(receipts)}`)).status).toBe(404);
  });

  it('refuses to link a folder that does not exist', async () => {
    expect((await api('POST', `/api/projects/${projectId}/links`, { folder: join(shelf, 'Nope') })).status).toBe(400);
  });
});
