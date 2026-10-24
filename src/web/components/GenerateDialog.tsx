import { useMemo, useState } from 'react';
import { STYLE_PRESETS, typePack, binding, defaultGenerationSettings, evenPageCount, generateDraft, printer, type DraftReport } from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function GenerateDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const initial = useMemo(() => doc.generation?.settings ?? defaultGenerationSettings(doc, assets.length), [doc, assets.length]);
  const [pages, setPages] = useState(initial.targetPages);
  const [presetId, setPresetId] = useState(doc.style.presetId);
  const [captions, setCaptions] = useState(initial.includeCaptions);
  const [report, setReport] = useState<DraftReport | null>(null);
  const [seed, setSeed] = useState(initial.seed);
  const locked = doc.spreads.filter((s) => s.locked).length + (doc.cover?.locked ? 1 : 0);
  const bind = binding(doc.settings);
  const pageWarning = bind.minPages && evenPageCount(pages) < bind.minPages
    ? `${printer(doc.settings.printerId).name} ${bind.name} needs at least ${bind.minPages} pages.`
    : bind.maxPages && evenPageCount(pages) > bind.maxPages ? `${printer(doc.settings.printerId).name} ${bind.name} allows at most ${bind.maxPages} pages.` : null;
  const usable = assets.filter((a) => !a.excluded && !a.missing).length;
  const hasContent = doc.spreads.some((s) => !s.locked && s.elements.length);

  const generate = (nextSeed: number) => {
    const settings = { targetPages: evenPageCount(pages), stylePresetId: presetId, ordering: 'chronological' as const, includeCaptions: captions, seed: nextSeed };
    let r: DraftReport | null = null;
    const ok = useEditor.getState().run(report || hasContent ? 'Regenerate draft' : 'Generate draft', (d) => {
      const res = generateDraft(d, assets, settings);
      r = res.report;
      return res.doc;
    });
    if (ok && r) {
      setReport(r);
      setSeed(nextSeed);
      useEditor.getState().goToSpread(1);
    }
  };

  return (
    <Modal title="Automatic first draft" onClose={onClose} wide>
      <p className="muted">
        Picks the best frame of each burst, skips duplicates and hidden photos, always keeps favourites, and tells the story in time order. Everything it makes stays fully editable.
      </p>
      <div className="gen-grid">
        <label className="field">
          <span>Pages</span>
          <div className="stepper">
            <button onClick={() => setPages((p) => Math.max(4, evenPageCount(p) - 2))}>−</button>
            <input type="number" value={pages} min={4} max={400} step={2} onChange={(e) => setPages(Number(e.target.value))} onBlur={() => setPages(evenPageCount(Math.max(4, pages)))} />
            <button onClick={() => setPages((p) => Math.min(400, evenPageCount(p) + 2))}>+</button>
          </div>
        </label>
        <div className="field">
          <span>Photos</span>
          <div className="stat">{usable} usable <span className="muted">of {assets.length}</span></div>
        </div>
        <label className="field check">
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
          <span>Date captions</span>
        </label>
        <div className="field">
          <span>Order</span>
          <div className="stat">Chronological</div>
        </div>
      </div>
      <div className="style-cards">
        {STYLE_PRESETS.map((p) => (
          <button key={p.id} className={`style-card ${presetId === p.id ? 'on' : ''}`} onClick={() => setPresetId(p.id)}>
            <div className={`style-swatch style-${p.id}`} style={{ background: p.style.background, color: p.style.textColor, fontFamily: `'${typePack(p.typePack).roles.title.family}'` }}>
              <span>Aa</span>
            </div>
            <strong>{p.name}</strong>
            <span className="muted small">{p.description}</span>
          </button>
        ))}
      </div>
      {pageWarning && <div className="notice notice-error"><Icon name="alert" /> {pageWarning}</div>}
      {locked > 0 && <div className="notice"><Icon name="lock" /> {locked} locked {doc.cover?.locked ? 'item' : 'spread'}{locked > 1 ? 's' : ''} will be kept exactly as {locked > 1 ? 'they are' : 'it is'}.</div>}
      {hasContent && !report && <div className="notice">This replaces the current unlocked pages. You can undo it.</div>}
      {report && (
        <div className="report">
          <div><strong>{report.pages}</strong> pages · <strong>{report.selected}</strong> photos placed{report.heroSpreads ? ` · ${report.heroSpreads} panorama spread${report.heroSpreads > 1 ? 's' : ''}` : ''}</div>
          <div className="muted small">
            Cover {doc.cover?.locked ? 'kept (locked)' : 'designed from your best photos'} ·{' '}
            {report.candidates} candidates · {report.nearDuplicatesSet} similar shots set aside · {report.exactDuplicates} exact duplicates skipped
            {report.excluded ? ` · ${report.excluded} hidden` : ''}{report.missing ? ` · ${report.missing} missing` : ''}
          </div>
          {report.notes.map((n) => <div key={n} className="small">{n}</div>)}
        </div>
      )}
      <div className="modal-foot">
        <span className="muted small">{usable === 0 ? 'Import photos first.' : report ? 'Not quite right? Try another variation, or close and edit.' : ''}</span>
        <div className="row">
          {report && (
            <button className="btn" onClick={() => generate(seed + 1)}>
              <Icon name="shuffle" /> Another variation
            </button>
          )}
          {report ? (
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          ) : (
            <button className="btn btn-primary" disabled={usable === 0} onClick={() => generate(seed)}>
              <Icon name="sparkle" /> Generate
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
