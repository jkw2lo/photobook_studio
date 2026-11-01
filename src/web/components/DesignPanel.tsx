import { useEffect, useState } from 'react';
import {
  GRADE_PRESETS, MM_PER_PT, PHOTO_SHAPES, addCalendarAt, addElement, reorderElements, fitPath, makeShapeElement, type PlaceOutline, autoAdjust, photoDays, SHAPES, SHAPE_CATEGORIES, addShapeAt, fontFamily, gradeColor, gradeFromPreset, isNeutralGrade, nearestWeight, scalePath,
  updateElement, weightName, NO_GRADE, findSurface, setSurfaceGrade, type BookDocument, type ColorGrade, type Gradient, type ImageElement, type ShapeCategory, type ShapeElement,
  type TextElement,
} from '../../core';
import { api } from '../api';
import { useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { FontPicker } from './FontPicker';
import { Icon } from './Icon';
import { NumField } from './Inspector';
import { PlacePicker } from './PlacePicker';

// Design tools: the elements palette (shapes, banners, lines, icons), shape settings, photo
// cut-outs, text effects and the colour grade.

/** A library shape drawn small, for pickers. */
export function ShapeGlyph({ id, d, evenOdd, size = 26, aspect }: { id?: string; d?: string; evenOdd?: boolean; size?: number; aspect?: number }) {
  // A raw outline (map) is drawn in a (100 × aspect) × 100 box and fitted without distortion.
  if (d && aspect) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <path d={fitPath(d, 100 * aspect, 100, size, size)} fill="currentColor" />
      </svg>
    );
  }
  const def = SHAPES.find((s) => s.id === id);
  const path = d ?? def?.d ?? '';
  const ratio = def ? Math.min(3, Math.max(0.5, def.aspect)) : 1;
  const w = ratio >= 1 ? size : size * ratio;
  const h = ratio >= 1 ? size / ratio : size;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`translate(${(size - w) / 2} ${(size - h) / 2})`}>
        <path d={scalePath(path, w, Math.max(h, def?.category === 'line' ? 3 : h))} fill="currentColor" fillRule={(evenOdd ?? def?.evenOdd) ? 'evenodd' : 'nonzero'} />
      </g>
    </svg>
  );
}

/** Opacity of any element (photo, text, shape, calendar) — one undo step per drag. */
export function OpacitySlider({ spreadId, ids, value, label = 'Opacity' }: { spreadId: string; ids: string[]; value: number; label?: string }) {
  const { gesture, endGesture } = useEditor.getState();
  return (
    <label className="field">
      <span>{label} — {Math.round(value * 100)}%</span>
      <input
        type="range" min={0.05} max={1} step={0.01} value={value} aria-label={label}
        onChange={(e) => {
          const v = Number(e.target.value);
          gesture((d) => ids.reduce((acc, id) => updateElement(acc, spreadId, id, { opacity: v }), d));
        }}
        onPointerUp={() => endGesture('Opacity')} onKeyUp={() => endGesture('Opacity')}
      />
    </label>
  );
}

// ---- elements palette ------------------------------------------------------------------------------

