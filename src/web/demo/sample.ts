import { applyBookTemplate, generatePoster, reconcileCover, refreshContents, type BackgroundImage, type BookDocument, type Element, type PhotoAsset } from '../../core';
import { api, type ImportJob } from '../api';
import { initialCollageSettings } from '../components/PosterUI';
import teaRecipe from './tea-poster.json';
import { DEMO_PIECES, demoIds, saveDemoIds, setDemoBuilding, type DemoIds, type DemoPiece } from './status';

// The web version's demo: someone a few weeks after a three-day trip along the Amalfi Coast. The
// sample photos (made-up illustrations, see scripts/make-demo.ts) go through the real import —
// EXIF, thumbnails, analysis — then the book is drafted with the Travel journal template and a
// poster is made from the same photos, exactly as the app's own buttons do it. A second poster is
// rebuilt from the recipe of one designed by hand. The demo is always there: whatever is missing
// (a first visit, a demo set up before a piece existed, a project deleted) is set up again.

const BASE = `${import.meta.env.BASE_URL}demo/`;
/** WebNotes' own open/closed setting. */
const NOTES_KEY = 'photobook:webNotesOpen';

/** How long ago the trip started: about three weeks, so the demo never looks stale. */
const TRIP_DAYS_AGO = 23;

export { demoIds, type DemoIds };

interface Manifest {
  trip: string;
  photos: { file: string; favorite?: boolean }[];
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** The photo's EXIF placeholder dates (2000:01:0D) moved to the trip's real days. */
function redate(bytes: Uint8Array, start: Date): Uint8Array {
  const pattern = [...'2000:01:0'].map((c) => c.charCodeAt(0));
  for (let i = 0; i + pattern.length < bytes.length; i++) {
    if (!pattern.every((c, k) => bytes[i + k] === c)) continue;
    const day = bytes[i + pattern.length] - 48;
    if (day < 1 || day > 9) continue;
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day - 1);
    const text = `${d.getFullYear()}:${p2(d.getMonth() + 1)}:${p2(d.getDate())}`;
    for (let k = 0; k < 10; k++) bytes[i + k] = text.charCodeAt(k);
  }
  return bytes;
}

async function photoFiles(m: Manifest, onProgress: (text: string) => void): Promise<File[]> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - TRIP_DAYS_AGO);
  const files: File[] = [];
  for (const [i, p] of m.photos.entries()) {
    onProgress(`Fetching the sample photos… ${i + 1} / ${m.photos.length}`);
    const r = await fetch(BASE + p.file);
    if (!r.ok) throw new Error(`Couldn't load ${p.file}`);
    const bytes = redate(new Uint8Array(await r.arrayBuffer()), start);
    files.push(new File([bytes as BlobPart], p.file, { type: 'image/jpeg', lastModified: start.getTime() }));
  }
  return files;
}

async function importInto(projectId: string, folder: string, onProgress: (text: string) => void): Promise<ImportJob> {
  let job = await api.startImport(projectId, folder);
  while (job.status === 'scanning' || job.status === 'running') {
    onProgress(`Importing the sample photos… ${job.processed} / ${job.total || '…'}`);
    await new Promise((r) => setTimeout(r, 300));
    job = await api.job(job.id);
  }
  if (job.status === 'failed') throw new Error(job.errors[0]?.error ?? 'Import failed');
  return job;
}

/** What the store does after every edit: keep the cover and the contents page in step. */
const settle = (doc: BookDocument) => refreshContents(reconcileCover(doc));

async function save(doc: BookDocument, revision: number) {
  return (await api.saveProject(doc, revision)).revision;
}

/** Projects created by a setup that hasn't finished: the home page shows placeholders for them. */
type Created = (id: string) => void;

let inflight: Promise<DemoIds> | null = null;

/**
 * Make sure every demo project is there: restore any in Recently deleted, set up the rest. Safe to
 * call any time and from several tabs (they take turns); resolves with the demo's project ids.
 */
export function ensureDemo(onProgress: (text: string) => void = () => undefined): Promise<DemoIds> {
  inflight ??= withLock(() => setUp(onProgress)).finally(() => {
    inflight = null;
    setDemoBuilding(null);
  });
  return inflight;
}

