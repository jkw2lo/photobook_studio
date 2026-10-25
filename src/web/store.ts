import { create } from 'zustand';
import { CommandError, expandGroups, findSurface, reconcileCover, refreshContents, type BookDocument, type DraftReport, type PhotoAsset } from '../core';
import { api, ApiError, type ImportJob } from './api';

// Editor state. The document is immutable; every committed edit pushes the previous document onto
// a bounded undo stack (structural sharing keeps this cheap). Drags update the document
// "transiently" and commit once on pointer-up, so one gesture = one undo step.

const HISTORY_LIMIT = 200;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface Selection {
  spreadId: string;
  elementId: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface HistoryEntry {
  doc: BookDocument;
  label: string;
}

interface EditorState {
  projectId: string | null;
  doc: BookDocument | null;
  revision: number;
  assets: PhotoAsset[];
  assetMap: Map<string, PhotoAsset>;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Document before the current transient gesture began. */
  gestureBase: BookDocument | null;
  selection: Selection | null;
  /** Every selected element on the selection's surface (the primary one included). Groups are
   * selected whole. Empty or one id = a single selection. */
  multi: string[];
  currentSpread: number;
  cropElementId: string | null;
  swapSource: Selection | null;
  view: 'spread' | 'overview';
  showGuides: boolean;
  zoom: number; // 1 = fit
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  importJob: ImportJob | null;
  /** Bumped to bring the poster's Auto collage controls into view. */
  collageFocus: number;
  /** Bumped to open the book's Draft tab. */
  draftFocus: number;
  /** Result of the last book draft, shown in the Draft tab. */
  draftReport: DraftReport | null;
  /** Photo shown in the library's preview pane. */
  previewAssetId: string | null;
  toasts: Toast[];
  loadError: string | null;

  load(projectId: string): Promise<void>;
  unload(): void;
  /** Apply an edit as one undoable step. Command errors become toasts instead of exceptions. */
  run(label: string, fn: (doc: BookDocument) => BookDocument): boolean;
  /** Live update during a drag; commit with endGesture. */
  gesture(fn: (doc: BookDocument) => BookDocument): void;
  endGesture(label: string): void;
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  /** Select an element (and the rest of its group, unless `only`). */
  select(sel: Selection | null, opts?: { only?: boolean }): void;
  /** Select several elements on one surface; `primary` drives the inspector. */
  selectMany(spreadId: string, ids: string[], primary?: string): void;
  /** Shift-click: add or remove an element (and its group) from the selection. */
  toggleInSelection(spreadId: string, id: string): void;
  goToSpread(i: number): void;
  setView(v: 'spread' | 'overview'): void;
  setZoom(z: number): void;
  toggleGuides(): void;
  setCrop(id: string | null): void;
  setSwapSource(sel: Selection | null): void;
  refreshAssets(): Promise<void>;
  patchAsset(assetId: string, patch: { rating?: number; favorite?: boolean; excluded?: boolean }): Promise<void>;
  startImport(folder: string): Promise<void>;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  doc: null,
  revision: 0,
  assets: [],
  assetMap: new Map(),
  past: [],
  future: [],
  gestureBase: null,
  selection: null,
  multi: [],
  currentSpread: 1,
  cropElementId: null,
  swapSource: null,
  view: 'spread',
  showGuides: true,
  zoom: 1,
  saveState: 'saved',
  saveError: null,
  lastSavedAt: null,
  importJob: null,
  collageFocus: 0,
  draftFocus: 0,
  draftReport: null,
  previewAssetId: null,
  toasts: [],
  loadError: null,

  async load(projectId) {
    set({ projectId, doc: null, loadError: null, past: [], future: [], selection: null, multi: [], cropElementId: null });
    try {
      const [{ doc, revision }, assets] = await Promise.all([api.getProject(projectId), api.assets(projectId)]);
      set({
        doc, revision, assets, assetMap: new Map(assets.map((a) => [a.id, a])),
        saveState: 'saved', lastSavedAt: Date.now(), currentSpread: doc.settings.product === 'poster' ? 0 : Math.min(1, doc.spreads.length - 1),
      });
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) });
    }
  },

  unload() {
    set({ projectId: null, doc: null, assets: [], assetMap: new Map(), past: [], future: [], importJob: null, draftReport: null });
  },

  run(label, fn) {
    const { doc } = get();
    if (!doc) return false;
    try {
      // Any edit that changes the page count or binding moves the spine: keep the cover aligned.
      // …and contents pages follow page numbers and chapters.
      const next = refreshContents(reconcileCover(fn(doc)));
      if (next === doc) return true;
      set((s) => ({
        doc: next,
        past: [...s.past, { doc, label }].slice(-HISTORY_LIMIT),
        future: [],
        saveState: 'dirty',
      }));
      return true;
    } catch (e) {
      get().toast('error', e instanceof CommandError || e instanceof Error ? e.message : String(e));
      return false;
    }
  },

  gesture(fn) {
    const { doc, gestureBase } = get();
    if (!doc) return;
    try {
      set({ doc: fn(doc), gestureBase: gestureBase ?? doc });
    } catch {
      // ignore invalid intermediate states during a drag
    }
  },

  endGesture(label) {
    const { doc, gestureBase } = get();
    if (!doc || !gestureBase) return;
    if (doc === gestureBase) return set({ gestureBase: null });
    set((s) => ({
      gestureBase: null,
      past: [...s.past, { doc: gestureBase, label }].slice(-HISTORY_LIMIT),
      future: [],
      saveState: 'dirty',
    }));
  },

  cancelGesture() {
    const { gestureBase } = get();
    if (gestureBase) set({ doc: gestureBase, gestureBase: null });
  },

  undo() {
    const { past, doc } = get();
    if (!past.length || !doc) return;
    const prev = past[past.length - 1];
    set((s) => ({ doc: prev.doc, past: s.past.slice(0, -1), future: [{ doc, label: prev.label }, ...s.future], saveState: 'dirty', cropElementId: null }));
    fixSelection();
  },

  redo() {
    const { future, doc } = get();
    if (!future.length || !doc) return;
    const next = future[0];
    set((s) => ({ doc: next.doc, future: s.future.slice(1), past: [...s.past, { doc, label: next.label }], saveState: 'dirty', cropElementId: null }));
    fixSelection();
  },

  select(selection, opts) {
    // Selecting a photo on the page also shows it in the library preview.
    let previewAssetId = get().previewAssetId;
    let multi: string[] = [];
    const doc = get().doc;
    if (selection && doc) {
      const els = findSurface(doc, selection.spreadId)?.surface.elements ?? [];
      const el = els.find((e) => e.id === selection.elementId);
      if (el?.type === 'image' && el.assetId) previewAssetId = el.assetId;
      multi = opts?.only ? [selection.elementId] : expandGroups(els, [selection.elementId]);
    }
    set({ selection, multi, previewAssetId, cropElementId: selection && get().cropElementId === selection.elementId ? selection.elementId : null });
  },

  selectMany(spreadId, ids, primary) {
    if (!ids.length) return get().select(null);
    const doc = get().doc;
    const els = doc ? findSurface(doc, spreadId)?.surface.elements ?? [] : [];
    const all = expandGroups(els, ids);
    const main = primary && all.includes(primary) ? primary : all[all.length - 1];
    set({ selection: { spreadId, elementId: main }, multi: all, cropElementId: null });
  },

  toggleInSelection(spreadId, id) {
    const { selection, multi, doc } = get();
    if (!doc || !selection || selection.spreadId !== spreadId) return get().select({ spreadId, elementId: id });
    const els = findSurface(doc, spreadId)?.surface.elements ?? [];
    const current = multi.length ? multi : [selection.elementId];
    const group = expandGroups(els, [id]);
    const next = current.includes(id) ? current.filter((x) => !group.includes(x)) : [...current, ...group.filter((x) => !current.includes(x))];
    if (!next.length) return get().select(null);
    set({ selection: { spreadId, elementId: next.includes(selection.elementId) ? selection.elementId : next[next.length - 1] }, multi: next, cropElementId: null });
  },

  goToSpread(i) {
    const { doc } = get();
    if (!doc) return;
    // -1 is the cover (books only); a poster has just its sheet.
    const min = doc.settings.product === 'poster' ? 0 : -1;
    set({ currentSpread: Math.max(min, Math.min(doc.spreads.length - 1, i)), selection: null, multi: [], cropElementId: null, view: 'spread' });
  },

  setView: (view) => set({ view, selection: null, multi: [], cropElementId: null }),
  setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(4, zoom)) }),
  toggleGuides: () => set((s) => ({ showGuides: !s.showGuides })),
  setCrop: (cropElementId) => set({ cropElementId }),
  setSwapSource: (swapSource) => set({ swapSource }),

  async refreshAssets() {
    const { projectId } = get();
    if (!projectId) return;
    const assets = await api.assets(projectId);
    set({ assets, assetMap: new Map(assets.map((a) => [a.id, a])) });
  },

  async patchAsset(assetId, patch) {
    const { projectId } = get();
    if (!projectId) return;
    const updated = await api.patchAsset(projectId, assetId, patch);
    set((s) => {
      const assets = s.assets.map((a) => (a.id === assetId ? updated : a));
      return { assets, assetMap: new Map(assets.map((a) => [a.id, a])) };
    });
  },

  async startImport(folder) {
    const { projectId } = get();
    if (!projectId) return;
    let job = await api.startImport(projectId, folder);
    set({ importJob: job });
    let lastRefresh = 0;
    while (job.status === 'scanning' || job.status === 'running') {
      await new Promise((r) => setTimeout(r, 400));
      job = await api.job(job.id);
      set({ importJob: job });
      if (Date.now() - lastRefresh > 1200) {
        lastRefresh = Date.now();
        await get().refreshAssets();
      }
    }
    await get().refreshAssets();
    if (job.status === 'failed') get().toast('error', job.errors[0]?.error ?? 'Import failed');
    else {
      const parts = [`Imported ${job.imported} photo${job.imported === 1 ? '' : 's'}`];
      if (job.alreadyInLibrary) parts.push(`${job.alreadyInLibrary} already in library`);
      if (job.exactDuplicates) parts.push(`${job.exactDuplicates} exact duplicate${job.exactDuplicates === 1 ? '' : 's'} flagged`);
      if (job.failed) parts.push(`${job.failed} could not be read`);
      get().toast(job.failed ? 'error' : 'success', parts.join(' · '));
    }
    setTimeout(() => set((s) => (s.importJob?.id === job.id ? { importJob: null } : {})), 2500);
  },

  toast(kind, text) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 4000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** After undo/redo the selected element may no longer exist. */
