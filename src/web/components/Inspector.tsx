import { useEffect, useState } from 'react';
import {
  COVER_INDEX, TEXT_ROLES, addChapter, applyMosaicLayout, nearestWeight, resetTextToStyle, roleLabel, saveTextAsRoleStyle, setTextRole, weightName, addTextAt, applyTemplate, defaultCrop, duplicateElement, duplicateSpread, effectiveDpi,
  fitFrameToPhoto, fontFamily, insertSpreadAfter, isPrintable, removeElements, removeSpread, reorderElement, setFramePhoto,
  setSpreadChapter, setSpreadLocked, setSurfaceBackground, shuffleSpreadLayout, spreadPagesLabel, templateName, updateElement,
  type ImageElement, type TextElement, type TextRole,
} from '../../core';
import { thumbUrl } from '../api';
import { selectedElement, useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { BookPanel } from './BookPanel';
import { CoverPanel } from './CoverPanel';
import { FontPicker } from './FontPicker';
import { PosterPanel } from './PosterUI';
import { AddTextMenu } from './TypePanel';
import { Icon } from './Icon';
import { PreflightPanel } from './PreflightPanel';
import { TemplatePicker } from './TemplatePicker';

type Tab = 'edit' | 'book' | 'preflight';

export function Inspector({ issueCount, onAutoCollage }: { issueCount: { error: number; warning: number }; onAutoCollage: () => void }) {
  const [tab, setTab] = useState<Tab>('edit');
  const selected = useEditor(selectedElement);
  const onCover = useEditor((s) => s.currentSpread === COVER_INDEX);
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');
  useEffect(() => {
    if (selected) setTab('edit');
  }, [selected?.id]);
  return (
    <aside className="inspector">
      <div className="tabs">
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>{selected ? ({ image: 'Photo', text: 'Text', shape: 'Shape' } as const)[selected.type] : poster ? 'Poster' : onCover ? 'Cover' : 'Spread'}</button>
        <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>{poster ? 'Print' : 'Book'}</button>
        <button className={tab === 'preflight' ? 'on' : ''} onClick={() => setTab('preflight')}>
          Preflight
          {issueCount.error > 0 ? <span className="pill pill-error">{issueCount.error}</span> : issueCount.warning > 0 ? <span className="pill pill-warn">{issueCount.warning}</span> : <span className="pill pill-ok"><Icon name="check" size={11} /></span>}
        </button>
      </div>
      <div className="inspector-body">
        {tab === 'edit' && (selected ? <ElementPanel /> : poster ? <PosterPanel onAutoCollage={onAutoCollage} /> : onCover ? <CoverPanel /> : <SpreadPanel />)}
        {tab === 'book' && <BookPanel />}
        {tab === 'preflight' && <PreflightPanel />}
      </div>
    </aside>
  );
}

// ---- number field that commits on blur / Enter --------------------------------------------

export function NumField({ label, value, onCommit, step = 0.5, min, max, suffix }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) return setText(fmt(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (Math.abs(clamped - value) > 1e-6) onCommit(clamped);
    else setText(fmt(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input
          type="number" value={text} step={step} min={min} max={max}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

// ---- element ---------------------------------------------------------------------------------

function ElementPanel() {
  const doc = useEditor((s) => s.doc)!;
  const sel = useEditor((s) => s.selection)!;
  const el = useEditor(selectedElement)!;
  const assets = useEditor((s) => s.assetMap);
  const cropId = useEditor((s) => s.cropElementId);
  const { run, select, setCrop, setSwapSource } = useEditor.getState();
  const upd = (label: string, patch: Partial<ImageElement> | Partial<TextElement>) => run(label, (d) => updateElement(d, sel.spreadId, el.id, patch));
  /** Hand edits to a text box's typography make it custom (it stops following its style). */
  const custom = (label: string, patch: Partial<TextElement>) => upd(label, { ...patch, styleLinked: false });

  return (
    <div className="stack">
      <div className="row between">
        <strong>{({ image: 'Photo frame', text: 'Text', shape: 'Colour panel' } as const)[el.type]}</strong>
        <div className="row">
          <button className={`icon-btn ${el.locked ? 'on' : ''}`} title={el.locked ? 'Unlock (L)' : 'Lock (L)'} onClick={() => upd(el.locked ? 'Unlock' : 'Lock', { locked: !el.locked })}>
            <Icon name={el.locked ? 'lock' : 'unlock'} />
          </button>
          <button className="icon-btn" title="Duplicate (⌘D)" onClick={() => {
            let id = '';
            run('Duplicate', (d) => {
              const r = duplicateElement(d, sel.spreadId, el.id);
              id = r.newId;
              return r.doc;
            });
            if (id) select({ spreadId: sel.spreadId, elementId: id });
          }}>
            <Icon name="copy" />
          </button>
          <button className="icon-btn danger" title="Delete (⌫)" disabled={el.locked} onClick={() => {
            run('Delete', (d) => removeElements(d, sel.spreadId, [el.id]));
            select(null);
          }}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      {el.type === 'image' && (() => {
        const asset = el.assetId ? assets.get(el.assetId) : undefined;
        const dpi = asset ? Math.round(effectiveDpi(el, asset)) : 0;
        const dpiClass = dpi >= doc.settings.minDpiWarning ? 'ok' : dpi >= doc.settings.minDpiError ? 'warn' : 'error';
        return (
          <>
            {asset ? (
              <div className="photo-info">
                <img src={thumbUrl(asset.id)} alt="" />
                <div>
                  <div className="ellipsis" title={asset.fileName}>{asset.fileName}</div>
                  <div className="muted small">{asset.widthPx} × {asset.heightPx}px</div>
                  <div className={`dpi dpi-${dpiClass}`}>{dpi} DPI at print size</div>
                </div>
              </div>
            ) : (
              <p className="muted">Empty frame — drag a photo from the library onto it.</p>
            )}
            <div className="seg">
              <button className={el.fit === 'cover' ? 'on' : ''} onClick={() => upd('Fill frame', { fit: 'cover' })}>Fill</button>
              <button className={el.fit === 'contain' ? 'on' : ''} onClick={() => upd('Fit whole photo', { fit: 'contain' })}>Fit</button>
            </div>
            <label className="field">
              <span>Zoom</span>
              <input
                type="range" min={1} max={4} step={0.01} value={el.crop.zoom}
                onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, sel.spreadId, el.id, { crop: { ...el.crop, zoom: Number(e.target.value) } }))}
                onPointerUp={() => useEditor.getState().endGesture('Zoom photo')}
                onKeyUp={() => useEditor.getState().endGesture('Zoom photo')}
              />
            </label>
            <div className="btn-grid">
              <button className={`btn btn-small ${cropId === el.id ? 'btn-on' : ''}`} disabled={!asset || el.locked} onClick={() => setCrop(cropId === el.id ? null : el.id)}>
                <Icon name="crop" /> {cropId === el.id ? 'Done' : 'Adjust crop'}
              </button>
              <button className="btn btn-small" disabled={!asset || el.locked} onClick={() => upd('Reset crop', { crop: defaultCrop(asset) })}>Reset crop</button>
              <button className="btn btn-small" disabled={!asset || el.locked} onClick={() => asset && run('Fit frame to photo', (d) => fitFrameToPhoto(d, sel.spreadId, el.id, asset))}>
                <Icon name="fit" /> Frame to photo
              </button>
              <button className="btn btn-small" disabled={!asset || el.locked} onClick={() => setSwapSource(sel)} title="Then click another photo, on any spread">
                <Icon name="swap" /> Swap with…
              </button>
              <button className="btn btn-small" disabled={!asset || el.locked} onClick={() => run('Remove photo', (d) => setFramePhoto(d, sel.spreadId, el.id, null))}>
                Empty frame
              </button>
            </div>
            <div className="field-row">
              <NumField label="Border" value={el.borderMm} min={0} max={20} suffix="mm" onCommit={(v) => upd('Border', { borderMm: v })} />
              <label className="field">
                <span>Colour</span>
                <ColorInput value={el.borderColor} label="Border colour" apply={(d, c) => updateElement(d, sel.spreadId, el.id, { borderColor: c })} />
              </label>
            </div>
          </>
        );
      })()}

      {el.type === 'text' && (
        <>
          <textarea
            className="text-input" value={el.text} rows={4}
            onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, sel.spreadId, el.id, { text: e.target.value }))}
            onBlur={() => useEditor.getState().endGesture('Edit text')}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="field">
            <span>Style</span>
            <select value={el.role} onChange={(e) => run(`Style: ${roleLabel(e.target.value as TextRole)}`, (d) => setTextRole(d, sel.spreadId, el.id, e.target.value as TextRole))}>
              {TEXT_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
            </select>
          </div>
          {el.styleLinked !== false ? (
            <p className="muted small style-status">Follows the {roleLabel(el.role)} style — change it for the whole book in the Book tab.</p>
          ) : (
            <div className="style-status custom">
              <span className="small">Custom look</span>
              <div className="row">
                <button className="link small" onClick={() => run('Reset to style', (d) => resetTextToStyle(d, sel.spreadId, el.id))}>Reset to {roleLabel(el.role)}</button>
                <button className="link small" onClick={() => run(`Update ${roleLabel(el.role)} style`, (d) => saveTextAsRoleStyle(d, sel.spreadId, el.id))}>Use for all {roleLabel(el.role).toLowerCase()}s</button>
              </div>
            </div>
          )}
          <div className="field">
            <span>Font</span>
            <FontPicker value={el.fontFamily} onChange={(family) => custom('Font', { fontFamily: family, fontWeight: nearestWeight(family, el.fontWeight) })} />
          </div>
          <div className="field-row">
            <label className="field">
              <span>Weight</span>
              <select value={el.fontWeight} onChange={(e) => custom('Font weight', { fontWeight: Number(e.target.value) })}>
                {fontFamily(el.fontFamily).weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
              </select>
            </label>
            <NumField label="Size" value={el.fontSizePt} min={4} max={300} suffix="pt" onCommit={(v) => custom('Font size', { fontSizePt: v })} />
          </div>
          <div className="field-row">
            <NumField label="Letter spacing" value={Math.round((el.letterSpacingEm ?? 0) * 100)} min={-10} max={60} step={1} suffix="%" onCommit={(v) => custom('Letter spacing', { letterSpacingEm: v / 100 })} />
            <NumField label="Line height" value={el.lineHeight} step={0.05} min={0.8} max={3} onCommit={(v) => custom('Line height', { lineHeight: v })} />
          </div>
          <div className="field-row">
            <div className="field">
              <span>Case</span>
              <div className="seg">
                <button className={!el.uppercase ? 'on' : ''} onClick={() => custom('Case', { uppercase: false })}>Aa</button>
                <button className={el.uppercase ? 'on' : ''} onClick={() => custom('Case', { uppercase: true })}>AA</button>
              </div>
            </div>
            <label className="field">
              <span>Colour</span>
              <ColorInput value={el.color} label="Text colour" apply={(d, c) => updateElement(d, sel.spreadId, el.id, { color: c, styleLinked: false })} />
            </label>
          </div>
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={el.align === a ? 'on' : ''} onClick={() => upd('Align text', { align: a })}>{a[0].toUpperCase() + a.slice(1)}</button>
            ))}
          </div>
        </>
      )}

      {el.type === 'shape' && (
        <div className="field-row">
          <label className="field">
            <span>Fill</span>
            <ColorInput value={el.fill} label="Fill colour" apply={(d, c) => updateElement(d, sel.spreadId, el.id, { fill: c })} />
          </label>
          <label className="field">
            <span>Opacity</span>
            <input
              type="range" min={0.1} max={1} step={0.01} value={el.opacity}
              onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, sel.spreadId, el.id, { opacity: Number(e.target.value) }))}
              onPointerUp={() => useEditor.getState().endGesture('Opacity')}
            />
          </label>
        </div>
      )}

      <div className="section-title">Position</div>
      <div className="field-row">
        <NumField label="X" value={el.xMm} suffix="mm" onCommit={(v) => upd('Move', { xMm: v })} />
        <NumField label="Y" value={el.yMm} suffix="mm" onCommit={(v) => upd('Move', { yMm: v })} />
      </div>
      <div className="field-row">
        <NumField label="W" value={el.widthMm} min={2} suffix="mm" onCommit={(v) => upd('Resize', { widthMm: v })} />
        <NumField label="H" value={el.heightMm} min={2} suffix="mm" onCommit={(v) => upd('Resize', { heightMm: v })} />
      </div>
      <div className="field-row">
        <NumField label="Rotate" value={el.rotationDeg} step={1} min={-180} max={180} suffix="°" onCommit={(v) => upd('Rotate', { rotationDeg: v })} />
        <div className="field">
          <span>Arrange</span>
          <div className="row">
            <button className="icon-btn" title="Bring to front" onClick={() => run('Bring to front', (d) => reorderElement(d, sel.spreadId, el.id, 'front'))}>↑</button>
            <button className="icon-btn" title="Send to back" onClick={() => run('Send to back', (d) => reorderElement(d, sel.spreadId, el.id, 'back'))}>↓</button>
          </div>
        </div>
      </div>
      <p className="muted small">Double-click a photo to crop, or text to edit. Arrow keys nudge 0.5 mm (Shift: 5 mm). Hold Alt while dragging to turn off snapping.</p>
    </div>
  );
}

