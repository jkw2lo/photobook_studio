import { useEffect, useRef, useState } from 'react';
import {
  COVER_INDEX, TEXT_ROLES, addChapter, applyMosaicLayout, nearestWeight, resetTextToStyle, roleLabel, saveTextAsRoleStyle, setTextRole, weightName, addTextAt, applyTemplate, defaultCrop, duplicateElement, duplicateSpread, effectiveDpi,
  fitFrameToPhoto, fontFamily, insertSpreadAfter, isPrintable, removeElements, removeSpread, reorderElement, setFramePhoto,
  setSpreadChapter, setSpreadLocked, setSurfaceBackground, shuffleSpreadLayout, spreadPagesLabel, templateName, updateElement,
  MM_PER_PT, TEXT_QUICK_STYLES, useAsBackground, applyQuickStyle, estimateTextHeightMm, boldWeight, isBold, type BookDocument, type ImageElement, type TextElement, type TextRole,
} from '../../core';
import { thumbUrl } from '../api';
import { duplicate, remove, togglePin, toggleKeepCrop, toggleKeepRotation, toggleLock } from '../elementActions';
import { selectedElement, useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { BookPanel } from './BookPanel';
import { CoverPanel } from './CoverPanel';
import { FontPicker } from './FontPicker';
import { PosterPanel } from './PosterUI';
import { DraftPanel } from './DraftPanel';
import { AddTextMenu } from './TypePanel';
import { CalendarControls } from './CalendarControls';
import { ElementsPalette, PhotoAdjustControls, PhotoShapeControls, ShapeControls, TextEffects } from './DesignPanel';
import { PageAddonsSection } from './BookTemplates';
import { AlignTools, LayersPanel, MultiPanel } from './SelectionPanel';
import { Icon } from './Icon';
import { PreflightPanel } from './PreflightPanel';
import { TemplatePicker } from './TemplatePicker';

type Tab = 'edit' | 'draft' | 'book' | 'preflight';

export function Inspector({ issueCount }: { issueCount: { error: number; warning: number } }) {
  const [tab, setTab] = useState<Tab>('edit');
  const selected = useEditor(selectedElement);
  const multiCount = useEditor((s) => s.multi.length);
  const onCover = useEditor((s) => s.currentSpread === COVER_INDEX);
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');
  const collageFocus = useEditor((s) => s.collageFocus);
  const draftFocus = useEditor((s) => s.draftFocus);
  useEffect(() => {
    if (collageFocus) setTab('edit');
  }, [collageFocus]);
  useEffect(() => {
    if (draftFocus) setTab('draft');
  }, [draftFocus]);
  // Posters have no Draft tab (Auto collage lives in the Poster panel).
  useEffect(() => {
    if (poster && tab === 'draft') setTab('edit');
  }, [poster, tab]);
  useEffect(() => {
    if (selected) setTab('edit');
  }, [selected?.id]);
  return (
    <aside className="inspector">
      <div className="tabs">
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>{multiCount > 1 ? 'Selection' : selected ? ({ image: 'Photo', text: 'Text', shape: 'Shape', calendar: 'Calendar' } as const)[selected.type] : poster ? 'Poster' : onCover ? 'Cover' : 'Spread'}</button>
        {!poster && <button className={tab === 'draft' ? 'on' : ''} onClick={() => setTab('draft')}>Draft</button>}
        <button className={tab === 'book' ? 'on' : ''} onClick={() => setTab('book')}>{poster ? 'Print' : 'Book'}</button>
        <button className={tab === 'preflight' ? 'on' : ''} onClick={() => setTab('preflight')}>
          Preflight
          {issueCount.error > 0 ? <span className="pill pill-error">{issueCount.error}</span> : issueCount.warning > 0 ? <span className="pill pill-warn">{issueCount.warning}</span> : <span className="pill pill-ok"><Icon name="check" size={11} /></span>}
        </button>
      </div>
      <div className="inspector-body">
        {tab === 'edit' && (multiCount > 1 ? <MultiPanel /> : selected ? <ElementPanel /> : poster ? <PosterPanel /> : onCover ? <CoverPanel /> : <SpreadPanel />)}
        {tab === 'edit' && <LayersPanel />}
        {tab === 'draft' && <DraftPanel />}
        {tab === 'book' && <BookPanel />}
        {tab === 'preflight' && <PreflightPanel />}
      </div>
    </aside>
  );
}

// ---- number field that commits on blur / Enter --------------------------------------------

/**
 * Number field. With `apply`, changes show on the page as you type or step (arrow keys, spinner)
 * and become one undo step when you leave the field; otherwise `onCommit` runs on blur / Enter.
 */
export function NumField({ label, value, onCommit, apply, undoLabel, step = 0.5, min, max, suffix }: {
  label: string; value: number; onCommit?: (v: number) => void; apply?: (d: BookDocument, v: number) => BookDocument; undoLabel?: string;
  step?: number; min?: number; max?: number; suffix?: string;
}) {
  const [text, setText] = useState(fmt(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(fmt(value));
  }, [value]);
  const clampV = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = () => {
    editing.current = false;
    if (apply) {
      useEditor.getState().endGesture(undoLabel ?? label);
      return setText(fmt(value));
    }
    const v = Number(text);
    if (!Number.isFinite(v) || text.trim() === '') return setText(fmt(value));
    const clamped = clampV(v);
    if (Math.abs(clamped - value) > 1e-6) onCommit?.(clamped);
    else setText(fmt(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input
          type="number" value={text} step={step} min={min} max={max}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (apply && e.target.value.trim() !== '' && Number.isFinite(v)) {
              editing.current = true;
              useEditor.getState().gesture((d) => apply(d, clampV(v)));
            }
          }}
          onBlur={commit}
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
  const poster = doc.settings.product === 'poster';
  const { run, select, setCrop, setSwapSource } = useEditor.getState();
  const upd = (label: string, patch: Partial<ImageElement> | Partial<TextElement>) => run(label, (d) => updateElement(d, sel.spreadId, el.id, patch));
  /** Hand edits to a text box's typography make it custom (it stops following its style). */
  const custom = (label: string, patch: Partial<TextElement>) => upd(label, { ...patch, styleLinked: false });

  return (
    <div className="stack">
      <div className="row between">
        <strong>{el.type === 'shape' && el.outline ? `Map · ${el.outline.name}` : ({ image: 'Photo frame', text: 'Text', shape: 'Shape', calendar: 'Calendar' } as const)[el.type]}</strong>
        <div className="row">
          <button className={`icon-btn ${el.locked ? 'on' : ''}`} title={el.locked ? 'Unlock (L)' : 'Lock (L)'} onClick={() => toggleLock(sel, el)}>
            <Icon name={el.locked ? 'lock' : 'unlock'} />
          </button>
          <button className="icon-btn" title="Duplicate (⌘D)" onClick={() => duplicate(sel)}>
            <Icon name="copy" />
          </button>
          <button className="icon-btn danger" title="Delete (⌫)" disabled={el.locked} onClick={() => remove(sel, el)}>
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
            {poster && (
              <div className="pin-box">
                <div className="btn-grid">
                  <button className={`btn btn-small ${el.pinned ? 'btn-on' : ''}`} onClick={() => togglePin(sel, el)} title="Keep this photo exactly where it is — position, size and crop. Arrange and Shuffle fill in around it. (P)">
                    <Icon name="pin" /> {el.pinned ? 'Pinned' : 'Pin in place'}
                  </button>
                  <button className={`btn btn-small ${el.keepCrop && !el.pinned ? 'btn-on' : ''}`} disabled={el.pinned || !asset} onClick={() => toggleKeepCrop(sel, el)} title="Arrange may move this photo, but keeps its crop, zoom, fit and border — and always keeps it on the sheet">
                    <Icon name="crop" /> {el.keepCrop && !el.pinned ? 'Crop kept' : 'Keep crop'}
                  </button>
                  <button className={`btn btn-small ${el.keepRotation && !el.pinned ? 'btn-on' : ''}`} disabled={el.pinned || !asset} onClick={() => toggleKeepRotation(sel, el)} title="Arrange may move this photo, but keeps its tilt — and always keeps it on the sheet">
                    <Icon name="rotate" /> {el.keepRotation && !el.pinned ? 'Rotation kept' : 'Keep rotation'}
                  </button>
                </div>
                {asset && (
                  <button className="btn btn-small" disabled={el.locked} title="Take this photo out of the collage and put it behind everything, filling the sheet" onClick={() => {
                    if (run('Use as background', (d) => useAsBackground(d, sel.spreadId, el.id, asset))) select(null);
                  }}>
                    <Icon name="image" /> Use as sheet background
                  </button>
                )}
                <p className="muted small">
                  {el.pinned || el.locked
                    ? 'Arrange and Shuffle leave this photo exactly as it is and fill in around it.'
                    : el.keepCrop || el.keepRotation
                      ? `Arrange can move this photo, but keeps its ${[el.keepCrop && 'crop', el.keepRotation && 'rotation'].filter(Boolean).join(' and ')} and keeps it on the sheet.`
                      : 'Arrange and Shuffle lay this photo out again. Pin it to keep your changes.'}
                </p>
              </div>
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
            {asset && (
              <>
                <div className="section-title">Adjust</div>
                <PhotoAdjustControls el={el} spreadId={sel.spreadId} analysis={asset.analysis} />
              </>
            )}
            <div className="section-title">Cut-out</div>
            <PhotoShapeControls el={el} spreadId={sel.spreadId} />
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

      {el.type === 'text' && <TextControls el={el} spreadId={sel.spreadId} />}

      {el.type === 'shape' && <ShapeControls el={el} spreadId={sel.spreadId} />}
      {el.type === 'calendar' && <CalendarControls el={el} spreadId={sel.spreadId} />}

      <div className="section-title">Align to page</div>
      <AlignTools spreadId={sel.spreadId} ids={[el.id]} />

      <div className="section-title">Position</div>
      <div className="field-row">
        <NumField label="X" value={el.xMm} suffix="mm" apply={(d, v) => updateElement(d, sel.spreadId, el.id, { xMm: v })} undoLabel="Move" />
        <NumField label="Y" value={el.yMm} suffix="mm" apply={(d, v) => updateElement(d, sel.spreadId, el.id, { yMm: v })} undoLabel="Move" />
      </div>
      <div className="field-row">
        <NumField label="W" value={el.widthMm} min={2} suffix="mm" apply={(d, v) => updateElement(d, sel.spreadId, el.id, { widthMm: v })} undoLabel="Resize" />
        <NumField label="H" value={el.heightMm} min={2} suffix="mm" apply={(d, v) => updateElement(d, sel.spreadId, el.id, { heightMm: v })} undoLabel="Resize" />
      </div>
      <div className="field-row">
        <NumField label="Rotate" value={el.rotationDeg} step={1} min={-180} max={180} suffix="°" apply={(d, v) => updateElement(d, sel.spreadId, el.id, { rotationDeg: v })} undoLabel="Rotate" />
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

// ---- text ------------------------------------------------------------------------------------

const SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 84, 96, 120, 144, 180, 220, 300];

function TextControls({ el, spreadId }: { el: TextElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const { run } = useEditor.getState();
  const upd = (label: string, patch: Partial<TextElement>) => run(label, (d) => updateElement(d, spreadId, el.id, patch));
  /** Hand edits to a text box's typography make it custom (it stops following its style). */
  const custom = (label: string, patch: Partial<TextElement>) => upd(label, { ...patch, styleLinked: false });
  const live = (patch: (v: number) => Partial<TextElement>) => (d: BookDocument, v: number) => updateElement(d, spreadId, el.id, { ...patch(v), styleLinked: false });
  /** A bigger size grows the box so the text still fits (it never shrinks a box you sized). */
  const sized = (sizePt: number): Partial<TextElement> => ({
    fontSizePt: sizePt,
    heightMm: Math.max(el.heightMm, estimateTextHeightMm(el.text, el.widthMm, sizePt, el.lineHeight, el.letterSpacingEm ?? 0, el.paddingMm ?? 0)),
  });
  const stepSize = (dir: 1 | -1) => {
    const cur = el.fontSizePt;
    const next = dir > 0 ? SIZE_STEPS.find((x) => x > cur + 0.01) ?? cur * 1.2 : [...SIZE_STEPS].reverse().find((x) => x < cur - 0.01) ?? Math.max(4, cur / 1.2);
    custom('Font size', sized(next));
  };
  const def = fontFamily(el.fontFamily);
  const bold = isBold(el.fontWeight);
  const hasBg = !!el.backgroundColor;

  return (
    <>
      <textarea
        className="text-input" value={el.text} rows={3}
        onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, spreadId, el.id, { text: e.target.value }))}
        onBlur={() => useEditor.getState().endGesture('Edit text')}
        onKeyDown={(e) => e.stopPropagation()}
      />

      <div className="field">
        <span>Quick styles</span>
        <div className="quick-styles">
          {TEXT_QUICK_STYLES.map((q) => (
            <button key={q.id} className="quick-style" title={q.name} onClick={() => run(`Quick style: ${q.name}`, (d) => applyQuickStyle(d, spreadId, el.id, q.id))}>
              <span
                style={{
                  fontFamily: `'${q.family}'`, fontWeight: q.weight, fontStyle: q.italic ? 'italic' : undefined,
                  textTransform: q.uppercase ? 'uppercase' : undefined, letterSpacing: q.letterSpacingEm ? `${Math.min(q.letterSpacingEm, 0.15)}em` : undefined,
                  fontSize: q.sizePt >= 30 ? 17 : q.sizePt >= 20 ? 15 : 11,
                  ...(q.background ? { background: q.background.tone === 'text' ? doc.style.textColor : doc.style.background, color: q.background.tone === 'text' ? doc.style.background : doc.style.textColor, padding: '1px 5px' } : {}),
                }}
              >
                {q.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Style</span>
        <select value={el.role} onChange={(e) => run(`Style: ${roleLabel(e.target.value as TextRole)}`, (d) => setTextRole(d, spreadId, el.id, e.target.value as TextRole))}>
          {TEXT_ROLES.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
        </select>
      </div>
      {el.styleLinked !== false ? (
        <p className="muted small style-status">Follows the {roleLabel(el.role)} style — change it everywhere in the {doc.settings.product === 'poster' ? 'Print' : 'Book'} tab.</p>
      ) : (
        <div className="style-status custom">
          <span className="small">Custom look</span>
          <div className="row">
            <button className="link small" onClick={() => run('Reset to style', (d) => resetTextToStyle(d, spreadId, el.id))}>Reset to {roleLabel(el.role)}</button>
            <button className="link small" onClick={() => run(`Update ${roleLabel(el.role)} style`, (d) => saveTextAsRoleStyle(d, spreadId, el.id))}>Use for all {roleLabel(el.role).toLowerCase().replace(/y$/, 'ie')}s</button>
          </div>
        </div>
      )}
      <div className="field">
        <span>Font</span>
        <FontPicker value={el.fontFamily} onChange={(family) => custom('Font', { fontFamily: family, fontWeight: nearestWeight(family, el.fontWeight) })} />
      </div>
      <div className="type-toolbar">
        <button className={`tt-btn ${bold ? 'on' : ''}`} title="Bold" aria-pressed={bold} onClick={() => custom(bold ? 'Not bold' : 'Bold', { fontWeight: bold ? nearestWeight(el.fontFamily, 400) : boldWeight(el.fontFamily) })} style={{ fontWeight: 800 }}>B</button>
        <button className={`tt-btn ${el.italic ? 'on' : ''}`} title={def.italic ? 'Italic' : `${def.family} has no italic`} aria-pressed={!!el.italic} disabled={!def.italic && !el.italic} onClick={() => custom(el.italic ? 'Not italic' : 'Italic', { italic: !el.italic })} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</button>
        <button className={`tt-btn ${el.uppercase ? 'on' : ''}`} title="All capitals" aria-pressed={el.uppercase} onClick={() => custom('Case', { uppercase: !el.uppercase })}>AA</button>
        <select className="tt-weight" value={el.fontWeight} onChange={(e) => custom('Font weight', { fontWeight: Number(e.target.value) })} title="Weight">
          {def.weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
        </select>
      </div>
      <div className="size-row">
        <button className="icon-btn" title="Smaller" onClick={() => stepSize(-1)} style={{ fontSize: 11 }}>A−</button>
        <NumField label="Size" value={el.fontSizePt} min={4} max={400} suffix="pt" apply={live(sized)} undoLabel="Font size" />
        <button className="icon-btn" title="Larger" onClick={() => stepSize(1)} style={{ fontSize: 14 }}>A+</button>
      </div>
      <input
        type="range" aria-label="Font size" min={0} max={SIZE_STEPS.length - 1} step={1}
        value={SIZE_STEPS.reduce((bi, x, i) => (Math.abs(x - el.fontSizePt) < Math.abs(SIZE_STEPS[bi] - el.fontSizePt) ? i : bi), 0)}
        onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, spreadId, el.id, { ...sized(SIZE_STEPS[Number(e.target.value)]), styleLinked: false }))}
        onPointerUp={() => useEditor.getState().endGesture('Font size')}
        onKeyUp={() => useEditor.getState().endGesture('Font size')}
      />
      <div className="field-row">
        <NumField label="Letter spacing" value={Math.round((el.letterSpacingEm ?? 0) * 100)} min={-10} max={60} step={1} suffix="%" apply={live((v) => ({ letterSpacingEm: v / 100 }))} undoLabel="Letter spacing" />
        <NumField label="Line height" value={el.lineHeight} step={0.05} min={0.8} max={3} apply={live((v) => ({ lineHeight: v }))} undoLabel="Line height" />
      </div>
      <div className="field-row">
        <label className="field">
          <span>Colour</span>
          <ColorInput value={el.color} label="Text colour" apply={(d, c) => updateElement(d, spreadId, el.id, { color: c, styleLinked: false })} />
        </label>
        <div className="field">
          <span>Align</span>
          <div className="seg">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={el.align === a ? 'on' : ''} title={a} onClick={() => upd('Align text', { align: a })}>{{ left: '⇤', center: '↔', right: '⇥' }[a]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-title">Background</div>
      <div className="field-row">
        <div className="field">
          <span>Fill</span>
          <div className="seg">
            <button className={!hasBg ? 'on' : ''} onClick={() => upd('No text background', { backgroundColor: undefined, paddingMm: 0 })}>None</button>
            <button className={hasBg ? 'on' : ''} onClick={() => !hasBg && upd('Text background', { backgroundColor: el.color === doc.style.background ? doc.style.textColor : doc.style.background, backgroundOpacity: 0.8, paddingMm: Math.round(el.fontSizePt * MM_PER_PT * 0.35 * 10) / 10 })}>Colour</button>
          </div>
        </div>
        {hasBg && (
          <label className="field">
            <span>Colour</span>
            <ColorInput value={el.backgroundColor!} label="Text background" apply={(d, c) => updateElement(d, spreadId, el.id, { backgroundColor: c })} />
          </label>
        )}
      </div>
      {hasBg && (
        <>
          <label className="field">
            <span>Opacity — {Math.round((el.backgroundOpacity ?? 1) * 100)}%</span>
            <input
              type="range" min={0.05} max={1} step={0.01} value={el.backgroundOpacity ?? 1}
              onChange={(e) => useEditor.getState().gesture((d) => updateElement(d, spreadId, el.id, { backgroundOpacity: Number(e.target.value) }))}
              onPointerUp={() => useEditor.getState().endGesture('Background opacity')}
              onKeyUp={() => useEditor.getState().endGesture('Background opacity')}
            />
          </label>
          <div className="field-row">
            <NumField label="Padding" value={el.paddingMm ?? 0} min={0} max={50} step={0.5} suffix="mm" apply={(d, v) => updateElement(d, spreadId, el.id, { paddingMm: v })} undoLabel="Text padding" />
            <NumField label="Corners" value={el.backgroundRadiusMm ?? 0} min={0} max={100} step={0.5} suffix="mm" apply={(d, v) => updateElement(d, spreadId, el.id, { backgroundRadiusMm: v })} undoLabel="Background corners" />
          </div>
        </>
      )}

      <div className="section-title">Effects</div>
      <TextEffects el={el} spreadId={spreadId} />
    </>
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

      <div className="section-title">Page designs</div>
      <PageAddonsSection spreadIndex={i} />

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
          <div className="section-title">Add an element</div>
          <ElementsPalette surfaceId={spread.id} at={{ x: doc.settings.trimWidthMm * (isPrintable(i, 'right', n) ? 1.5 : 0.5), y: doc.settings.trimHeightMm / 2 }} />
        </>
      )}
    </div>
  );
}

export type { ImageElement };
