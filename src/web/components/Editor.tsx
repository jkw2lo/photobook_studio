import { useEffect, useState } from 'react';
import { findSurface, innerBox, issueCounts, moveElements, panCrop, updateElement, zoomCropAt } from '../../core';
import { applyAreaTool, duplicate, group, remove, toggleLock, togglePin, ungroup } from '../elementActions';
import { retrySave, selectedElement, selectedIds, useEditor } from '../store';
import { Canvas } from './Canvas';
import { ExportDialog } from './ExportDialog';
import { FlipPreview } from './FlipPreview';
import { MockupPreview } from './MockupPreview';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { Navigator } from './Navigator';
import { Overview } from './Overview';
import { usePreflight } from './PreflightPanel';
import { generateFirstCollage } from './PosterUI';
import { generateFirstDraft } from './DraftPanel';

/** Books: Auto draft lives in the side panel's Layout › Draft; an empty book is drafted right away. */
function focusAutoDraft() {
  const st = useEditor.getState();
  st.select(null);
  if (st.doc && st.doc.spreads.every((s) => s.elements.length === 0)) generateFirstDraft(st.assets);
  useEditor.setState({ draftFocus: st.draftFocus + 1 });
}

/**
 * Posters: Auto collage lives in the side panel next to the sheet. This shows that panel, and fills
 * an empty sheet right away so there is a result to look at and refine.
 */
function focusAutoCollage() {
  const st = useEditor.getState();
  st.select(null);
  if (st.doc && !st.doc.spreads[0]?.elements.some((e) => e.type === 'image')) generateFirstCollage(st.assets);
  useEditor.setState({ collageFocus: st.collageFocus + 1 });
}

export function Editor({ projectId }: { projectId: string }) {
  // Narrow selectors: the editor shell must not re-render (and re-render every panel) on each drag step.
  const loaded = useEditor((s) => !!s.doc);
  const loadError = useEditor((s) => s.loadError);
  const view = useEditor((s) => s.view);
  const [dialog, setDialog] = useState<'export' | 'preview' | 'mockup' | null>(null);
  const issues = usePreflight();
  const counts = issueCounts(issues);
  const assetsCount = useEditor((s) => s.assets.length);
  const isEmpty = useEditor((s) => !!s.doc && s.doc.spreads.every((sp) => sp.elements.length === 0));
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');

  useEffect(() => {
    void useEditor.getState().load(projectId);
    return () => useEditor.getState().unload();
  }, [projectId]);

  useKeyboard(dialog === null);

  if (loadError) {
    return (
      <div className="center-msg">
        <p>Couldn’t open this book: {loadError}</p>
        <p className="muted small">If the server was just restarted, it may still be starting up.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void useEditor.getState().load(projectId)}>Try again</button>
          <a className="btn" href="#/">Back to books</a>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="center-msg muted">Opening…</div>;

  return (
    <div className="editor">
      <Library />
      <div className="editor-main">
      <TopBar onGenerate={poster ? focusAutoCollage : focusAutoDraft} onExport={() => setDialog('export')} onPreview={() => setDialog('preview')} onMockup={() => setDialog('mockup')} />
      <div className="workspace">
        <main className="stage">
          {view === 'overview' ? <Overview /> : <Canvas />}
          {isEmpty && view === 'spread' && (
            <div className="stage-empty">
              <h3>{assetsCount ? `${assetsCount} photos ready` : 'Start by importing photos'}</h3>
              <p className="muted">
                {assetsCount
                  ? poster ? 'Let the app build a collage from your best photos, then refine it — or drag photos onto the sheet yourself.' : 'Let the app draft a complete book, then refine it — or drag photos onto the pages yourself.'
                  : 'Use Import in the library. Photos never leave this computer.'}
              </p>
              {assetsCount > 0 && (
                <button className="btn btn-primary" onClick={poster ? focusAutoCollage : focusAutoDraft}>
                  <Icon name="sparkle" /> {poster ? 'Generate collage' : 'Generate first draft'}
                </button>
              )}
            </div>
          )}
          {!poster && <Navigator />}
        </main>
        <Inspector issueCount={counts} />
      </div>
      </div>
      <Toasts />
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'preview' && <FlipPreview onClose={() => setDialog(null)} />}
      {dialog === 'mockup' && <MockupPreview onClose={() => setDialog(null)} />}
    </div>
  );
}

