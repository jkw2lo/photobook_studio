import {
  COVER_TEMPLATES, addBackBlurb, addTextAt, applyCoverTemplate, backBlurbElement, removeSpineText, setSpineText, spineTextElement, binding, coverDims, currentPrinterSize, pageCountOf, printer,
  setCoverLocked, setSurfaceBackground, spineTextAllowed, updateSettings, type CoverOverrides,
} from '../../core';
import { useEffect, useState } from 'react';
import { useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { Icon } from './Icon';
import { NumField } from './Inspector';
import { AddTextMenu } from './TypePanel';

const SOURCE_LABEL = {
  table: 'from the printer’s page-count table',
  formula: 'from the printer’s formula',
  manual: 'entered by you',
  estimate: 'an estimate — enter the exact value below',
  none: 'not available for this page count',
} as const;

export function CoverPanel() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const allAssets = useEditor((s) => s.assets);
  const { run, select } = useEditor.getState();
  const cover = doc.cover;
  const s = doc.settings;
  const pr = printer(s.printerId);
  const bind = binding(s);
  const dims = coverDims(doc);
  const size = currentPrinterSize(s);
  const o = s.coverOverrides;
  const setOverride = (patch: Partial<CoverOverrides>, label: string) => run(label, (d) => updateSettings(d, { coverOverrides: { ...d.settings.coverOverrides, ...patch } }));
  const apply = (id: string) => run(cover ? 'Change cover layout' : 'Create cover', (d) => applyCoverTemplate(d, id, assets, allAssets.filter((a) => !a.excluded && !a.missing)));
  const inch = (mm: number) => (mm / 25.4).toFixed(3).replace(/\.?0+$/, '');

  return (
    <div className="stack">
      <div className="row between">
        <strong>Cover</strong>
        {cover && (
          <button className={`btn btn-small ${cover.locked ? 'btn-on' : ''}`} onClick={() => run(cover.locked ? 'Unlock cover' : 'Lock cover', (d) => setCoverLocked(d, !cover.locked))} title="A locked cover is kept when you regenerate; it still follows spine-width changes">
            <Icon name={cover.locked ? 'lock' : 'unlock'} /> {cover.locked ? 'Locked' : 'Lock'}
          </button>
        )}
      </div>

      <div className="spec-card">
        <div><span className="muted small">Printer</span> {pr.name} · {bind.name}</div>
        <div><span className="muted small">Size</span> {size?.name ?? `${s.trimWidthMm.toFixed(1)} × ${s.trimHeightMm.toFixed(1)} mm`} · {pageCountOf(doc)} pages</div>
        <div>
          <span className="muted small">Spine</span> <strong>{dims.spine.mm.toFixed(2)} mm</strong> <span className="muted small">({inch(dims.spine.mm)} in)</span>
          <div className={`small ${dims.spine.source === 'estimate' || dims.spine.source === 'none' ? 'warn-text' : 'muted'}`}>{SOURCE_LABEL[dims.spine.source]}</div>
        </div>
        <div><span className="muted small">Wrap / bleed</span> {dims.wrap.toFixed(2)} mm per edge{!bind.coverWrapVerified && o.wrapMm == null ? <span className="warn-text small"> · unconfirmed</span> : null}</div>
        <div className="muted small">Spine text: {spineTextAllowed(doc) ? 'yes' : `no (needs ${pr.spineTextMinPages}+ pages and a 6 mm spine)`}</div>
      </div>
      <p className="muted small">{pr.coverHelp}</p>

      <div className="field-row">
        <NumField label="Exact spine (mm)" value={o.spineMm ?? dims.spine.mm} min={0} max={100} step={0.1} onCommit={(v) => setOverride({ spineMm: v }, 'Set spine width')} />
        <NumField label="Wrap per edge (mm)" value={o.wrapMm ?? dims.wrap} min={0} max={40} step={0.1} onCommit={(v) => setOverride({ wrapMm: v }, 'Set cover wrap')} />
      </div>
      <div className="field-row">
        <NumField label="Board width (mm)" value={o.panelWidthMm ?? dims.panelW} min={50} max={600} step={0.1} onCommit={(v) => setOverride({ panelWidthMm: v }, 'Set cover board size')} />
        <NumField label="Board height (mm)" value={o.panelHeightMm ?? dims.panelH} min={50} max={600} step={0.1} onCommit={(v) => setOverride({ panelHeightMm: v }, 'Set cover board size')} />
      </div>
      {(o.spineMm != null || o.wrapMm != null || o.panelWidthMm != null || o.panelHeightMm != null) && (
        <button className="link small" onClick={() => setOverride({ spineMm: null, wrapMm: null, panelWidthMm: null, panelHeightMm: null }, 'Use printer cover values')}>
          Use the printer preset’s values again
        </button>
      )}

      <div className="section-title">{cover ? 'Layout' : 'Choose a layout to create the cover'}</div>
      <div className="cover-templates">
        {COVER_TEMPLATES.map((t) => (
          <button key={t.id} className={`cover-template ${cover?.layout?.spread === t.id ? 'on' : ''}`} disabled={cover?.locked} onClick={() => apply(t.id)} title={t.description}>
            <CoverDiagram id={t.id} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      {cover && <p className="muted small">Re-applying a layout keeps the cover’s photos. Drag photos from the library onto the cover to change them.</p>}

      {cover && !cover.locked && (
        <>
          <div className="btn-grid">
            <AddTextMenu surfaceId={cover.id} at={{ x: dims.panelW + dims.spine.mm + dims.panelW / 2, y: dims.panelH * 0.88 }} />
          </div>
          <BackAndSpine />
          <label className="field">
            <span>Cover colour</span>
            <ColorInput value={cover.background ?? doc.style.background} label="Cover colour" apply={(d, c) => setSurfaceBackground(d, cover.id, c)} />
          </label>
        </>
      )}
    </div>
  );
}

/** Back-cover blurb and spine title. */
function BackAndSpine() {
  const doc = useEditor((s) => s.doc)!;
  const { run, select } = useEditor.getState();
  const cover = doc.cover!;
  const spineEl = spineTextElement(doc);
  const blurb = backBlurbElement(doc);
  const [spineText, setText] = useState(spineEl?.type === 'text' ? spineEl.text : doc.title);
  useEffect(() => {
    if (spineEl?.type === 'text') setText(spineEl.text);
  }, [spineEl?.type === 'text' ? spineEl.text : null]); // eslint-disable-line react-hooks/exhaustive-deps
  const allowed = spineTextAllowed(doc);
  const pr = printer(doc.settings.printerId);
  return (
    <>
      <div className="section-title">Back cover</div>
      {blurb ? (
        <button className="btn btn-small" onClick={() => select({ spreadId: cover.id, elementId: blurb.id })}><Icon name="text" /> Edit the back-cover text</button>
      ) : (
        <button className="btn btn-small" onClick={() => {
          let id = '';
          run('Add back-cover text', (d) => {
            const r = addBackBlurb(d);
            id = r.newId;
            return r.doc;
          });
          if (id) select({ spreadId: cover.id, elementId: id });
        }}>
          <Icon name="text" /> Add back-cover text
        </button>
      )}

      <div className="section-title">Spine</div>
      {allowed ? (
        <>
          <div className="row">
            <input className="text-mask-input" value={spineText} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Spine text" placeholder="Title on the spine" />
            <button className="btn btn-small btn-primary" disabled={!spineText.trim()} onClick={() => run(spineEl ? 'Update spine text' : 'Add spine text', (d) => setSpineText(d, spineText.trim()))}>{spineEl ? 'Update' : 'Add'}</button>
          </div>
          {spineEl && (
            <div className="row">
              <button className="link small" onClick={() => select({ spreadId: cover.id, elementId: spineEl.id })}>Style it…</button>
              <button className="link small danger" onClick={() => run('Remove spine text', (d) => removeSpineText(d))}>Remove</button>
            </div>
          )}
          <p className="muted small">Reads top to bottom, sized to the spine. Keep it short — the title, maybe the year.</p>
        </>
      ) : (
        <p className="muted small">The spine is too thin for text: {pr.name} prints spine text from {pr.spineTextMinPages} pages and a 6 mm spine (this book: {pageCountOf(doc)} pages, {coverDims(doc).spine.mm.toFixed(1)} mm).</p>
      )}
    </>
  );
}

function CoverDiagram({ id }: { id: string }) {
  // back | spine | front, 30 × 20 each side
  return (
    <svg width="66" height="22" viewBox="0 0 66 22">
      <rect x="0.5" y="0.5" width="65" height="21" rx="1.5" className="tpl-page" />
      <line x1="31" y1="0" x2="31" y2="22" className="tpl-fold" />
      <line x1="35" y1="0" x2="35" y2="22" className="tpl-fold" />
      {id === 'cover-wrap' && <rect x="0.5" y="0.5" width="65" height="21" className="tpl-img" />}
      {id === 'cover-wrap' && <rect x="38" y="14" width="25" height="6" className="tpl-paper" />}
      {id === 'cover-band' && <rect x="35" y="0.5" width="30.5" height="13.5" className="tpl-img" />}
      {id === 'cover-framed' && <rect x="38.5" y="3" width="24" height="11" className="tpl-img" />}
      {id !== 'cover-wrap' && <rect x="10" y="5" width="11" height="8" className="tpl-img" />}
      <rect x="41" y="16" width="18" height="2.4" className="tpl-text" />
    </svg>
  );
}