function fixSelection() {
  const { selection, doc, currentSpread } = useEditor.getState();
  if (!doc) return;
  if (currentSpread >= doc.spreads.length) useEditor.setState({ currentSpread: doc.spreads.length - 1 });
  if (!selection) return;
  const found = findSurface(doc, selection.spreadId);
  if (!found || !found.surface.elements.some((e) => e.id === selection.elementId)) return useEditor.setState({ selection: null, multi: [] });
  const ids = new Set(found.surface.elements.map((e) => e.id));
  useEditor.setState((s) => ({ multi: s.multi.filter((id) => ids.has(id)) }));
}

/** Ids of every selected element (one or many). */
export const selectedIds = (s: Pick<EditorState, 'selection' | 'multi'>): string[] => (s.multi.length ? s.multi : s.selection ? [s.selection.elementId] : []);

// ---- autosave -------------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;

async function flush(keepalive = false) {
  const s = useEditor.getState();
  if (!s.doc || s.saveState !== 'dirty' || s.gestureBase) return;
  if (saving) return void schedule();
  saving = true;
  const doc = s.doc;
  useEditor.setState({ saveState: 'saving' });
  try {
    const { revision } = await api.saveProject(doc, s.revision, keepalive);
    const now = useEditor.getState();
    useEditor.setState({ revision, lastSavedAt: Date.now(), saveError: null, saveState: now.doc === doc ? 'saved' : 'dirty' });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) useEditor.setState({ saveState: 'conflict', saveError: e.message });
    else useEditor.setState({ saveState: 'error', saveError: e instanceof Error ? e.message : String(e) });
  } finally {
    saving = false;
    if (useEditor.getState().saveState === 'dirty') schedule();
  }
}

function schedule(delay = 600) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), delay);
}

useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc && s.saveState === 'dirty' && !s.gestureBase) schedule();
  if (prev.gestureBase && !s.gestureBase && s.saveState === 'dirty') schedule();
});

/** Retry after an error (network hiccup, server restart). */
export function retrySave() {
  useEditor.setState({ saveState: 'dirty' });
  void flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const s = useEditor.getState();
    if (s.saveState === 'dirty' || s.saveState === 'saving') {
      void flush(true);
      e.preventDefault();
    }
  });
}

export const selectedElement = (s: Pick<EditorState, 'doc' | 'selection'>) => {
  if (!s.doc || !s.selection) return null;
  const found = findSurface(s.doc, s.selection.spreadId);
  return found?.surface.elements.find((e) => e.id === s.selection!.elementId) ?? null;
};