export function ElementsPalette({ surfaceId, at, only }: { surfaceId: string; at: { x: number; y: number }; only?: 'shapes' | 'calendar' | 'map' }) {
  const [picked, setCat] = useState<ShapeCategory | 'calendar' | 'map'>('shape');
  // Shown as one part of the Elements tab: calendars and maps get their own sections there.
  const cat = only === 'calendar' ? 'calendar' : only === 'map' ? 'map' : only === 'shapes' && (picked === 'calendar' || picked === 'map') ? 'shape' : picked;
  const [mapFill, setMapFill] = useState<'outline' | 'filled'>('outline');
  const [mapPlace, setMapPlace] = useState<'sticker' | 'background'>('sticker');
  const addMap = (o: PlaceOutline) => {
    const st = useEditor.getState();
    const d = st.doc!;
    const short = Math.min(d.settings.trimWidthMm, d.settings.trimHeightMm);
    // A sticker is a modest size; a background fills most of the page (or sheet) behind the photos.
    const back = mapPlace === 'background';
    const boxW = back ? d.settings.trimWidthMm * 0.92 : short * 0.45;
    const boxH = back ? d.settings.trimHeightMm * 0.92 : short * 0.45;
    const w = Math.min(boxW, boxH * o.aspect);
    const h = w / o.aspect;
    const surface = d.cover?.id === surfaceId ? d.cover : d.spreads.find((sp) => sp.id === surfaceId);
    const paper = surface?.background ?? d.style.background;
    const dark = parseInt(paper.slice(1, 3), 16) * 0.2126 + parseInt(paper.slice(3, 5), 16) * 0.7152 + parseInt(paper.slice(5, 7), 16) * 0.0722 < 115;
    const ink = dark ? '#f5f2ea' : d.style.textColor;
    let id = '';
    st.run(back ? `Add map background: ${o.name}` : `Add map: ${o.name}`, (doc) => {
      const el = {
        ...makeShapeElement({ x: at.x - w / 2, y: at.y - h / 2, w, h }, mapFill === 'filled' ? ink : 'none', back ? (mapFill === 'filled' ? 0.14 : 0.35) : 1),
        outline: o,
        ...(mapFill === 'outline' ? { strokeColor: ink, strokeWidthMm: Math.max(0.5, short * (back ? 0.003 : 0.004)) } : {}),
        ...(back ? { behind: true } : {}),
      };
      id = el.id;
      const added = addElement(doc, surfaceId, el);
      return back ? reorderElements(added, surfaceId, [el.id], 'back') : added;
    });
    if (id) st.select({ spreadId: surfaceId, elementId: id });
  };
  const addCalendar = (mode: 'range' | 'month') => {
    const st = useEditor.getState();
    const days = photoDays(st.assets.filter((a) => !a.excluded && !a.missing));
    let id = '';
    st.run(mode === 'range' ? 'Add trip calendar' : 'Add month calendar', (d) => {
      const r = addCalendarAt(d, surfaceId, at.x, at.y, days, { mode });
      id = r.newId;
      return r.doc;
    });
    if (id) st.select({ spreadId: surfaceId, elementId: id });
  };
  const add = (shapeId: string, name: string) => {
    let id = '';
    // Each new element lands a little offset from the last, so they don't stack exactly.
    const n = useEditor.getState().doc?.spreads.find((s) => s.id === surfaceId)?.elements.length ?? 0;
    const off = ((n % 5) - 2) * 6;
    useEditor.getState().run(`Add ${name.toLowerCase()}`, (d) => {
      const r = addShapeAt(d, surfaceId, shapeId, at.x + off, at.y + off);
      id = r.newId;
      return r.doc;
    });
    if (id) useEditor.getState().select({ spreadId: surfaceId, elementId: id });
  };
  return (
    <div className="palette">
      {only !== 'calendar' && only !== 'map' && (
        <div className="seg seg-wide">
          {SHAPE_CATEGORIES.map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>
          ))}
          {!only && <button className={cat === 'calendar' ? 'on' : ''} onClick={() => setCat('calendar')}>Calendar</button>}
          {!only && <button className={cat === 'map' ? 'on' : ''} onClick={() => setCat('map')}>Map</button>}
        </div>
      )}
      {cat === 'map' ? (
        <>
          <div className="seg seg-wide">
            <button className={mapPlace === 'sticker' ? 'on' : ''} onClick={() => setMapPlace('sticker')} title="On top of everything, at a modest size">Sticker</button>
            <button className={mapPlace === 'background' ? 'on' : ''} onClick={() => setMapPlace('background')} title="Large and faint, behind the photos">Background</button>
          </div>
          <div className="seg seg-wide">
            <button className={mapFill === 'outline' ? 'on' : ''} onClick={() => setMapFill('outline')}>Outline</button>
            <button className={mapFill === 'filled' ? 'on' : ''} onClick={() => setMapFill('filled')}>Filled</button>
          </div>
          <PlacePicker action="add" onPick={addMap} />
          <p className="muted small">
            {mapPlace === 'background'
              ? 'A large, faint outline behind the photos — it stays behind them when you Arrange. Change its colour and opacity in its panel.'
              : 'A place’s outline as a sticker — lay it over photos from there.'} To fill the shape with a photo instead, select the photo and use Cut-out → Map.
          </p>
        </>
      ) : cat === 'calendar' ? (
        <>
          <div className="btn-grid">
            <button className="btn btn-small" onClick={() => addCalendar('range')} title="Only the weeks of the trip, photo days marked"><Icon name="grid" /> Trip weeks</button>
            <button className="btn btn-small" onClick={() => addCalendar('month')} title="The whole month, photo days marked"><Icon name="grid" /> Whole month</button>
          </div>
          <p className="muted small">Dates and marks come from your photos; change them in the calendar’s panel.</p>
        </>
      ) : (
      <div className="palette-grid">
        {SHAPES.filter((s) => s.category === cat).map((s) => (
          <button key={s.id} className="palette-item" title={s.name} aria-label={`Add ${s.name}`} onClick={() => add(s.id, s.name)}>
            <ShapeGlyph id={s.id} />
          </button>
        ))}
      </div>
      )}
      {cat !== 'calendar' && cat !== 'map' && <p className="muted small">{cat === 'banner' ? 'Banners come with a text box on top.' : 'Click to add; drag and resize it on the page. Text and shapes stay put when you Arrange.'}</p>}
    </div>
  );
}

