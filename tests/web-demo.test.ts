import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../src/core';

// The web version's demo projects are always there: on start, whatever is missing is set up (and
// only that), anything in Recently deleted is put back, and one project can be reset on its own.
// The backend is a stand-in here; the real import and drafting are covered elsewhere.

const store = vi.hoisted(() => ({
  live: new Map<string, { id: string; title: string }>(),
  trashed: new Map<string, { id: string; title: string }>(),
  created: [] as string[],
  calls: [] as string[],
}));

vi.mock('../src/web/api', async () => {
  const { createBook, createPoster } = await import('../src/core');
  const project = (title: string, product?: 'poster') => {
    const doc = product ? createPoster({ title, sizeId: 'p12x18' }) : createBook({ title });
    store.live.set(doc.id, { id: doc.id, title });
    store.created.push(title);
    return { doc, revision: 1 };
  };
  return {
    api: {
      listProjects: async () => [...store.live.values()],
      deletedProjects: async () => [...store.trashed.values()],
      restoreProject: async (id: string) => {
        store.calls.push(`restore ${id}`);
        store.live.set(id, store.trashed.get(id)!);
        store.trashed.delete(id);
        return { ok: true };
      },
      trashProject: async (id: string) => {
        store.calls.push(`trash ${id}`);
        store.trashed.set(id, store.live.get(id)!);
        store.live.delete(id);
        return { ok: true };
      },
      purgeProject: async (id: string) => {
        store.calls.push(`purge ${id}`);
        store.trashed.delete(id);
        return { removedPhotos: 0 };
      },
      createProject: async (o: { title: string; product?: 'poster' }) => project(o.title, o.product),
      startImport: async () => ({ id: 'job', status: 'done', processed: 0, total: 0, errors: [] }),
      job: async () => ({ id: 'job', status: 'done', processed: 0, total: 0, errors: [] }),
      assets: async () => [],
      patchAsset: async () => ({}),
      saveProject: async () => ({ ok: true, revision: 2 }),
      web: { registerFiles: () => 'folder' },
    },
  };
});

const local = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => local.get(k) ?? null,
  setItem: (k: string, v: string) => void local.set(k, v),
  removeItem: (k: string) => void local.delete(k),
});
vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('fetch', async (url: string) => ({
  ok: true,
  json: async () => ({ trip: 'Amalfi Coast', photos: [{ file: 'a.jpg' }] }),
  arrayBuffer: async () => new ArrayBuffer(8),
  url,
}));

const { ensureDemo, resetDemo } = await import('../src/web/demo/sample');
const { demoBuilding, demoIds, demoPieceOf, isDemoProject, onDemoChange } = await import('../src/web/demo/status');

beforeEach(() => {
  store.live.clear();
  store.trashed.clear();
  store.created.length = 0;
  store.calls.length = 0;
  local.clear();
});

describe('web demo projects', () => {
  it('sets up all three on a first visit, and marks them', async () => {
    const seen: number[] = [];
    const off = onDemoChange(() => seen.push(1));
    const ids = await ensureDemo();
    off();
    expect(store.created).toEqual(['Amalfi Coast', 'Lemon grove', 'Japanese teas']);
    expect(demoIds()).toEqual(ids);
    expect(Object.keys(ids).sort()).toEqual(['book', 'poster', 'tea']);
    expect(isDemoProject(ids.tea!)).toBe(true);
    expect(demoPieceOf(ids.poster!)).toBe('poster');
    expect(seen.length).toBeGreaterThan(0);
    expect(demoBuilding()).toBeNull();
  });

  it('does nothing when they are all there, and leaves your own projects alone', async () => {
    const ids = await ensureDemo();
    const mine = createBook({ title: 'Mine' });
    store.live.set(mine.id, { id: mine.id, title: 'Mine' });
    store.created.length = 0;
    expect(await ensureDemo()).toEqual(ids);
    expect(store.created).toEqual([]);
    expect(isDemoProject(mine.id)).toBe(false);
  });

  it('adds only what a demo set up before it existed is missing', async () => {
    const ids = await ensureDemo();
    store.live.delete(ids.tea!);
    local.set('photobook:demo', JSON.stringify({ book: ids.book, poster: ids.poster }));
    store.created.length = 0;
    const next = await ensureDemo();
    expect(store.created).toEqual(['Japanese teas']);
    expect(next.book).toBe(ids.book);
    expect(next.tea).not.toBe(ids.tea);
  });

  it('puts a deleted demo project back instead of making a new one', async () => {
    const ids = await ensureDemo();
    store.trashed.set(ids.poster!, store.live.get(ids.poster!)!);
    store.live.delete(ids.poster!);
    store.created.length = 0;
    expect(await ensureDemo()).toEqual(ids);
    expect(store.calls).toEqual([`restore ${ids.poster}`]);
    expect(store.created).toEqual([]);
  });

  it('resets one project to the original and keeps the others', async () => {
    const ids = await ensureDemo();
    store.created.length = 0;
    const next = await resetDemo('book');
    expect(store.calls).toEqual([`trash ${ids.book}`, `purge ${ids.book}`]);
    expect(store.created).toEqual(['Amalfi Coast']);
    expect(next.book).not.toBe(ids.book);
    expect(next.poster).toBe(ids.poster);
    expect(next.tea).toBe(ids.tea);
    expect(isDemoProject(ids.book!)).toBe(false);
  });

  it('sets up once when asked twice at the same time', async () => {
    const [a, b] = await Promise.all([ensureDemo(), ensureDemo()]);
    expect(a).toEqual(b);
    expect(store.created).toHaveLength(3);
  });
});