// ---- spread ----------------------------------------------------------------------------------

function SpreadPanel() {
  const doc = useEditor((s) => s.doc)!;
  const i = useEditor((s) => s.currentSpread);
  const assets = useEditor((s) => s.assetMap);
  const { run, goToSpread, select } = useEditor.getState();
  const spread = doc.spreads[i];
  const n = doc.spreads.length;
  const inner = i > 0 && i < n - 1;
  const [seed, setSeed] = useState(1);
  const imagesOn = (side: 'left' | 'right') =>
    spread.elements.filter((e) => e.type === 'image' && (side === 'left' ? e.xMm + e.widthMm / 2 < doc.settings.trimWidthMm : e.xMm + e.widthMm / 2 >= doc.settings.trimWidthMm)).length;

  return (
    <div className="stack">
      <div className="row between">
        <strong>Spread · {spreadPagesLabel(i, n)}</strong>
        <button className={`btn btn-small ${spread.locked ? 'btn-on' : ''}`} onClick={() => run(spread.locked ? 'Unlock spread' : 'Lock spread', (d) => setSpreadLocked(d, spread.id, !spread.locked))} title="Locked spreads are kept exactly as they are when you regenerate">
          <Icon name={spread.locked ? 'lock' : 'unlock'} /> {spread.locked ? 'Locked' : 'Lock'}
        </button>
      </div>
      {spread.locked && <p className="muted small">This spread is locked. Regenerating the book keeps it exactly as it is.</p>}

      <div className="btn-grid">
        <button className="btn btn-small" disabled={spread.locked} onClick={() => {
          const next = seed + 1;
          setSeed(next);
          run('Shuffle layout', (d) => shuffleSpreadLayout(d, i, assets, Date.now() % 100000 + next));
        }}>
          <Icon name="shuffle" /> Shuffle layout
        </button>
        <AddTextMenu surfaceId={spread.id} at={{ x: doc.settings.trimWidthMm * (isPrintable(i, 'right', n) ? 1.5 : 0.5), y: doc.settings.trimHeightMm * 0.85 }} disabled={spread.locked} />
        <button className="btn btn-small" onClick={() => {
          if (run('Insert spread', (d) => insertSpreadAfter(d, i))) goToSpread(Math.min(i + 1, n - 1));
        }}>
          <Icon name="plus" /> Insert spread after
        </button>
        <button className="btn btn-small" disabled={!inner} onClick={() => run('Duplicate spread', (d) => duplicateSpread(d, i)) && goToSpread(i + 1)}>
          <Icon name="copy" /> Duplicate
        </button>
        <button className="btn btn-small danger" disabled={!inner || spread.locked} onClick={() => run('Delete spread', (d) => removeSpread(d, i)) && goToSpread(Math.min(i, n - 2))}>
          <Icon name="trash" /> Delete spread
        </button>
      </div>

      <label className="field">
        <span>Chapter</span>
        <select
          value={spread.chapterId ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new') {
              const title = window.prompt('Chapter title');
              if (!title) return;
              run('Add chapter', (d) => {
                const r = addChapter(d, title);
                return setSpreadChapter(r.doc, spread.id, r.newId);
              });
            } else run('Set chapter', (d) => setSpreadChapter(d, spread.id, e.target.value || undefined));
          }}
        >
          <option value="">None</option>
          {doc.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          <option value="__new">New chapter…</option>
        </select>
      </label>

      <label className="field">
        <span>Background</span>
        <div className="row">
          <ColorInput value={spread.background ?? doc.style.background} label="Spread background" apply={(d, c) => setSurfaceBackground(d, spread.id, c)} />
          {spread.background && <button className="link" onClick={() => run('Reset background', (d) => setSurfaceBackground(d, spread.id, undefined))}>Use book colour</button>}
        </div>
      </label>

      {!spread.locked && (
        <>
          {n > 2 && inner && (
            <>
              <div className="section-title">Whole spread</div>
              <TemplatePicker scope="spread" current={spread.layout?.spread} onPick={(id) => run(`Layout: ${templateName(id)}`, (d) => applyTemplate(d, i, 'spread', id, assets))} />
            </>
          )}
          {(['left', 'right'] as const).filter((side) => isPrintable(i, side, n)).map((side) => (
            <div key={side}>
              <div className="section-title">{side === 'left' ? 'Left' : 'Right'} page layout · <span className="muted">{templateName(spread.layout?.[side])}</span></div>
              <TemplatePicker
                scope="page" imageCount={imagesOn(side)} current={spread.layout?.[side]}
                onPick={(id) => run(`Layout: ${templateName(id)}`, (d) => applyTemplate(d, i, side, id, assets))}
                onMosaic={imagesOn(side) >= 2 ? () => run('Layout: Mosaic', (d) => applyMosaicLayout(d, i, side, assets, Date.now() % 1000)) : undefined}
              />
            </div>
          ))}
          <p className="muted small">Highlighted layouts fit the number of photos already on the page. Extra photos go back to the library; extra frames start empty.</p>
        </>
      )}
    </div>
  );
}

export type { ImageElement };