// ---- gradient editor (text and shapes) --------------------------------------------------------------

function GradientFields({ value, apply, label }: { value: Gradient; apply: (d: BookDocument, g: Gradient) => BookDocument; label: string }) {
  const { gesture, endGesture, run } = useEditor.getState();
  return (
    <div className="stack tight">
      <div className="field-row">
        <label className="field">
          <span>From</span>
          <ColorInput value={value.from} label={`${label} gradient`} apply={(d, c) => apply(d, { ...value, from: c })} />
        </label>
        <label className="field">
          <span>To</span>
          <ColorInput value={value.to} label={`${label} gradient`} apply={(d, c) => apply(d, { ...value, to: c })} />
        </label>
        <button className="icon-btn" title="Swap colours" onClick={() => run('Swap gradient colours', (d) => apply(d, { ...value, from: value.to, to: value.from }))}>⇄</button>
      </div>
      <label className="field">
        <span>Direction — {value.angleDeg}°</span>
        <input
          type="range" min={0} max={360} step={15} value={value.angleDeg} aria-label="Gradient direction"
          onChange={(e) => gesture((d) => apply(d, { ...value, angleDeg: Number(e.target.value) }))}
          onPointerUp={() => endGesture(`${label} gradient direction`)} onKeyUp={() => endGesture(`${label} gradient direction`)}
        />
      </label>
    </div>
  );
}

const defaultGradient = (doc: BookDocument, base: string): Gradient => ({ from: base, to: base.toLowerCase() === doc.style.textColor.toLowerCase() ? '#d4626e' : doc.style.textColor, angleDeg: 90 });

// ---- shape element ---------------------------------------------------------------------------------