const withLock = <T,>(fn: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('photobook-demo', fn) : fn();

async function setUp(onProgress: (text: string) => void): Promise<DemoIds> {
  const ids: DemoIds = { ...demoIds() };
  const live = new Set((await api.listProjects()).map((p) => p.id));
  const trashed = new Set((await api.deletedProjects()).map((p) => p.id));
  const missing: DemoPiece[] = [];
  for (const k of DEMO_PIECES) {
    const id = ids[k];
    if (id && live.has(id)) continue;
    if (id && trashed.has(id)) await api.restoreProject(id);
    else missing.push(k);
  }
  if (!missing.length) {
    saveDemoIds(ids);
    return ids;
  }
  const pending: string[] = [];
  let text = 'Setting up the demo…';
  const show = () => setDemoBuilding({ pieces: [...missing], pending: [...pending], text });
  const report = (t: string) => {
    text = t;
    show();
    onProgress(t);
  };
  const created: Created = (id) => {
    pending.push(id);
    show();
  };
  const done = (k: DemoPiece, id: string) => {
    ids[k] = id;
    missing.splice(missing.indexOf(k), 1);
    saveDemoIds(ids);
    show();
  };
  report(text);
  if (missing.includes('book') || missing.includes('poster')) {
    const made = await makeTrip({ book: missing.includes('book'), poster: missing.includes('poster') }, report, created);
    if (made.book) done('book', made.book);
    if (made.poster) done('poster', made.poster);
  }
  if (missing.includes('tea')) done('tea', await makeTeaPoster(report, created));
  return ids;
}

/** Put one demo project back the way it was (edits are discarded). */
export async function resetDemo(piece: DemoPiece): Promise<DemoIds> {
  await inflight?.catch(() => undefined);
  const ids: DemoIds = { ...demoIds() };
  const id = ids[piece];
  delete ids[piece];
  saveDemoIds(ids);
  if (id) {
    await api.trashProject(id).catch(() => undefined);
    await api.purgeProject(id).catch(() => undefined);
  }
  return ensureDemo();
}

/** The portfolio welcome's See the demo: the demo is there, with the web notes folded. */
export async function loadDemo(onProgress: (text: string) => void): Promise<DemoIds> {
  const ids = await ensureDemo(onProgress);
  try {
    // The demo opens with the web-version notes folded, so the books are what you see first.
    localStorage.setItem(NOTES_KEY, '0');
  } catch {
    // storage unavailable
  }
  return ids;
}

/** The Amalfi Coast book and/or the Lemon grove poster, from the sample trip's photos. */
async function makeTrip(want: { book: boolean; poster: boolean }, onProgress: (text: string) => void, created: Created): Promise<DemoIds> {
  const manifest = (await (await fetch(`${BASE}manifest.json`)).json()) as Manifest;
  const files = await photoFiles(manifest, onProgress);
  const folder = api.web!.registerFiles(files);
  const out: DemoIds = {};

  // The book: imported, a few favourites (★), the exact copy of a photo (whichever of the two the
  // import flagged) hidden, then drafted from the template.
  if (want.book) {
    const book = await api.createProject({ title: manifest.trip, sizeId: 'lulu-sq85', printerId: 'lulu', bindingId: 'hardcover', stylePresetId: 'editorial', pages: 24 });
    created(book.doc.id);
    await importInto(book.doc.id, folder, onProgress);
    onProgress('Drafting the book…');
    let assets: PhotoAsset[] = await api.assets(book.doc.id);
    for (const p of manifest.photos) {
      const a = assets.find((x) => x.fileName === p.file);
      if (a && p.favorite) await api.patchAsset(book.doc.id, a.id, { favorite: true });
    }
    for (const a of assets) if (a.exactDuplicateOf) await api.patchAsset(book.doc.id, a.id, { excluded: true });
    assets = await api.assets(book.doc.id);
    const drafted = settle(applyBookTemplate(book.doc, assets, 'travel-journal', { targetPages: 24 }).doc);
    await save(drafted, book.revision);
    out.book = drafted.id;
  }

  // The poster: the same photos (already in the library, so nothing is stored twice), an auto collage.
  if (want.poster) {
    onProgress('Making the poster…');
    const poster = await api.createProject({ title: 'Lemon grove', sizeId: 'p12x18', product: 'poster' });
    created(poster.doc.id);
    await importInto(poster.doc.id, folder, onProgress);
    const posterAssets = await api.assets(poster.doc.id);
    const usable = posterAssets.filter((a) => !a.excluded && !a.missing).length;
    const collage = generatePoster(poster.doc, posterAssets, { ...initialCollageSettings(poster.doc, usable), photoCount: 9 }).doc;
    await save(collage, poster.revision);
    out.poster = collage.id;
  }
  return out;
}

interface TeaRecipe {
  title: string;
  sizeId: string;
  style: BookDocument['style'];
  grade?: BookDocument['grade'];
  collage?: BookDocument['collage'];
  sheet: { background?: string; backgroundImage: BackgroundImage; elements: Element[] };
  photos: string[];
}

/**
 * The second poster: made by hand in the desktop editor (cut-outs, inverted labels, a background
 * photo moved into place), rebuilt here from its recipe with the demo's own copies of its photos.
 */
async function makeTeaPoster(onProgress: (text: string) => void, created: Created): Promise<string> {
  const recipe = teaRecipe as unknown as TeaRecipe;
  const files: File[] = [];
  for (const [i, name] of recipe.photos.entries()) {
    onProgress(`Fetching the tea poster's photos… ${i + 1} / ${recipe.photos.length}`);
    const r = await fetch(`${BASE}tea/${name}`);
    if (!r.ok) throw new Error(`Couldn't load ${name}`);
    files.push(new File([await r.arrayBuffer()], name, { type: 'image/webp' }));
  }
  const folder = api.web!.registerFiles(files);
  onProgress('Making the tea poster…');
  const poster = await api.createProject({ title: recipe.title, sizeId: recipe.sizeId, product: 'poster' });
  created(poster.doc.id);
  await importInto(poster.doc.id, folder, onProgress);
  const byFile = new Map((await api.assets(poster.doc.id)).map((a) => [a.fileName, a.id]));
  const asset = (ref: string | null) => (ref?.startsWith('file:') ? byFile.get(ref.slice(5)) ?? null : ref);
  const sheet = poster.doc.spreads[0];
  const doc: BookDocument = {
    ...poster.doc,
    style: recipe.style,
    grade: recipe.grade,
    collage: recipe.collage,
    spreads: [{
      ...sheet,
      background: recipe.sheet.background,
      backgroundImage: { ...recipe.sheet.backgroundImage, assetId: asset(recipe.sheet.backgroundImage.assetId) ?? '' },
      elements: recipe.sheet.elements.map((e) => (e.type === 'image' ? { ...e, assetId: asset(e.assetId) } : e)),
    }],
  };
  await save(doc, poster.revision);
  return doc.id;
}
