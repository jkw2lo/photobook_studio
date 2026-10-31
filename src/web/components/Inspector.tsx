import { useEffect, useRef, useState } from 'react';
import {
  COVER_INDEX, TEXT_ROLES, addChapter, applyMosaicLayout, nearestWeight, resetTextToStyle, roleLabel, saveTextAsRoleStyle, setTextRole, weightName, addTextAt, applyTemplate, defaultCrop, duplicateElement, duplicateSpread, effectiveDpi,
  fitFrameToPhoto, fontFamily, insertSpreadAfter, isPrintable, removeElements, removeSpread, reorderElement, setFramePhoto,
  setSpreadChapter, setSpreadLocked, setSurfaceBackground, shuffleSpreadLayout, spreadPagesLabel, templateName, updateElement,
  MM_PER_PT, TEXT_QUICK_STYLES, textBoxForDirection, findSurface, useAsBackground, applyQuickStyle, estimateTextHeightMm, boldWeight, isBold, type BookDocument, type ImageElement, type TextElement, type TextRole,
} from '../../core';
import { thumbUrl } from '../api';
import { duplicate, remove, togglePin, toggleKeepCrop, toggleKeepRotation, toggleLock } from '../elementActions';
import { selectedElement, useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { BookStyleSettings, PrintSettings, TextColorField, TitleFields, VersionHistory } from './BookPanel';
import { BookTemplatesSection } from './BookTemplates';
import { PosterTemplates } from './PosterTemplates';
import { TypeSection } from './TypePanel';
import { CoverPanel } from './CoverPanel';
import { FontPicker } from './FontPicker';
import { PosterBackgroundPanel, PosterCollagePanel, PosterSheetPanel } from './PosterUI';
import { DraftPanel } from './DraftPanel';
import { CalendarControls } from './CalendarControls';
import { GradeControls, MultiPhotoAdjust, OpacitySlider, PhotoAdjustControls, PhotoShapeControls, ShapeControls, TextEffects } from './DesignPanel';
import { AddPanel, addSections, type AddSection } from './AddPanel';
import { AlignTools, LayersPanel, MultiPanel } from './SelectionPanel';
import { Icon } from './Icon';
import { PreflightPanel } from './PreflightPanel';
import { TextLooksPanel } from './TextLooks';
import { TemplatePicker } from './TemplatePicker';

// The right-hand panel: four tabs that never change name — Layout (the poster or page itself),
// Photo (the selected photo, and all photos), Elements (text, shapes and the rest: add and edit),
// Preflight — each with its own sections in a rail down the left. Layers sit underneath, in a dock
// whose height you drag.

type Top = 'layout' | 'photo' | 'elements' | 'preflight';
type PosterSide = 'collage' | 'templates' | 'background' | 'colour' | 'sheet';
type BookSide = 'page' | 'draft' | 'templates' | 'colour' | 'book';
type PhotoSide = 'photo' | 'adjust' | 'cutout' | 'position';
type ElementsSide = 'selected' | AddSection | 'looks' | 'type';

/** Sub-tabs inside the text, shape and calendar panels (remembered per kind while you work). */
type Sub = { image: 'photo' | 'adjust' | 'cutout' | 'position'; text: 'text' | 'effects' | 'position'; shape: 'shape' | 'position'; calendar: 'calendar' | 'position' };
const DEFAULT_SUB: Sub = { image: 'photo', text: 'text', shape: 'shape', calendar: 'calendar' };

interface RailItem<T extends string> {
  id: T;
  label: string;
  icon: string;
  dim?: boolean;
}

function SideRail<T extends string>({ items, value, onChange, label }: { items: RailItem<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <nav className="side-rail" role="tablist" aria-label={label} aria-orientation="vertical">
      {items.map((x) => (
        <button key={x.id} role="tab" aria-selected={value === x.id} className={`${value === x.id ? 'on' : ''} ${x.dim ? 'dim' : ''}`} onClick={() => onChange(x.id)} title={x.label}>
          <Icon name={x.icon} size={17} />
          <span>{x.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Inspector({ issueCount }: { issueCount: { error: number; warning: number } }) {
  const [top, setTop] = useState<Top>('layout');
  const [posterSide, setPosterSide] = useState<PosterSide>('collage');
  const [bookSide, setBookSide] = useState<BookSide>('page');
  const [photoSide, setPhotoSide] = useState<PhotoSide>('photo');
  const [elementsSide, setElementsSide] = useState<ElementsSide>('text');
  const [sub, setSub] = useState<Sub>(DEFAULT_SUB);
  const selected = useEditor(selectedElement);
  const multiCount = useEditor((s) => s.multi.length);
  const onCover = useEditor((s) => s.currentSpread === COVER_INDEX);
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const collageFocus = useEditor((s) => s.collageFocus);
  const draftFocus = useEditor((s) => s.draftFocus);
  const photoSelected = multiCount <= 1 && selected?.type === 'image';
  // Several photos (and nothing else) selected: adjust them together in Photo › Adjust.
  const photosSelected = useEditor((s) => {
    if (s.multi.length < 2 || !s.doc || !s.selection) return false;
    const els = findSurface(s.doc, s.selection.spreadId)?.surface.elements ?? [];
    return s.multi.every((id) => els.find((e) => e.id === id)?.type === 'image');
  });
  const otherSelected = !!selected && (multiCount > 1 || selected.type !== 'image');

  useEffect(() => {
    if (!collageFocus) return;
    setTop('layout');
    setPosterSide('collage');
  }, [collageFocus]);
  useEffect(() => {
    if (!draftFocus) return;
    setTop('layout');
    setBookSide('draft');
  }, [draftFocus]);
  // Selecting something brings up its controls: photos in Photo, everything else in Elements.
  // Clicking away goes back to the tab you were on, if the selection is what switched it.
  const returnTo = useRef<{ from: Top; to: Top } | null>(null);
  useEffect(() => {
    if (!selected) {
      const r = returnTo.current;
      returnTo.current = null;
      if (r) setTop((t) => (t === r.to ? r.from : t));
      return;
    }
    const to: Top = photoSelected || photosSelected ? 'photo' : 'elements';
    if (photosSelected) setPhotoSide('adjust');
    else if (!photoSelected) setElementsSide('selected');
    setTop((t) => {
      if (t !== to) returnTo.current = { from: returnTo.current?.from ?? t, to };
      return to;
    });
  }, [selected?.id, multiCount > 1]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!otherSelected) setElementsSide((e) => (e === 'selected' ? 'text' : e));
  }, [otherSelected]);

  const layoutItems: RailItem<string>[] = poster
    ? [{ id: 'collage', label: 'Collage', icon: 'grid' }, { id: 'templates', label: 'Templates', icon: 'sparkle' }, { id: 'background', label: 'Background', icon: 'image' }, { id: 'colour', label: 'Colour', icon: 'palette' }, { id: 'sheet', label: 'Sheet', icon: 'fit' }]
    : [{ id: 'page', label: onCover ? 'Cover' : 'Page', icon: 'spread' }, { id: 'draft', label: 'Draft', icon: 'shuffle' }, { id: 'templates', label: 'Templates', icon: 'sparkle' }, { id: 'colour', label: 'Colour', icon: 'palette' }, { id: 'book', label: 'Book', icon: 'page' }];
  const photoItems: RailItem<PhotoSide>[] = [
    { id: 'photo', label: 'Photo', icon: 'crop', dim: !photoSelected },
    { id: 'adjust', label: 'Adjust', icon: 'sliders', dim: !photoSelected && !photosSelected },
    { id: 'cutout', label: 'Cut-out', icon: 'shape', dim: !photoSelected },
    { id: 'position', label: 'Position', icon: 'move', dim: !photoSelected },
  ];
  const elementItems: RailItem<ElementsSide>[] = [
    ...(otherSelected ? [{ id: 'selected' as const, label: 'Selected', icon: 'select' }] : []),
    ...addSections(doc, index).flatMap((x) => {
      const item = { id: x.id as ElementsSide, label: x.label, icon: ({ text: 'text', shapes: 'star', calendar: 'calendar', map: 'map', pages: 'page' } as const)[x.id] };
      return x.id === 'text' ? [item, { id: 'looks' as const, label: 'Looks', icon: 'sparkle' }] : [item];
    }),
    { id: 'type', label: 'Type', icon: 'type' },
  ];

  const layoutSide = poster ? posterSide : bookSide;
  return (
    <aside className="inspector">
      <div className="tabs" role="tablist" aria-label="Panels">
        {([['layout', 'Layout'], ['photo', 'Photo'], ['elements', 'Elements']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={top === id} className={top === id ? 'on' : ''} onClick={() => { returnTo.current = null; setTop(id); }}>{label}</button>
        ))}
        <button role="tab" aria-selected={top === 'preflight'} className={top === 'preflight' ? 'on' : ''} onClick={() => { returnTo.current = null; setTop('preflight'); }}>
          Preflight
          {issueCount.error > 0 ? <span className="pill pill-error">{issueCount.error}</span> : issueCount.warning > 0 ? <span className="pill pill-warn">{issueCount.warning}</span> : <span className="pill pill-ok"><Icon name="check" size={11} /></span>}
        </button>
      </div>
      <div className="inspector-main">
        {top === 'layout' && <SideRail label="Layout" items={layoutItems} value={layoutSide} onChange={(v) => (poster ? setPosterSide(v as PosterSide) : setBookSide(v as BookSide))} />}
        {top === 'photo' && <SideRail label="Photo" items={photoItems} value={photoSide} onChange={setPhotoSide} />}
        {top === 'elements' && <SideRail label="Elements" items={elementItems} value={elementItems.some((x) => x.id === elementsSide) ? elementsSide : 'text'} onChange={setElementsSide} />}
        <div className="inspector-body">
          {top === 'layout' && poster && posterSide === 'collage' && <PosterCollagePanel />}
          {top === 'layout' && poster && posterSide === 'templates' && <div className="stack"><TitleFields /><div className="section-title">Templates</div><PosterTemplates /></div>}
          {top === 'layout' && poster && posterSide === 'background' && <PosterBackgroundPanel />}
          {top === 'layout' && posterSide === 'colour' && poster && <div className="stack"><div className="section-title">Whole poster</div><GradeControls /><p className="muted small">To grade just some photos, select them (Shift-click for several) and use Photo › Adjust.</p></div>}
          {top === 'layout' && bookSide === 'colour' && !poster && <BookColourPanel />}
          {top === 'layout' && poster && posterSide === 'sheet' && <div className="stack"><PosterSheetPanel /><PrintSettings /><VersionHistory /></div>}
          {top === 'layout' && !poster && bookSide === 'page' && (onCover ? <CoverPanel /> : <SpreadPanel />)}
          {top === 'layout' && !poster && bookSide === 'draft' && <DraftPanel />}
          {top === 'layout' && !poster && bookSide === 'templates' && <div className="stack"><TitleFields /><div className="section-title">Book templates</div><BookTemplatesSection /></div>}
          {top === 'layout' && !poster && bookSide === 'book' && <div className="stack"><PrintSettings /><BookStyleSettings /><VersionHistory /></div>}

          {top === 'photo' && photosSelected && (photoSide === 'adjust' ? <MultiSelectionAdjust /> : (
            <div className="panel-empty">
              <Icon name="image" size={22} />
              <p>{multiCount} photos selected. Adjust them together in Adjust, or click one photo to crop, cut or move it.</p>
            </div>
          ))}
          {top === 'photo' && !photosSelected && (photoSelected ? <ElementPanel sub={{ ...sub, image: photoSide }} setSub={setSub} railDriven /> : (
            <div className="panel-empty">
              <Icon name="image" size={22} />
              <p>Click a photo on the {poster ? 'sheet' : 'page'} to crop, adjust or cut it out.</p>
              <p className="muted small">Shift-click several photos to adjust them together. Colour for a whole {poster ? 'poster' : 'page or book'} is in Layout › Colour.</p>
            </div>
          ))}

          {top === 'elements' && elementsSide === 'selected' && otherSelected && (multiCount > 1 ? <MultiPanel /> : <ElementPanel sub={sub} setSub={setSub} />)}
          {top === 'elements' && elementsSide === 'looks' && <TextLooksPanel />}
          {top === 'elements' && elementsSide !== 'selected' && elementsSide !== 'type' && elementsSide !== 'looks' && <AddPanel section={elementsSide} />}
          {top === 'elements' && (elementsSide === 'type' || (elementsSide === 'selected' && !otherSelected)) && (
            <div className="stack"><TextColorField /><TypeSection /></div>
          )}

          {top === 'preflight' && <PreflightPanel />}
        </div>
      </div>
      <LayersDock />
    </aside>
  );
}

/** Several photos selected: one set of adjustments for all of them. */
function MultiSelectionAdjust() {
  const sel = useEditor((s) => s.selection)!;
  const ids = useEditor((s) => s.multi);
  return <MultiPhotoAdjust spreadId={sel.spreadId} ids={ids} />;
}

/** Books: grade this spread (or the cover) on its own, or every photo in the book. */
function BookColourPanel() {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const [scope, setScope] = useState<'page' | 'book'>('page');
  const surface = index === COVER_INDEX ? doc.cover : doc.spreads[index];
  const label = index === COVER_INDEX ? 'This cover' : 'This spread';
  return (
    <div className="stack">
      <div className="seg seg-wide" role="radiogroup" aria-label="Grade what">
        <button role="radio" aria-checked={scope === 'page'} className={scope === 'page' ? 'on' : ''} disabled={!surface} onClick={() => setScope('page')}>{label}{surface?.grade ? ' ●' : ''}</button>
        <button role="radio" aria-checked={scope === 'book'} className={scope === 'book' ? 'on' : ''} onClick={() => setScope('book')}>Whole book{doc.grade ? ' ●' : ''}</button>
      </div>
      {scope === 'page' && surface ? <GradeControls key={surface.id} surfaceId={surface.id} /> : <GradeControls />}
      <p className="muted small">A spread's grade goes on top of the whole book's. To grade just some photos, select them (Shift-click for several) and use Photo › Adjust.</p>
    </div>
  );
}

const LAYERS_KEY = 'photobook:layersHeight';

/** Layers under the panel; drag the divider to give either more room. */
function LayersDock() {
  const [height, setHeight] = useState(() => {
    try {
      return Number(localStorage.getItem(LAYERS_KEY)) || 180;
    } catch {
      return 180;
    }
  });
  const ref = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    const panel = ref.current?.parentElement;
    if (!panel) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const max = panel.clientHeight - 160;
    let next = startH;
    const move = (ev: PointerEvent) => {
      next = Math.max(44, Math.min(max, startH + startY - ev.clientY));
      setHeight(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(LAYERS_KEY, String(Math.round(next)));
      } catch {
        // storage unavailable
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="layers-dock" ref={ref} style={{ height }}>
      <div className="dock-divider" role="separator" aria-orientation="horizontal" aria-label="Resize layers" title="Drag to resize" onPointerDown={onDown} onDoubleClick={() => setHeight(height > 60 ? 44 : 180)}>
        <span />
      </div>
      <LayersPanel docked />
    </div>
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

/** Small tab row inside a panel. */
export function SubTabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="subtabs" role="tablist">
      {items.map((x) => (
        <button key={x.id} role="tab" aria-selected={value === x.id} className={value === x.id ? 'on' : ''} onClick={() => onChange(x.id)}>{x.label}</button>
      ))}
    </div>
  );
}

function ElementPanel({ sub, setSub, railDriven }: { sub: Sub; setSub: (s: Sub) => void; railDriven?: boolean }) {
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

      {el.type === 'image' && !railDriven && (
        <SubTabs
          items={[{ id: 'photo', label: 'Photo' }, ...(el.assetId ? [{ id: 'adjust' as const, label: 'Adjust' }] : []), { id: 'cutout', label: 'Cut-out' }, { id: 'position', label: 'Position' }]}
          value={!el.assetId && sub.image === 'adjust' ? 'photo' : sub.image} onChange={(v) => setSub({ ...sub, image: v })}
        />
      )}
      {el.type === 'text' && <SubTabs items={[{ id: 'text', label: 'Text' }, { id: 'effects', label: 'Effects' }, { id: 'position', label: 'Position' }]} value={sub.text} onChange={(v) => setSub({ ...sub, text: v })} />}
      {el.type === 'shape' && <SubTabs items={[{ id: 'shape', label: el.outline ? 'Map' : 'Shape' }, { id: 'position', label: 'Position' }]} value={sub.shape} onChange={(v) => setSub({ ...sub, shape: v })} />}
      {el.type === 'calendar' && <SubTabs items={[{ id: 'calendar', label: 'Calendar' }, { id: 'position', label: 'Position' }]} value={sub.calendar} onChange={(v) => setSub({ ...sub, calendar: v })} />}

      {el.type === 'image' && sub.image === 'adjust' && el.assetId && assets.get(el.assetId) && (
        <PhotoAdjustControls el={el} spreadId={sel.spreadId} analysis={assets.get(el.assetId)!.analysis} />
      )}
      {el.type === 'image' && sub.image === 'cutout' && (
        <>
          <div className="section-title">Cut by hand</div>
          <div className="btn-grid">
            {(['keep', 'erase', 'circle'] as const).map((mode) => (
              <button key={mode} className="btn btn-small" disabled={!el.assetId || el.locked} onClick={() => useEditor.getState().setCanvasTool({ kind: 'cut', surfaceId: sel.spreadId, elementId: el.id, mode })}
                title={{ keep: 'Draw around the part to keep — e.g. along a mountain ridge', erase: 'Draw around parts to remove', circle: 'Drag out circles to remove' }[mode]}>
                <Icon name={mode === 'keep' ? 'crop' : mode === 'erase' ? 'x' : 'shape'} /> {{ keep: 'Keep an outline', erase: 'Erase', circle: 'Circle eraser' }[mode]}
              </button>
            ))}
            {el.mask?.kind === 'cut' && <button className="btn btn-small" onClick={() => upd('Undo cut-out', { mask: undefined } as Partial<ImageElement>)}>Clear cut</button>}
          </div>
          <p className="muted small">Cut a photo along any line so it overlaps the next one naturally — the cut moves and resizes with the frame.</p>
          <div className="section-title">Shapes</div>
          <PhotoShapeControls el={el} spreadId={sel.spreadId} />
          <div className="section-title">Border</div>
          <div className="field-row">
            <NumField label="Border" value={el.borderMm} min={0} max={20} suffix="mm" onCommit={(v) => upd('Border', { borderMm: v })} />
            <label className="field">
              <span>Colour</span>
              <ColorInput value={el.borderColor} label="Border colour" apply={(d, c) => updateElement(d, sel.spreadId, el.id, { borderColor: c })} />
            </label>
          </div>
          {el.mask && <p className="muted small">Borders don’t apply to cut-out photos.</p>}
        </>
      )}
      {el.type === 'image' && (sub.image === 'photo' || (sub.image === 'adjust' && !el.assetId)) && (() => {
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
            <OpacitySlider spreadId={sel.spreadId} ids={[el.id]} value={el.opacity ?? 1} />
          </>
        );
      })()}

      {el.type === 'text' && sub.text !== 'position' && <TextControls el={el} spreadId={sel.spreadId} part={sub.text} />}
      {el.type === 'shape' && sub.shape === 'shape' && <ShapeControls el={el} spreadId={sel.spreadId} />}
      {el.type === 'calendar' && sub.calendar === 'calendar' && <CalendarControls el={el} spreadId={sel.spreadId} />}

      {isPositionTab(el.type, sub) && (
        <>
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
      <RotationField spreadId={sel.spreadId} el={el} />
      <div className="field-row">
        <div className="field">
          <span>Arrange</span>
          <div className="row">
            <button className="icon-btn" title="Bring to front" onClick={() => run('Bring to front', (d) => reorderElement(d, sel.spreadId, el.id, 'front'))}>↑</button>
            <button className="icon-btn" title="Send to back" onClick={() => run('Send to back', (d) => reorderElement(d, sel.spreadId, el.id, 'back'))}>↓</button>
          </div>
        </div>
      </div>
      <p className="muted small">Double-click a photo to crop, or text to edit. Arrow keys nudge 0.5 mm (Shift: 5 mm). Hold Alt while dragging to turn off snapping.</p>
        </>
      )}
    </div>
  );
}

const isPositionTab = (type: keyof Sub, sub: Sub) => sub[type] === 'position';

/** Rotation: a dial-like slider, quarter turns, straighten, and the exact angle. */
function RotationField({ spreadId, el }: { spreadId: string; el: { id: string; rotationDeg: number; locked: boolean } }) {
  const { run, gesture, endGesture } = useEditor.getState();
  const norm = (deg: number) => ((((deg % 360) + 540) % 360) - 180);
  const turn = (by: number) => run(by ? 'Rotate' : 'Straighten', (d) => updateElement(d, spreadId, el.id, { rotationDeg: by ? norm(el.rotationDeg + by) : 0 }));
  return (
    <div className="field rotation-field">
      <span>Rotation — {Math.round(el.rotationDeg * 10) / 10}°</span>
      <div className="row">
        <input type="range" min={-180} max={180} step={1} value={el.rotationDeg} aria-label="Rotation" disabled={el.locked}
          onChange={(e) => gesture((d) => updateElement(d, spreadId, el.id, { rotationDeg: Number(e.target.value) }))}
          onPointerUp={() => endGesture('Rotate')} onKeyUp={() => endGesture('Rotate')} onDoubleClick={() => turn(0)} />
        <button className="icon-btn" title="Turn left 90°" disabled={el.locked} onClick={() => turn(-90)}>⟲</button>
        <button className="icon-btn" title="Turn right 90°" disabled={el.locked} onClick={() => turn(90)}>⟳</button>
        <button className="icon-btn" title="Straighten" disabled={el.locked || !el.rotationDeg} onClick={() => turn(0)}>0°</button>
      </div>
      <p className="muted small">Or drag just outside any corner of the selection.</p>
    </div>
  );
}

// ---- text ------------------------------------------------------------------------------------

const SIZE_STEPS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 84, 96, 120, 144, 180, 220, 300];

function TextControls({ el, spreadId, part }: { el: TextElement; spreadId: string; part: 'text' | 'effects' }) {
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

  if (part === 'effects') return <TextEffectsPart el={el} spreadId={spreadId} />;
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
        <p className="muted small style-status">Follows the {roleLabel(el.role)} style — change it everywhere in Elements › Type.</p>
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
      <TextDirection el={el} spreadId={spreadId} />

    </>
  );
}

/**
 * Which way the text runs: across, letters stacked down the page, or turned sideways (reading up or
 * down). Stacking resizes the box around its centre to fit a column of letters.
 */
function TextDirection({ el, spreadId }: { el: TextElement; spreadId: string }) {
  const { run } = useEditor.getState();
  const rot = Math.round(el.rotationDeg);
  const current = el.vertical ? 'stacked' : rot === -90 ? 'up' : rot === 90 ? 'down' : rot === 0 ? 'across' : null;
  const set = (dir: 'across' | 'stacked' | 'up' | 'down') => run(`Text: ${dir}`, (d) => {
    const vertical = dir === 'stacked';
    const size = vertical !== !!el.vertical ? textBoxForDirection(el, vertical) : { widthMm: el.widthMm, heightMm: el.heightMm };
    const cx = el.xMm + el.widthMm / 2;
    const cy = el.yMm + el.heightMm / 2;
    return updateElement(d, spreadId, el.id, {
      vertical: vertical || undefined, arch: vertical ? undefined : el.arch,
      rotationDeg: dir === 'up' ? -90 : dir === 'down' ? 90 : 0,
      ...size, xMm: cx - size.widthMm / 2, yMm: cy - size.heightMm / 2,
    });
  });
  return (
    <div className="field">
      <span>Direction</span>
      <div className="seg seg-wide text-direction">
        <button className={current === 'across' ? 'on' : ''} onClick={() => set('across')} title="Left to right">Across</button>
        <button className={current === 'stacked' ? 'on' : ''} onClick={() => set('stacked')} title="Letters stacked top to bottom">Stacked</button>
        <button className={current === 'up' ? 'on' : ''} onClick={() => set('up')} title="Turned sideways, reading upwards">Up ↑</button>
        <button className={current === 'down' ? 'on' : ''} onClick={() => set('down')} title="Turned sideways, reading downwards">Down ↓</button>
      </div>
    </div>
  );
}

/** Text panel → Effects: background fill, gradient letters, curve, outline, shadow. */
function TextEffectsPart({ el, spreadId }: { el: TextElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const { run } = useEditor.getState();
  const upd = (label: string, patch: Partial<TextElement>) => run(label, (d) => updateElement(d, spreadId, el.id, patch));
  const hasBg = !!el.backgroundColor;
  return (
    <>
      <OpacitySlider spreadId={spreadId} ids={[el.id]} value={el.opacity ?? 1} label="Opacity (whole box)" />
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

      <div className="section-title">Letters</div>
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

      <p className="muted small">Text, shapes, calendars, maps and ready-made pages (contents, quotes…) are in the <strong>Elements</strong> tab.</p>

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