function TopBar({ onGenerate, onExport, onPreview, onMockup }: { onGenerate: () => void; onExport: () => void; onPreview: () => void; onMockup: () => void }) {
  const title = useEditor((s) => s.doc?.title ?? '');
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const view = useEditor((s) => s.view);
  const zoom = useEditor((s) => s.zoom);
  const showGuides = useEditor((s) => s.showGuides);
  const st = useEditor.getState();
  const saveLabel = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', error: 'Not saved', conflict: 'Saved elsewhere' }[saveState];
  return (
    <header className="topbar">
      <div className="row">
        <a className="icon-btn" href="#/" title="All books"><Icon name="back" /></a>
        <span className="book-title">{title}</span>
        <span className={`save save-${saveState}`} title={saveError ?? undefined}>
          {saveLabel}
          {saveState === 'error' && <button className="link" onClick={retrySave}>Retry</button>}
          {saveState === 'conflict' && <button className="link" onClick={() => location.reload()}>Reload</button>}
        </span>
      </div>
      <div className="row">
        <button className="icon-btn" disabled={!past.length} onClick={st.undo} title={past.length ? `Undo ${past[past.length - 1].label} (⌘Z)` : 'Undo'}><Icon name="undo" /></button>
        <button className="icon-btn" disabled={!future.length} onClick={st.redo} title={future.length ? `Redo ${future[0].label} (⇧⌘Z)` : 'Redo'}><Icon name="redo" /></button>
        <span className="divider" />
        {!poster && (
          <div className="seg seg-compact">
            <button className={view === 'spread' ? 'on' : ''} onClick={() => st.setView('spread')} title="Spread editor"><Icon name="spread" /></button>
            <button className={view === 'overview' ? 'on' : ''} onClick={() => st.setView('overview')} title="Whole book"><Icon name="grid" /></button>
          </div>
        )}
        <button className={`icon-btn ${showGuides ? 'on' : ''}`} onClick={st.toggleGuides} title="Trim, bleed, safe-area and binding guides (G)"><Icon name="guides" /></button>
        {view === 'spread' && (
          <div className="zoom">
            <button className="icon-btn" onClick={() => st.setZoom(zoom / 1.25)} title="Zoom out">−</button>
            <button className="zoom-label" onClick={() => st.setZoom(1)} title="Fit">{Math.round(zoom * 100)}%</button>
            <button className="icon-btn" onClick={() => st.setZoom(zoom * 1.25)} title="Zoom in">+</button>
          </div>
        )}
      </div>
      <div className="row">
        <button className="btn" onClick={onPreview} title="Flip through it like a reader"><Icon name="eye" /> Preview</button>
        <button className="btn" onClick={onMockup} title={poster ? 'See it framed on a wall, or as a postcard on a table' : 'See it as a print on a table'}><Icon name="image" /> In a room</button>
        <button className="btn" onClick={onGenerate}><Icon name="sparkle" /> {poster ? 'Auto collage' : 'Auto draft'}</button>
        <button className="btn btn-primary" onClick={onExport}><Icon name="download" /> Export PDF</button>
      </div>
    </header>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => useEditor.getState().dismissToast(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}

function useKeyboard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const st = useEditor.getState();
      if (!st.doc) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        return e.shiftKey ? st.redo() : st.undo();
      }
      if (mod && key === 'y') {
        e.preventDefault();
        return st.redo();
      }
      if (e.key === 'Escape') {
        if (st.swapSource) return st.setSwapSource(null);
        if (st.canvasTool) return st.setCanvasTool(null);
        // Esc puts the photo back as it was; Enter (or Done) keeps the crop.
        if (st.cropElementId) return st.cancelCrop();
        return st.select(null);
      }
      if (st.canvasTool) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (st.canvasTool.kind === 'area') return applyAreaTool(st.canvasTool);
          return st.setCanvasTool(null);
        }
        return;
      }
      if (key === 'g' && !mod) return st.toggleGuides();
      // Crop mode: arrows move the photo inside its frame, +/− zoom, Enter finishes.
      if (st.cropElementId && st.selection) {
        const found = findSurface(st.doc, st.selection.spreadId);
        const el = found?.surface.elements.find((x) => x.id === st.cropElementId);
        const asset = el?.type === 'image' && el.assetId ? st.assetMap.get(el.assetId) : undefined;
        if (el?.type === 'image' && asset && found) {
          const box = innerBox(el);
          const img = { w: asset.widthPx, h: asset.heightPx };
          const step = e.shiftKey ? 5 : 1;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const sid = found.surface.id;
          if (moves[e.key]) {
            e.preventDefault();
            const crop = panCrop(box, img, el.crop, el.fit, moves[e.key][0], moves[e.key][1]);
            return st.run('Adjust crop', (d) => updateElement(d, sid, el.id, { crop }));
          }
          if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
            e.preventDefault();
            const crop = zoomCropAt(box, img, el.crop, el.fit, e.key === '-' || e.key === '_' ? 1 / 1.1 : 1.1, { x: box.w / 2, y: box.h / 2 });
            return st.run('Zoom photo', (d) => updateElement(d, sid, el.id, { crop }));
          }
          if (e.key === 'Enter') return st.setCrop(null);
        }
      }
      // Select everything on this page.
      if (mod && key === 'a') {
        const surface = st.currentSpread === -1 ? st.doc.cover : st.doc.spreads[st.currentSpread];
        if (surface?.elements.length) {
          e.preventDefault();
          st.selectMany(surface.id, surface.elements.map((x) => x.id));
        }
        return;
      }
      const el = selectedElement(st);
      const sel = st.selection;
      if (!el || !sel) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') return st.goToSpread(st.currentSpread + 1);
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') return st.goToSpread(st.currentSpread - 1);
        return;
      }
      const ids = selectedIds(st);
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return remove(sel, el);
      }
      if (mod && key === 'd') {
        e.preventDefault();
        return duplicate(sel);
      }
      if (mod && key === 'g') {
        e.preventDefault();
        return e.shiftKey ? ungroup(sel) : group(sel);
      }
      if (key === 'l' && !mod) return toggleLock(sel, el);
      if (key === 'p' && !mod && el.type === 'image' && st.doc.settings.product === 'poster') return togglePin(sel, el);
      const step = e.shiftKey ? 5 : 0.5;
      const nudges: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const n = nudges[e.key];
      if (n) {
        e.preventDefault();
        st.run('Nudge', (d) => moveElements(d, sel.spreadId, ids, n[0], n[1]));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
