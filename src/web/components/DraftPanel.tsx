import { useEffect, useState } from 'react';
import {
  STYLE_PRESETS, TEMPLATE_EXTRA_PAGES, binding, bookTemplate, defaultGenerationSettings, finishTemplateBook, evenPageCount, generateDraft, printer, typePack, type GenerationSettings,
  type PhotoAsset,
} from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { BookTemplatesSection } from './BookTemplates';

/**
 * Run the generator as one undoable step and remember its report for the panel. A book started
 * from a template keeps its template pages (front matter, chapter openers, closing pages and the
 * words typed on them) as long as its style stays the template's.
 */
function runDraft(settings: GenerationSettings, assets: PhotoAsset[], label: string) {
  const st = useEditor.getState();
  st.run(label, (d) => {
    const t = d.template ? bookTemplate(d.template) : undefined;
    if (t && settings.stylePresetId === t.stylePresetId) {
      const res = generateDraft(d, assets, { ...settings, targetPages: Math.max(4, settings.targetPages - TEMPLATE_EXTRA_PAGES), chapterOpeners: true });
      const doc = finishTemplateBook(res.doc, t, assets, d);
      useEditor.setState({ draftReport: { ...res.report, pages: doc.spreads.length * 2 - 2 } });
      return doc;
    }
    const res = generateDraft(d, assets, settings);
    useEditor.setState({ draftReport: res.report });
    return { ...res.doc, template: undefined };
  });
}

/** Empty book: draft it straight away with sensible defaults, so there is something to look at. */
export function generateFirstDraft(assets: PhotoAsset[]) {
  const st = useEditor.getState();
  if (!st.doc) return;
  runDraft(defaultGenerationSettings(st.doc, assets.length), assets, 'Generate draft');
  st.goToSpread(1);
}

/**
 * Auto draft in the side panel: the pages stay visible while you regenerate, and you can flip
 * through spreads between variations. Regenerating keeps you on the spread you are looking at.
 */
export function DraftPanel() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const report = useEditor((s) => s.draftReport);
  const saved = doc.generation?.settings ?? defaultGenerationSettings(doc, assets.length);
  const [pages, setPages] = useState(saved.targetPages);
  const [presetId, setPresetId] = useState(doc.style.presetId);
  const [captions, setCaptions] = useState(saved.includeCaptions);
  const [openers, setOpeners] = useState(!!saved.chapterOpeners);
  // Follow the book when it changes underneath (undo, another window).
  useEffect(() => setPages(doc.spreads.length * 2 - 2), [doc.spreads.length]);
  useEffect(() => setPresetId(doc.style.presetId), [doc.style.presetId]);

  const locked = doc.spreads.filter((s) => s.locked).length;
  const bind = binding(doc.settings);
  const pr = printer(doc.settings.printerId);
  const target = evenPageCount(Math.max(4, pages));
  const pageWarning = bind.minPages && target < bind.minPages
    ? `${pr.name} ${bind.name} needs at least ${bind.minPages} pages.`
    : bind.maxPages && target > bind.maxPages ? `${pr.name} ${bind.name} allows at most ${bind.maxPages} pages.` : null;
  const usable = assets.filter((a) => !a.excluded && !a.missing).length;
  const hasContent = doc.spreads.some((s) => !s.locked && s.elements.length);
  const settingsChanged = target !== doc.spreads.length * 2 - 2 || presetId !== (doc.generation?.settings.stylePresetId ?? doc.style.presetId) || captions !== saved.includeCaptions || openers !== !!saved.chapterOpeners;

  const generate = (seed: number) => {
    const at = useEditor.getState().currentSpread;
    runDraft({ targetPages: target, stylePresetId: presetId, ordering: 'chronological', includeCaptions: captions, chapterOpeners: openers, seed }, assets, hasContent ? 'Regenerate draft' : 'Generate draft');
    // Stay on the same spread (clamped) so you can compare variations in place.
    useEditor.getState().goToSpread(hasContent ? at : 1);
  };

  return (
    <div className="stack">
      <div className="section-title">Book templates</div>
      <BookTemplatesSection />
      <div className="auto-collage">
        <div className="row between">
          <strong>Auto draft</strong>
          {hasContent && <span className="muted small">{doc.spreads.length * 2 - 2} pages</span>}
        </div>
        {usable === 0 ? (
          <p className="muted small">Import photos in the library first.</p>
        ) : (
          <>
            <div className="field-row">
              <label className="field">
                <span>Pages</span>
                <div className="stepper">
                  <button onClick={() => setPages(Math.max(4, target - 2))} aria-label="Fewer pages">−</button>
                  <input type="number" value={pages} min={4} max={800} step={2} onChange={(e) => setPages(Number(e.target.value))} onBlur={() => setPages(target)} />
                  <button onClick={() => setPages(Math.min(800, target + 2))} aria-label="More pages">+</button>
                </div>
              </label>
              <label className="field check">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
                <span>Date captions</span>
              </label>
              <label className="field check" title="Start every chapter (day) on its own opener page">
                <input type="checkbox" checked={openers} onChange={(e) => setOpeners(e.target.checked)} />
                <span>Chapter pages</span>
              </label>
            </div>
            <div className="btn-grid">
              <button className="btn btn-small btn-primary" onClick={() => generate(settingsChanged || !hasContent ? 1 : saved.seed)} title="Draft the unlocked pages with these settings">
                <Icon name="sparkle" /> {hasContent ? 'Regenerate' : 'Generate'}
              </button>
              <button className="btn btn-small" disabled={!hasContent} onClick={() => generate(saved.seed + 1)} title="Same settings, a different arrangement">
                <Icon name="shuffle" /> Another variation
              </button>
            </div>
            {pageWarning && <div className="notice notice-error small"><Icon name="alert" /> {pageWarning}</div>}
            {locked > 0 && <p className="muted small"><Icon name="lock" size={11} /> {locked} locked spread{locked > 1 ? 's' : ''} kept as {locked > 1 ? 'they are' : 'it is'}{doc.cover?.locked ? ', and the locked cover' : ''}.</p>}
            {report && (
              <p className="muted small">
                {report.pages} pages · {report.selected} photos placed{report.heroSpreads ? ` · ${report.heroSpreads} panorama${report.heroSpreads > 1 ? 's' : ''}` : ''} · {report.nearDuplicatesSet} similar shots set aside
                {report.exactDuplicates ? ` · ${report.exactDuplicates} duplicates skipped` : ''}{report.notes.length ? ` · ${report.notes.join(' ')}` : ''}
              </p>
            )}
            <p className="muted small">Best frame of each burst, no duplicates or hidden photos, favourites always kept, in time order. Regenerating replaces unlocked pages — undo brings them back.</p>
          </>
        )}
      </div>

      <div className="section-title">Style {settingsChanged && hasContent ? <span className="pending-tag">applies on Regenerate</span> : null}</div>
      <div className="style-cards compact">
        {STYLE_PRESETS.map((p) => (
          <button key={p.id} className={`style-card ${presetId === p.id ? 'on' : ''}`} onClick={() => setPresetId(p.id)} title={p.description}>
            <div className="style-swatch" style={{ background: p.style.background, color: p.style.textColor, fontFamily: `'${typePack(p.typePack).roles.title.family}'` }}>
              <span>Aa</span>
            </div>
            <strong>{p.name}</strong>
          </button>
        ))}
      </div>
      <p className="muted small">{STYLE_PRESETS.find((p) => p.id === presetId)?.description}</p>
    </div>
  );
}
