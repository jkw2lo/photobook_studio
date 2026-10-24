import { useEffect, useState } from 'react';
import { duplicateElement, issueCounts, removeElements, updateElement } from '../../core';
import { retrySave, selectedElement, useEditor } from '../store';
import { Canvas } from './Canvas';
import { ExportDialog } from './ExportDialog';
import { GenerateDialog } from './GenerateDialog';
import { Icon } from './Icon';
import { Inspector } from './Inspector';
import { Library } from './Library';
import { Navigator } from './Navigator';
import { Overview } from './Overview';
import { usePreflight } from './PreflightPanel';

export function Editor({ projectId }: { projectId: string }) {
  // Narrow selectors: the editor shell must not re-render (and re-render every panel) on each drag step.
  const loaded = useEditor((s) => !!s.doc);
  const loadError = useEditor((s) => s.loadError);
  const view = useEditor((s) => s.view);
  const [dialog, setDialog] = useState<'generate' | 'export' | null>(null);
  const issues = usePreflight();
  const counts = issueCounts(issues);
  const assetsCount = useEditor((s) => s.assets.length);
  const isEmpty = useEditor((s) => !!s.doc && s.doc.spreads.every((sp) => sp.elements.length === 0));

  useEffect(() => {
    void useEditor.getState().load(projectId);
    return () => useEditor.getState().unload();
  }, [projectId]);

  useKeyboard(dialog === null);

  if (loadError) return <div className="center-msg"><p>{loadError}</p><a href="#/">Back to books</a></div>;
  if (!loaded) return <div className="center-msg muted">Opening…</div>;

  return (
    <div className="editor">
      <TopBar onGenerate={() => setDialog('generate')} onExport={() => setDialog('export')} />
      <div className="workspace">
        <Library />
        <main className="stage">
          {view === 'overview' ? <Overview /> : <Canvas />}
          {isEmpty && view === 'spread' && (
            <div className="stage-empty">
              <h3>{assetsCount ? `${assetsCount} photos ready` : 'Start by importing photos'}</h3>
              <p className="muted">{assetsCount ? 'Let the app draft a complete book, then refine it — or drag photos onto the pages yourself.' : 'Use Import in the library. Photos never leave this computer.'}</p>
              {assetsCount > 0 && (
                <button className="btn btn-primary" onClick={() => setDialog('generate')}>
                  <Icon name="sparkle" /> Generate first draft
                </button>
              )}
            </div>
          )}
          <Navigator />
        </main>
        <Inspector issueCount={counts} />
      </div>
      <Toasts />
      {dialog === 'generate' && <GenerateDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function TopBar({ onGenerate, onExport }: { onGenerate: () => void; onExport: () => void }) {
  const title = useEditor((s) => s.doc?.title ?? '');
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
        <div className="seg seg-compact">
          <button className={view === 'spread' ? 'on' : ''} onClick={() => st.setView('spread')} title="Spread editor"><Icon name="spread" /></button>
          <button className={view === 'overview' ? 'on' : ''} onClick={() => st.setView('overview')} title="Whole book"><Icon name="grid" /></button>
        </div>
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
        <button className="btn" onClick={onGenerate}><Icon name="sparkle" /> Auto draft</button>
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
        if (st.cropElementId) return st.setCrop(null);
        return st.select(null);
      }
      if (key === 'g' && !mod) return st.toggleGuides();
      const el = selectedElement(st);
      const sel = st.selection;
      if (!el || !sel) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') return st.goToSpread(st.currentSpread + 1);
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') return st.goToSpread(st.currentSpread - 1);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (el.locked) return st.toast('info', 'Unlock the element to delete it.');
        st.run('Delete', (d) => removeElements(d, sel.spreadId, [el.id]));
        return st.select(null);
      }
      if (mod && key === 'd') {
        e.preventDefault();
        let id = '';
        st.run('Duplicate', (d) => {
          const r = duplicateElement(d, sel.spreadId, el.id);
          id = r.newId;
          return r.doc;
        });
        if (id) st.select({ spreadId: sel.spreadId, elementId: id });
        return;
      }
      if (key === 'l' && !mod) return st.run(el.locked ? 'Unlock' : 'Lock', (d) => updateElement(d, sel.spreadId, el.id, { locked: !el.locked }));
      const step = e.shiftKey ? 5 : 0.5;
      const nudges: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const n = nudges[e.key];
      if (n && !el.locked) {
        e.preventDefault();
        st.run('Nudge', (d) => updateElement(d, sel.spreadId, el.id, { xMm: el.xMm + n[0], yMm: el.yMm + n[1] }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
