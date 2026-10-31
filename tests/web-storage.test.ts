import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBook } from '../src/core';
import { backupProject, restoreProject } from '../src/web/backend/browser/backup';
import { BrowserStore, sourceKey, type AssetRecord } from '../src/web/backend/browser/db';
import { containsFile, folderDisplayName, folderRef, parseFolder } from '../src/web/backend/browser/folders';

// The web version's IndexedDB store (fake-indexeddb here) must keep the server store's promises:
// optimistic saves, bounded history, Recently deleted, and photos shared between books.

let n = 0;
const open = () => BrowserStore.open(`test-${Date.now()}-${n++}`);

function asset(id: string, over: Partial<AssetRecord> = {}): AssetRecord {
  const source = over.source ?? ({ kind: 'copy' } as const);
  return {
    id, source, sourceKey: sourceKey(id, source), fileName: `${id}.jpg`, format: 'jpeg', fileSize: 10, mtimeMs: 1, contentHash: `hash-${id}`,
    width: 4000, height: 3000, capturedAt: null, gpsLat: null, gpsLon: null, rating: 0, favorite: false, tags: [], analysis: null,
    exactDuplicateOf: null, importedAt: new Date().toISOString(), ...over,
  };
}
const files = () => ({ thumbs: { s: new Blob(['s'], { type: 'image/jpeg' }), m: new Blob(['m'], { type: 'image/jpeg' }) }, original: new Blob(['original-bytes'], { type: 'image/jpeg' }) });