export function ShapeControls({ el, spreadId }: { el: ShapeElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const { run, gesture, endGesture } = useEditor.getState();
  const upd = (label: string, patch: Partial<ShapeElement>) => run(label, (d) => updateElement(d, spreadId, el.id, patch));
  const [picking, setPicking] = useState(false);
  const current = el.outline ? undefined : SHAPES.find((s) => s.id === (el.shape ?? 'rect'));
  return (
    <div className="stack">
      <div className="field">
        <span>Shape</span>
        <button className="btn btn-small shape-current" onClick={() => setPicking(!picking)}>
          {el.outline ? <ShapeGlyph d={el.outline.d} aspect={el.outline.aspect} size={20} /> : <ShapeGlyph id={current?.id} size={20} />} {el.outline ? `Map · ${el.outline.name}` : current?.name ?? 'Rectangle'} <Icon name="down" size={12} />
        </button>
      </div>
      {picking && (
        <div className="palette-grid">
          {SHAPES.map((s) => (
            <button key={s.id} className={`palette-item ${s.id === (el.shape ?? 'rect') ? 'on' : ''}`} title={s.name} onClick={() => { upd(`Shape: ${s.name}`, { shape: s.id, outline: undefined }); setPicking(false); }}>
              <ShapeGlyph id={s.id} />
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <span>Fill</span>
        <div className="seg seg-wide">
          <button className={!el.gradient && el.fill === 'none' ? 'on' : ''} onClick={() => upd('No fill', { gradient: undefined, fill: 'none', strokeWidthMm: el.strokeWidthMm || 0.6, strokeColor: el.strokeColor ?? doc.style.textColor })}>None</button>
          <button className={!el.gradient && el.fill !== 'none' ? 'on' : ''} onClick={() => upd('Solid fill', { gradient: undefined, fill: el.fill === 'none' ? el.strokeColor ?? doc.style.textColor : el.fill })}>Solid</button>
          <button className={el.gradient ? 'on' : ''} onClick={() => !el.gradient && upd('Gradient fill', { gradient: defaultGradient(doc, el.fill === 'none' ? doc.style.textColor : el.fill) })}>Gradient</button>
        </div>
      </div>
      {el.gradient ? (
        <GradientFields value={el.gradient} label="Shape" apply={(d, g) => updateElement(d, spreadId, el.id, { gradient: g })} />
      ) : el.fill === 'none' ? null : (
        <label className="field">
          <span>Colour</span>
          <ColorInput value={el.fill} label="Fill colour" apply={(d, c) => updateElement(d, spreadId, el.id, { fill: c })} />
        </label>
      )}
      <div className="field-row">
        <label className="field">
          <span>Outline</span>
          <ColorInput value={el.strokeColor ?? '#000000'} label="Outline colour" apply={(d, c) => updateElement(d, spreadId, el.id, { strokeColor: c, strokeWidthMm: el.strokeWidthMm || 0.5 })} />
        </label>
        <NumField label="Width" value={el.strokeWidthMm ?? 0} min={0} max={20} step={0.25} suffix="mm" apply={(d, v) => updateElement(d, spreadId, el.id, { strokeWidthMm: v })} undoLabel="Outline width" />
      </div>
      <label className="field check" title="Draw it behind the photos (and keep it there when you Arrange)">
        <input
          type="checkbox" checked={!!el.behind}
          onChange={(e) => run(e.target.checked ? 'Send behind photos' : 'Bring in front of photos', (d) => reorderElements(updateElement(d, spreadId, el.id, { behind: e.target.checked || undefined }), spreadId, [el.id], e.target.checked ? 'back' : 'front'))}
        />
        <span>Behind the photos (background layer)</span>
      </label>
      <label className="field">
        <span>Opacity — {Math.round(el.opacity * 100)}%</span>
        <input
          type="range" min={0.05} max={1} step={0.01} value={el.opacity}
          onChange={(e) => gesture((d) => updateElement(d, spreadId, el.id, { opacity: Number(e.target.value) }))}
          onPointerUp={() => endGesture('Opacity')} onKeyUp={() => endGesture('Opacity')}
        />
      </label>
    </div>
  );
}

// ---- photo cut-outs --------------------------------------------------------------------------------

export function PhotoShapeControls({ el, spreadId }: { el: ImageElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const { run, toast } = useEditor.getState();
  const textMask = el.mask?.kind === 'text' ? el.mask : null;
  // On posters a hand-picked cut-out is kept through Arrange (it would otherwise be replaced by the
  // collage's photo shape).
  const keep = doc.settings.product === 'poster' ? { keepCrop: true } : {};
  const [text, setText] = useState(textMask?.text ?? doc.title.split(' ')[0]?.toUpperCase() ?? 'LOVE');
  const [family, setFamily] = useState(textMask?.fontFamily ?? 'Abril Fatface');
  const [weight, setWeight] = useState(textMask?.fontWeight ?? 400);
  const [mode, setMode] = useState<'shape' | 'text' | 'map'>(textMask ? 'text' : el.mask?.kind === 'outline' ? 'map' : 'shape');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (textMask) {
      setText(textMask.text);
      setFamily(textMask.fontFamily);
      setWeight(textMask.fontWeight);
    }
    // only when switching photos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id]);

  const applyText = async (t = text, f = family, w = weight) => {
    if (!t.trim()) return;
    setBusy(true);
    try {
      const o = await api.textOutline({ text: t, fontFamily: f, fontWeight: w, uppercase: false });
      run('Cut photo to text', (d) => updateElement(d, spreadId, el.id, { mask: { kind: 'text', text: t, fontFamily: f, fontWeight: w, d: o.d, aspect: o.aspect }, ...keep }));
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="seg seg-wide">
        <button className={mode === 'shape' ? 'on' : ''} onClick={() => setMode('shape')}>Shape</button>
        <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>Text</button>
        <button className={mode === 'map' ? 'on' : ''} onClick={() => setMode('map')}>Map</button>
      </div>
      {mode === 'map' ? (
        <>
          {el.mask?.kind === 'outline' && (
            <div className="row between">
              <span className="small">Cut to {el.mask.name}</span>
              <button className="link small" onClick={() => run('Remove map cut-out', (d) => updateElement(d, spreadId, el.id, { mask: undefined }))}>Remove</button>
            </div>
          )}
          <PlacePicker action="cut" onPick={(o) => run(`Cut photo to ${o.name}`, (d) => updateElement(d, spreadId, el.id, { mask: { kind: 'outline', ...o }, ...keep }))} />
        </>
      ) : mode === 'shape' ? (
        <div className="palette-grid">
          <button className={`palette-item ${!el.mask ? 'on' : ''}`} title="No shape" onClick={() => run('Remove photo shape', (d) => updateElement(d, spreadId, el.id, { mask: undefined }))}>
            <Icon name="x" />
          </button>
          {PHOTO_SHAPES.filter((s) => s.id !== 'rect').map((s) => (
            <button
              key={s.id} className={`palette-item ${el.mask?.kind === 'shape' && el.mask.shape === s.id ? 'on' : ''}`} title={s.name}
              onClick={() => run(`Photo shape: ${s.name}`, (d) => updateElement(d, spreadId, el.id, { mask: { kind: 'shape', shape: s.id }, ...keep }))}
            >
              <ShapeGlyph id={s.id} />
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="row">
            <input className="text-mask-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void applyText(); }} placeholder="A word or two" aria-label="Cut-out text" />
            <button className="btn btn-small btn-primary" disabled={busy || !text.trim()} onClick={() => void applyText()}>{textMask ? 'Update' : 'Cut'}</button>
          </div>
          <div className="field-row">
            <div className="field">
              <span>Font</span>
              <FontPicker value={family} onChange={(f) => { const w = nearestWeight(f, 900); setFamily(f); setWeight(w); if (textMask) void applyText(text, f, w); }} />
            </div>
            <label className="field">
              <span>Weight</span>
              <select value={weight} onChange={(e) => { const w = Number(e.target.value); setWeight(w); if (textMask) void applyText(text, family, w); }}>
                {fontFamily(family).weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small">The photo fills the letters. Heavy fonts (Abril Fatface, Black weights) show the most photo. Size the frame to the word.</p>
          {textMask && <button className="link small" onClick={() => run('Remove text cut-out', (d) => updateElement(d, spreadId, el.id, { mask: undefined }))}>Remove text cut-out</button>}
        </>
      )}
    </div>
  );
}

// ---- text effects ----------------------------------------------------------------------------------

export function TextEffects({ el, spreadId }: { el: TextElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const { run, gesture, endGesture } = useEditor.getState();
  const upd = (label: string, patch: Partial<TextElement>) => run(label, (d) => updateElement(d, spreadId, el.id, { ...patch, styleLinked: false }));
  const live = (patch: (v: number) => Partial<TextElement>) => (d: BookDocument, v: number) => updateElement(d, spreadId, el.id, patch(v));
  const shadow = el.shadow;
  return (
    <div className="stack">
      <div className="field">
        <span>Letters</span>
        <div className="seg seg-wide">
          <button className={!el.gradient ? 'on' : ''} onClick={() => upd('Solid text colour', { gradient: undefined })}>Solid</button>
          <button className={el.gradient ? 'on' : ''} onClick={() => !el.gradient && upd('Gradient text', { gradient: defaultGradient(doc, el.color) })}>Gradient</button>
        </div>
      </div>
      {el.gradient && <GradientFields value={el.gradient} label="Text" apply={(d, g) => updateElement(d, spreadId, el.id, { gradient: g, styleLinked: false })} />}

      <label className="field">
        <span>Curve — {el.arch ? `${Math.abs(el.arch)}% ${el.arch > 0 ? 'arch' : 'smile'}` : 'straight'}</span>
        <input
          type="range" min={-100} max={100} step={1} value={el.arch ?? 0} aria-label="Text curve"
          onChange={(e) => {
            // A stronger curve needs a taller box (the arc's rise plus a line of text).
            const arch = Number(e.target.value) || undefined;
            const need = ((Math.abs(arch ?? 0) / 100) * el.widthMm) / 2 + el.fontSizePt * MM_PER_PT * 1.3;
            gesture((d) => updateElement(d, spreadId, el.id, { arch, heightMm: Math.max(el.heightMm, need) }));
          }}
          onPointerUp={() => endGesture('Curve text')} onKeyUp={() => endGesture('Curve text')} onDoubleClick={() => upd('Straighten text', { arch: undefined })}
        />
      </label>
      {!!el.arch && <p className="muted small">Curved text is one line. Make the box wider for a gentler curve; double-click the slider to straighten.</p>}

      <div className="field-row">
        <label className="field">
          <span>Outline</span>
          <ColorInput value={el.strokeColor ?? '#ffffff'} label="Text outline" apply={(d, c) => updateElement(d, spreadId, el.id, { strokeColor: c, strokeWidthMm: el.strokeWidthMm || Math.max(0.3, el.fontSizePt * 0.02), styleLinked: false })} />
        </label>
        <NumField label="Width" value={el.strokeWidthMm ?? 0} min={0} max={10} step={0.1} suffix="mm" apply={live((v) => ({ strokeWidthMm: v || undefined }))} undoLabel="Outline width" />
      </div>

      <div className="field">
        <span>Shadow</span>
        <div className="seg seg-wide">
          <button className={!shadow ? 'on' : ''} onClick={() => upd('No shadow', { shadow: undefined })}>None</button>
          <button className={shadow ? 'on' : ''} onClick={() => !shadow && upd('Text shadow', { shadow: { color: '#000000', dxMm: Math.max(0.4, el.fontSizePt * 0.012), dyMm: Math.max(0.4, el.fontSizePt * 0.012), opacity: 0.35 } })}>Drop shadow</button>
        </div>
      </div>
      {shadow && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Colour</span>
              <ColorInput value={shadow.color} label="Shadow colour" apply={(d, c) => updateElement(d, spreadId, el.id, { shadow: { ...shadow, color: c } })} />
            </label>
            <NumField label="Offset" value={shadow.dxMm} min={0} max={20} step={0.1} suffix="mm" apply={live((v) => ({ shadow: { ...shadow, dxMm: v, dyMm: v } }))} undoLabel="Shadow offset" />
          </div>
          <label className="field">
            <span>Shadow opacity — {Math.round(shadow.opacity * 100)}%</span>
            <input
              type="range" min={0.05} max={1} step={0.01} value={shadow.opacity}
              onChange={(e) => gesture((d) => updateElement(d, spreadId, el.id, { shadow: { ...shadow, opacity: Number(e.target.value) } }))}
              onPointerUp={() => endGesture('Shadow opacity')} onKeyUp={() => endGesture('Shadow opacity')}
            />
          </label>
        </>
      )}

      <div className="field">
        <span>3D letters</span>
        <div className="seg seg-wide">
          <button className={!el.extrude ? 'on' : ''} onClick={() => upd('Flat letters', { extrude: undefined })}>Flat</button>
          <button className={el.extrude ? 'on' : ''} onClick={() => !el.extrude && upd('3D letters', { extrude: { color: darker(el.color), depthMm: Math.max(0.8, el.fontSizePt * 0.035), angleDeg: 45 } })}>Block</button>
        </div>
      </div>
      {el.extrude && (
        <>
          <div className="field-row">
            <label className="field">
              <span>Side colour</span>
              <ColorInput value={el.extrude.color} label="3D side colour" apply={(d, c) => updateElement(d, spreadId, el.id, { extrude: { ...el.extrude!, color: c } })} />
            </label>
            <NumField label="Depth" value={el.extrude.depthMm} min={0.2} max={30} step={0.1} suffix="mm" apply={live((v) => ({ extrude: { ...el.extrude!, depthMm: v } }))} undoLabel="3D depth" />
          </div>
          <label className="field">
            <span>Direction — {Math.round(el.extrude.angleDeg)}°</span>
            <input type="range" min={0} max={359} step={1} value={el.extrude.angleDeg} aria-label="3D direction"
              onChange={(e) => gesture((d) => updateElement(d, spreadId, el.id, { extrude: { ...el.extrude!, angleDeg: Number(e.target.value) } }))}
              onPointerUp={() => endGesture('3D direction')} onKeyUp={() => endGesture('3D direction')} />
          </label>
        </>
      )}

      <div className="field">
        <span>Glow</span>
        <div className="seg seg-wide">
          <button className={!el.glow ? 'on' : ''} onClick={() => upd('No glow', { glow: undefined })}>None</button>
          <button className={el.glow ? 'on' : ''} onClick={() => !el.glow && upd('Neon glow', { glow: { color: el.color, sizeMm: Math.max(0.8, el.fontSizePt * 0.05) } })}>Neon</button>
        </div>
      </div>
      {el.glow && (
        <div className="field-row">
          <label className="field">
            <span>Glow colour</span>
            <ColorInput value={el.glow.color} label="Glow colour" apply={(d, c) => updateElement(d, spreadId, el.id, { glow: { ...el.glow!, color: c } })} />
          </label>
          <NumField label="Size" value={el.glow.sizeMm} min={0.2} max={20} step={0.1} suffix="mm" apply={live((v) => ({ glow: { ...el.glow!, sizeMm: v } }))} undoLabel="Glow size" />
        </div>
      )}

      <div className="field-row">
        <label className="field">
          <span>Outer outline</span>
          <ColorInput value={el.outline2?.color ?? '#000000'} label="Outer outline" apply={(d, c) => updateElement(d, spreadId, el.id, { outline2: { color: c, widthMm: el.outline2?.widthMm || Math.max(0.3, el.fontSizePt * 0.02) }, styleLinked: false })} />
        </label>
        <NumField label="Width" value={el.outline2?.widthMm ?? 0} min={0} max={10} step={0.1} suffix="mm" apply={live((v) => ({ outline2: v ? { color: el.outline2?.color ?? '#000000', widthMm: v } : undefined }))} undoLabel="Outer outline" />
      </div>

      <label className="field">
        <span>Slant — {el.skewDeg ? `${Math.round(el.skewDeg)}°` : 'upright'}</span>
        <input type="range" min={-30} max={30} step={1} value={el.skewDeg ?? 0} aria-label="Slant"
          onChange={(e) => gesture((d) => updateElement(d, spreadId, el.id, { skewDeg: Number(e.target.value) || undefined }))}
          onPointerUp={() => endGesture('Slant text')} onKeyUp={() => endGesture('Slant text')} onDoubleClick={() => upd('Upright text', { skewDeg: undefined })} />
      </label>
    </div>
  );
}

/** Turn photos into a negative (white becomes black, colours their opposites), or back. */
export function InvertButton({ value, apply, label }: { value: ColorGrade; apply: (d: BookDocument, next: ColorGrade | undefined) => BookDocument; label: string }) {
  const { run } = useEditor.getState();
  return (
    <button className={`btn btn-small ${value.invert ? 'btn-on' : ''}`} aria-pressed={!!value.invert} title="A negative: white becomes black and every colour its opposite (works with black & white too)"
      onClick={() => run(value.invert ? `Un-invert ${label}` : `Invert ${label}`, (d) => apply(d, { ...value, invert: !value.invert || undefined, preset: 'custom' }))}>
      <Icon name="contrast" /> Invert
    </button>
  );
}

/** A darker shade of a colour, for 3D sides. */
function darker(hex: string): string {
  const x = hex.replace('#', '').padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) || 0);
  const f = (v: number) => Math.round(v * 0.45).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

// ---- colour grade ----------------------------------------------------------------------------------

const SWATCH: [number, number, number][] = [[214, 98, 82], [236, 196, 112], [96, 160, 120], [84, 132, 196], [230, 216, 200]];

/** Brightness / contrast / saturation / warmth / fade sliders for a grade, wherever it lives. */
export function GradeSliders({ value, apply, label }: { value: ColorGrade; apply: (d: BookDocument, next: ColorGrade | undefined) => BookDocument; label: string }) {
  const { run, gesture, endGesture } = useEditor.getState();
  const slider = (key: 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'fade', name: string, min = -100) => (
    <label className="field" key={key}>
      <span>{name} — {value[key] > 0 ? '+' : ''}{value[key]}</span>
      <input
        type="range" min={min} max={100} step={1} value={value[key]} aria-label={`${label} ${name.toLowerCase()}`}
        onChange={(e) => gesture((d) => apply(d, { ...value, [key]: Number(e.target.value), preset: 'custom' }))}
        onPointerUp={() => endGesture(`${label}: ${name.toLowerCase()}`)} onKeyUp={() => endGesture(`${label}: ${name.toLowerCase()}`)}
        onDoubleClick={() => run(`Reset ${name.toLowerCase()}`, (d) => apply(d, { ...value, [key]: 0, preset: 'custom' }))}
      />
    </label>
  );
  return (
    <>
      {slider('brightness', 'Brightness')}
      {slider('contrast', 'Contrast')}
      {slider('saturation', 'Saturation')}
      {slider('warmth', 'Warmth')}
      {slider('fade', 'Fade', 0)}
    </>
  );
}

/**
 * A colour grade for every photo in a scope: the whole document (`surfaceId` missing) or one page,
 * spread or cover. Page grades apply on top of each photo's own adjustment, under the document's.
 */
export function GradeControls({ surfaceId }: { surfaceId?: string } = {}) {
  const grade = useEditor((s) => (surfaceId ? (s.doc ? findSurface(s.doc, surfaceId)?.surface.grade : undefined) : s.doc?.grade)) ?? NO_GRADE;
  const poster = useEditor((s) => s.doc?.settings.product === 'poster');
  const { run } = useEditor.getState();
  const apply = (d: BookDocument, next: ColorGrade | undefined) => {
    const g = next && !isNeutralGrade(next) ? next : undefined;
    return surfaceId ? setSurfaceGrade(d, surfaceId, g) : { ...d, grade: g };
  };
  const where = surfaceId ? 'on this page' : poster ? 'on the poster (and the background image)' : 'in the book';
  return (
    <div className="stack">
      <div className="grade-presets">
        {GRADE_PRESETS.map((p) => {
          const g = gradeFromPreset(p.id);
          return (
            <button key={p.id} className={`grade-preset ${grade.preset === p.id || (p.id === 'none' && isNeutralGrade(grade)) ? 'on' : ''}`} onClick={() => run(`Grade: ${p.name}`, (d) => apply(d, p.id === 'none' ? undefined : g))} title={p.name}>
              <span className="grade-swatch">
                {SWATCH.map((c, i) => <i key={i} style={{ background: `rgb(${gradeColor(g, c).join(',')})` }} />)}
              </span>
              <span className="small">{p.name}</span>
            </button>
          );
        })}
      </div>
      <div className="btn-grid">
        <InvertButton value={grade} apply={apply} label={surfaceId ? 'page' : poster ? 'poster' : 'book'} />
      </div>
      <GradeSliders value={grade} apply={apply} label="Grade" />
      <p className="muted small">Applies to every photo {where}, on screen and in the PDF. Text and shapes keep their colours. Double-click a slider to reset it.</p>
    </div>
  );
}

/** Adjust several selected photos together: the same settings go on each (starting from the first's). */
export function MultiPhotoAdjust({ spreadId, ids }: { spreadId: string; ids: string[] }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const { run } = useEditor.getState();
  const photos = (findSurface(doc, spreadId)?.surface.elements ?? []).filter((e): e is ImageElement => e.type === 'image' && ids.includes(e.id));
  const value = photos[0]?.adjust ?? NO_GRADE;
  const apply = (d: BookDocument, next: ColorGrade | undefined) =>
    photos.reduce((acc, e) => updateElement(acc, spreadId, e.id, { adjust: next && !isNeutralGrade(next) ? next : undefined }), d);
  return (
    <div className="stack">
      <p className="small"><strong>{photos.length} photos</strong> selected — these settings go on each of them.</p>
      <div className="btn-grid">
        <button className="btn btn-small" onClick={() => run(`Auto-enhance ${photos.length} photos`, (d) => photos.reduce((acc, e) => updateElement(acc, spreadId, e.id, { adjust: autoAdjust(e.assetId ? assets.get(e.assetId)?.analysis ?? null : null) }), d))} title="Each photo gets its own fix for exposure and colour cast">
          <Icon name="sparkle" /> Auto-enhance each
        </button>
        <button className={`btn btn-small ${value.mono === 'bw' ? 'btn-on' : ''}`} onClick={() => run(`Black & white ${photos.length} photos`, (d) => apply(d, { ...value, mono: value.mono === 'bw' ? undefined : 'bw', preset: 'custom' }))}>Black & white</button>
        <InvertButton value={value} apply={apply} label={`${photos.length} photos`} />
      </div>
      <GradeSliders value={value} apply={apply} label="Photos" />
      <button className="link small" onClick={() => run('Reset photo adjustments', (d) => apply(d, undefined))}>Reset all {photos.length}</button>
    </div>
  );
}

/** One photo's own adjustments (on top of which the poster's grade still applies). */
export function PhotoAdjustControls({ el, spreadId, analysis }: { el: ImageElement; spreadId: string; analysis: Parameters<typeof autoAdjust>[0] }) {
  const { run } = useEditor.getState();
  const value = el.adjust ?? NO_GRADE;
  const apply = (d: BookDocument, next: ColorGrade | undefined) => updateElement(d, spreadId, el.id, { adjust: next && !isNeutralGrade(next) ? next : undefined });
  const adjusted = !isNeutralGrade(el.adjust);
  return (
    <div className="stack">
      <div className="btn-grid">
        <button className={`btn btn-small ${el.adjust?.preset === 'auto' ? 'btn-on' : ''}`} onClick={() => run('Auto-enhance photo', (d) => apply(d, autoAdjust(analysis)))} title="Fix exposure, add a little contrast and colour, and neutralise a colour cast">
          <Icon name="sparkle" /> Auto-enhance
        </button>
        <button className={`btn btn-small ${el.adjust?.mono === 'bw' ? 'btn-on' : ''}`} onClick={() => run(el.adjust?.mono === 'bw' ? 'Colour photo' : 'Black & white photo', (d) => apply(d, { ...value, mono: el.adjust?.mono === 'bw' ? undefined : 'bw', preset: 'custom' }))}>
          Black & white
        </button>
        <InvertButton value={value} apply={apply} label="photo" />
      </div>
      <GradeSliders value={value} apply={apply} label="Photo" />
      {adjusted && <button className="link small" onClick={() => run('Reset photo adjustments', (d) => apply(d, undefined))}>Reset adjustments</button>}
    </div>
  );
}
