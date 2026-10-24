import { useEffect, useState } from 'react';
import { POSTER_SIZES, PRINTERS, SIZE_PRESETS, STYLE_PRESETS, printer, type BindingId, type PrinterId } from '../../core';
import { api, type ProjectSummary } from '../api';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(String(e.message ?? e)));
  }, []);
  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>Photobook Studio</h1>
          <p className="muted">Everything stays on this computer — photos, thumbnails and books.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> New book or poster</button>
      </header>
      {error && <div className="notice notice-error">Could not reach the local server: {error}</div>}
      {projects && projects.length === 0 && (
        <div className="home-empty">
          <h2>Make your first book or poster</h2>
          <p className="muted">Import a folder of photos, let the app draft a whole book or a collage poster, then refine it and export a print-ready PDF.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>New book</button>
        </div>
      )}
      <div className="project-grid">
        {projects?.map((p) => (
          <a key={p.id} className="project-card" href={`#/book/${p.id}`}>
            <strong>{p.title}</strong>
            <span className="muted small">
              {p.product === 'poster' ? `Poster · ${(p.trimWidthMm / 25.4).toFixed(0)} × ${(p.trimHeightMm / 25.4).toFixed(0)} in` : `${p.pageCount} pages`} · {p.photoCount} photos
            </span>
            <span className="muted small">Edited {new Date(p.updatedAt).toLocaleString()}</span>
          </a>
        ))}
      </div>
      {creating && <NewBook onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewBook({ onClose }: { onClose: () => void }) {
  const [product, setProduct] = useState<'book' | 'poster'>('book');
  return (
    <Modal title={product === 'poster' ? 'New poster' : 'New book'} onClose={onClose}>
      <div className="seg seg-wide product-toggle">
        <button className={product === 'book' ? 'on' : ''} onClick={() => setProduct('book')}><Icon name="spread" /> Photobook</button>
        <button className={product === 'poster' ? 'on' : ''} onClick={() => setProduct('poster')}><Icon name="grid" /> Poster / collage</button>
      </div>
      {product === 'poster' ? <NewPosterForm onClose={onClose} /> : <NewBookForm onClose={onClose} />}
    </Modal>
  );
}

function NewPosterForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [sizeId, setSizeId] = useState('p18x24');
  const [landscape, setLandscape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { doc } = await api.createProject({ title: title.trim() || 'Untitled poster', sizeId, product: 'poster', landscape });
      location.hash = `#/book/${doc.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <>
      <div className="stack">
        <label className="field">
          <span>Title (optional on the poster)</span>
          <input autoFocus value={title} placeholder="e.g. Summer 2026" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </label>
        <div className="field-row">
          <label className="field field-grow">
            <span>Size</span>
            <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
              {POSTER_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Orientation</span>
            <div className="seg">
              <button className={!landscape ? 'on' : ''} onClick={() => setLandscape(false)}>Portrait</button>
              <button className={landscape ? 'on' : ''} onClick={() => setLandscape(true)}>Landscape</button>
            </div>
          </div>
        </div>
        <p className="muted small">After importing photos, use Auto collage to choose a mosaic, grid, hero or pinboard layout. 0.125 in bleed on every edge; change it in the Print tab if your print shop asks for something else.</p>
        {error && <div className="notice notice-error">{error}</div>}
      </div>
      <div className="modal-foot">
        <span />
        <div className="row">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>Create poster</button>
        </div>
      </div>
    </>
  );
}

function NewBookForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [printerId, setPrinterId] = useState<PrinterId>('lulu');
  const [bindingId, setBindingId] = useState<BindingId>('hardcover');
  const pr = printer(printerId);
  const sizes = pr.id === 'custom' ? SIZE_PRESETS : pr.sizes;
  const [sizeId, setSizeId] = useState(sizes[1]?.id ?? sizes[0].id);
  const [stylePresetId, setStyle] = useState('editorial');
  const bind = pr.bindings.find((b) => b.id === bindingId) ?? pr.bindings[0];
  const [pages, setPages] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { doc } = await api.createProject({ title: title.trim() || 'Untitled book', sizeId, stylePresetId, pages, printerId, bindingId });
      location.hash = `#/book/${doc.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <>
      <div className="stack">
        <label className="field">
          <span>Title</span>
          <input autoFocus value={title} placeholder="e.g. Japan, Spring 2026" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Printer</span>
            <select
              value={printerId}
              onChange={(e) => {
                const next = printer(e.target.value);
                setPrinterId(next.id);
                const nextSizes = next.id === 'custom' ? SIZE_PRESETS : next.sizes;
                setSizeId(nextSizes[1]?.id ?? nextSizes[0].id);
              }}
            >
              {PRINTERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Binding</span>
            <select value={bindingId} onChange={(e) => setBindingId(e.target.value as BindingId)}>
              {pr.bindings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Size</span>
          <select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            {sizes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Style</span>
          <select value={stylePresetId} onChange={(e) => setStyle(e.target.value)}>
            {STYLE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.description}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Pages{bind.minPages ? ` (${bind.minPages}–${bind.maxPages} for this binding)` : ''} — you can change this later</span>
          <input type="number" min={bind.minPages ?? 4} max={bind.maxPages ?? 400} step={2} value={pages} onChange={(e) => setPages(Number(e.target.value))} />
        </label>
        <p className="muted small">{pr.notes}</p>
        {error && <div className="notice notice-error">{error}</div>}
      </div>
      <div className="modal-foot">
        <span />
        <div className="row">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>Create</button>
        </div>
      </div>
    </>
  );
}