describe('web version storage', () => {
  it('creates, lists and saves projects with optimistic revisions', async () => {
    const store = await open();
    const doc = createBook({ title: 'Trip' });
    expect(await store.createProject(doc)).toEqual({ revision: 1 });
    const [summary] = await store.listProjects();
    expect(summary).toMatchObject({ id: doc.id, title: 'Trip', revision: 1, photoCount: 0, product: 'book', pageCount: (doc.spreads.length - 1) * 2 });
    expect(await store.saveProject({ ...doc, title: 'Trip 2' }, 1)).toEqual({ ok: true, revision: 2 });
    // A stale tab still on revision 1 can't overwrite revision 2.
    expect(await store.saveProject({ ...doc, title: 'Stale' }, 1)).toEqual({ ok: false, currentRevision: 2 });
    expect((await store.getProject(doc.id))!.doc.title).toBe('Trip 2');
    expect((await store.getRevision(doc.id, 1))!.title).toBe('Trip');
  });

  it('keeps the last 50 revisions', async () => {
    const store = await open();
    const doc = createBook({ title: 'History' });
    await store.createProject(doc);
    for (let r = 1; r <= 60; r++) await store.saveProject({ ...doc, title: `v${r}` }, r);
    const revs = await store.listRevisions(doc.id);
    expect(revs).toHaveLength(50);
    expect(revs[0].revision).toBe(61);
    expect(revs.at(-1)!.revision).toBe(12);
  });

  it('moves projects to Recently deleted and purges only photos no other book uses', async () => {
    const store = await open();
    const a = createBook({ title: 'A' });
    const b = createBook({ title: 'B' });
    await store.createProject(a);
    await store.createProject(b);
    await store.saveImported(a.id, asset('shared'), files());
    await store.saveImported(a.id, asset('only-a'), files());
    await store.linkAsset(b.id, 'shared');
    expect(await store.trashProject(a.id)).toBe(true);
    expect((await store.listProjects()).map((p) => p.title)).toEqual(['B']);
    expect((await store.listDeleted()).map((p) => p.id)).toEqual([a.id]);
    expect(await store.restoreProject(a.id)).toBe(true);
    await store.trashProject(a.id);
    const r = await store.purgeProject(a.id);
    expect(r.removedIds).toEqual(['only-a']);
    expect(await store.assetById('only-a')).toBeUndefined();
    expect(await store.getThumb('only-a', 's')).toBeUndefined();
    expect(await store.assetById('shared')).toBeDefined();
    expect((await store.projectAssetRows(b.id)).map((x) => x.id)).toEqual(['shared']);
  });

  it('orders photos like the server (undated first, then by time and name) and keeps user fields', async () => {
    const store = await open();
    const doc = createBook({ title: 'Order' });
    await store.createProject(doc);
    await store.saveImported(doc.id, asset('b', { capturedAt: '2026-03-02T10:00:00', fileName: 'b.jpg' }), files());
    await store.saveImported(doc.id, asset('a', { capturedAt: '2026-03-01T10:00:00', fileName: 'a.jpg' }), files());
    await store.saveImported(doc.id, asset('z', { capturedAt: null, fileName: 'z.png' }), files());
    await store.updateAssetUserFields('a', { rating: 9, favorite: true });
    await store.setExcluded(doc.id, 'b', true);
    const rows = await store.projectAssetRows(doc.id);
    expect(rows.map((r) => r.id)).toEqual(['z', 'a', 'b']);
    expect(rows[1]).toMatchObject({ rating: 5, favorite: true });
    expect(rows[2].excluded).toBe(true);
  });

  it('backs a project up to one file and restores it, photos included', async () => {
    const store = await open();
    const doc = createBook({ title: 'Backed up' });
    await store.createProject(doc);
    await store.saveImported(doc.id, asset('p1'), files());
    await store.saveImported(doc.id, asset('p2', { source: { kind: 'dir', dirId: 'd', path: 'x/p2.jpg' } }), { thumbs: files().thumbs });
    await store.setExcluded(doc.id, 'p1', true);
    const backup = await backupProject(store, doc.id, async (row) => (row.source.kind === 'copy' ? (await store.getOriginal(row.id)) ?? null : null));
    expect(backup.photos).toBe(2);
    expect(backup.withoutOriginal).toBe(1);

    const fresh = await open();
    const restored = await restoreProject(fresh, backup.blob);
    expect(restored).toMatchObject({ projectId: doc.id, title: 'Backed up', photos: 2 });
    const rows = await fresh.projectAssetRows(doc.id);
    expect(rows.map((r) => [r.id, r.source.kind, r.excluded])).toEqual([['p1', 'copy', true], ['p2', 'copy', false]]);
    expect(await (await fresh.getOriginal('p1'))!.text()).toBe('original-bytes');
    expect(await fresh.hasOriginal('p2')).toBe(false);
    expect(await (await fresh.getThumb('p2', 'm'))!.text()).toBe('m');

    // Restoring next to the original makes a separate copy.
    const again = await restoreProject(store, backup.blob);
    expect(again.projectId).not.toBe(doc.id);
    expect(again.title).toBe('Backed up (restored)');
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreProject(await open(), new Blob(['hello'])) ).rejects.toThrow(/isn’t a Photobook Studio backup/);
  });
});

describe('web version folder references', () => {
  it('round-trips and matches files inside a folder', () => {
    const ref = folderRef({ kind: 'dir', id: 'abc-1', rootName: 'Pictures', sub: 'Trips/Rome' });
    expect(ref).toBe('dir:abc-1:Pictures/Trips/Rome');
    expect(parseFolder(ref)).toEqual({ kind: 'dir', id: 'abc-1', rootName: 'Pictures', sub: 'Trips/Rome' });
    expect(folderDisplayName(ref)).toBe('Rome');
    expect(folderDisplayName('dir:abc-1:Pictures')).toBe('Pictures');
    expect(containsFile(ref, 'abc-1', 'Trips/Rome/day1/a.jpg')).toBe(true);
    expect(containsFile(ref, 'abc-1', 'Trips/Romeo/a.jpg')).toBe(false);
    expect(containsFile('dir:abc-1:Pictures', 'abc-1', 'anything.jpg')).toBe(true);
    expect(containsFile(ref, 'other', 'Trips/Rome/a.jpg')).toBe(false);
  });
});

describe('architecture boundaries (web version)', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  it('shared and in-browser code import nothing from Node or the server', () => {
    for (const f of [...walk('src/shared'), ...walk('src/web/backend')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](node:|fs|path|express|sharp|\.\.\/(\.\.\/)*server)/);
    }
  });
});
