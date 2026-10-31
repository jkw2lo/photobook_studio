import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_COLLAGE, POSTER_SIZES, curatePool, generatePoster, photoArea, relayoutPoster, setSurfaceBackground, updateSettings,
  isPinned, type BookDocument, type CollageSettings, type CollageSource, type PhotoAsset, type PosterReport,
} from '../../core';
import { setPhotoArea } from '../elementActions';
import { useEditor } from '../store';
import { CollageControls, gapOptions, marginOptions } from './CollageControls';
import { ColorInput } from './ColorInput';
import { Icon } from './Icon';
import { BackgroundImageField } from './BackgroundImageField';
import { PosterTemplates } from './PosterTemplates';

/** Sensible first settings for a sheet: spacing and border scaled to its size. */
export function initialCollageSettings(doc: BookDocument, usable: number): CollageSettings {
  const saved = doc.collage ?? DEFAULT_COLLAGE;
  const fresh = !doc.spreads[0]?.elements.length;
  return {
    ...saved,
    photoCount: fresh ? Math.min(usable || saved.photoCount, saved.photoCount) : saved.photoCount,
    gapMm: fresh ? gapOptions(doc)[2].mm : saved.gapMm,
    marginMm: fresh ? marginOptions(doc)[1].mm : saved.marginMm,
  };
}

/** Fill an empty sheet straight away so there is something to look at and refine. */
export function generateFirstCollage(assets: PhotoAsset[]) {
  const st = useEditor.getState();
  if (!st.doc) return;
  const usable = curatePool(assets).reps.length;
  st.run('Generate collage', (d) => generatePoster(d, assets, initialCollageSettings(d, usable)).doc);
}

/**
 * Layout › Collage for a poster. Auto collage lives here, beside the sheet, so every regenerate is
 * visible immediately — no dialog covering the result.
 */
export function PosterCollagePanel() {
  const doc = useEditor((s) => s.doc)!;
  const assetList = useEditor((s) => s.assets);
  const assets = useEditor((s) => s.assetMap);
  const focus = useEditor((s) => s.collageFocus);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const [report, setReport] = useState<PosterReport | null>(null);
  const curated = useMemo(() => curatePool(assetList), [assetList]);
  const sheet = doc.spreads[0];
  const settings = doc.collage ?? DEFAULT_COLLAGE;
  const usable = assetList.filter((a) => !a.excluded && !a.missing).length;
  const maxPhotos = Math.max(1, Math.min(300, usable));
  const photosOnSheet = sheet?.elements.filter((e) => e.type === 'image' && e.assetId).length ?? 0;
  const hasPhotos = photosOnSheet > 0;
  const [count, setCount] = useState(Math.min(settings.photoCount, maxPhotos));
  useEffect(() => setCount(Math.min(settings.photoCount, maxPhotos)), [settings.photoCount, maxPhotos]);

  // Top-bar "Auto collage" brings this section into view.
  useEffect(() => {
    if (!focus) return;
    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [focus]);

  const source: CollageSource = settings.source ?? 'best';
  const pinnedCount = sheet?.elements.filter(isPinned).length ?? 0;
  const allCount = Math.min(300, curated.reps.length + curated.alternates.length);

  /** Pick photos again (new selection) with these settings. */
  const regenerate = (label: string, next: CollageSettings, live = false) => {
    const apply = (d: BookDocument) => {
      const res = generatePoster(d, assetList, next, curated);
      setReport(res.report);
      return res.doc;
    };
    if (live) useEditor.getState().gesture(apply);
    else useEditor.getState().run(label, apply);
  };
  /** Keep the photos on the sheet; only re-flow them. */
  const reflow = (label: string, next: CollageSettings, base?: (d: BookDocument) => BookDocument, shuffle = false) =>
    useEditor.getState().run(label, (d) => {
      const prepared = base ? base(d) : d;
      setReport(null);
      return hasPhotos ? relayoutPoster(prepared, assets, next, { shuffle }) : { ...prepared, collage: next };
    });

  /** Arrange (seed 1: the best result) or Shuffle (next seed) using the chosen photos. */
  const act = (shuffle: boolean) => {
    const next = { ...settings, source, photoCount: count, seed: shuffle ? settings.seed + 1 : 1 };
    if (source === 'sheet') return reflow(shuffle ? 'Shuffle photos on the sheet' : 'Arrange photos on the sheet', next, undefined, shuffle);
    const what = source === 'all' ? 'all photos' : 'best photos';
    regenerate(shuffle ? `Shuffle ${what}` : hasPhotos ? `Arrange ${what}` : 'Generate collage', next);
  };
  const setSource = (src: CollageSource) => useEditor.getState().run('Collage photos', (d) => ({ ...d, collage: { ...settings, source: src } }));

  const sources: { id: CollageSource; label: string; title: string; disabled?: boolean }[] = [
    { id: 'best', label: 'Best', title: 'The strongest photos, as many as you choose' },
    { id: 'all', label: `All (${allCount})`, title: `Every usable photo — ${allCount} (not hidden, no exact duplicates)` },
    { id: 'sheet', label: 'On sheet', title: 'Only the photos already on the sheet — after deleting or adding some', disabled: !hasPhotos },
  ];
  const hint = {
    best: `Arrange picks the ${count} strongest photos in time order. Shuffle brings in a different selection and arrangement.`,
    all: 'Arrange lays out every usable photo in time order. Shuffle rearranges them.',
    sheet: 'Arrange lays out just the photos on the sheet in time order. Shuffle rearranges them — nothing is added or removed.',
  }[source];

  return (
    <div className="stack">
      <div ref={sectionRef} className={`auto-collage ${flash ? 'flash' : ''}`}>
        <div className="row between">
          <strong>Auto collage</strong>
          {hasPhotos && <span className="muted small">{photosOnSheet} photos on the sheet</span>}
        </div>
        {assetList.length === 0 ? (
          <p className="muted small">Import photos in the library first.</p>
        ) : (
          <>
            <div className="field">
              <span>Photos to use</span>
              <div className="seg seg-wide" role="radiogroup" aria-label="Photos to use">
                {sources.map((o) => (
                  <button key={o.id} role="radio" aria-checked={source === o.id} className={source === o.id ? 'on' : ''} disabled={o.disabled} title={o.title} onClick={() => setSource(o.id)}>{o.label}</button>
                ))}
              </div>
            </div>
            {source === 'best' && (
              <label className="field">
                <span>How many — {count} <span className="muted">of {maxPhotos}</span></span>
                <input
                  type="range" min={1} max={maxPhotos} value={Math.min(count, maxPhotos)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setCount(n);
                    // Live preview while dragging; one undo step when released.
                    regenerate('Photo count', { ...settings, source: 'best', photoCount: n }, true);
                  }}
                  onPointerUp={() => useEditor.getState().endGesture('Change photo count')}
                  onKeyUp={() => useEditor.getState().endGesture('Change photo count')}
                />
              </label>
            )}
            <div className="btn-grid">
              <button className="btn btn-small btn-primary" onClick={() => act(false)} title="The best result for these photos, in time order">
                <Icon name="sparkle" /> {hasPhotos ? 'Arrange' : 'Generate'}
              </button>
              <button className="btn btn-small" disabled={!hasPhotos} onClick={() => act(true)} title="A new variation with the same photo choice">
                <Icon name="shuffle" /> Shuffle
              </button>
            </div>
            <p className="muted small">{hint}{pinnedCount ? ` ${pinnedCount} pinned photo${pinnedCount > 1 ? 's stay' : ' stays'} where ${pinnedCount > 1 ? 'they are' : 'it is'}.` : ''}</p>
            {report && (
              <p className="muted small">
                {report.placed} placed from {report.available} candidates · {report.nearDuplicatesSet} similar shots set aside
                {report.notes.length ? ` · ${report.notes.join(' ')}` : ''}
              </p>
            )}
          </>
        )}
      </div>

      <div className="section-title">Layout</div>
      {hasPhotos && <p className="muted small">Style, spacing, border and title re-flow the photos already on the sheet.</p>}
      <CollageControls doc={doc} value={settings} compact onChange={(next) => reflow(next.style !== settings.style ? 'Change collage style' : 'Adjust collage', next)} />
      <PhotoAreaField doc={doc} settings={settings} />
      <p className="muted small">Arranging replaces manual moves on the sheet — pin a photo (right-click it) to keep it where it is, or undo (⌘Z).</p>
    </div>
  );
}

/** Layout › Sheet: the poster's size and orientation (photos on it re-flow to fit). */
export function PosterSheetPanel() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const s = doc.settings;
  const settings = doc.collage ?? DEFAULT_COLLAGE;
  const landscape = s.trimWidthMm > s.trimHeightMm;
  const hasPhotos = doc.spreads[0]?.elements.some((e) => e.type === 'image' && e.assetId);
  const sizeId = POSTER_SIZES.find((z) => {
    const [w, h] = landscape ? [z.heightMm, z.widthMm] : [z.widthMm, z.heightMm];
    return Math.abs(w - s.trimWidthMm) < 0.5 && Math.abs(h - s.trimHeightMm) < 0.5;
  })?.id ?? 'custom';
  const resize = (w: number, h: number) => useEditor.getState().run('Change poster size', (d) => {
    const sized = updateSettings(d, { trimWidthMm: w, trimHeightMm: h });
    return hasPhotos ? relayoutPoster(sized, assets, settings) : sized;
  });
  return (
    <div className="stack">
      <label className="field">
        <span>Size</span>
        <select
          value={sizeId}
          onChange={(e) => {
            const z = POSTER_SIZES.find((x) => x.id === e.target.value);
            if (z) resize(landscape ? z.heightMm : z.widthMm, landscape ? z.widthMm : z.heightMm);
          }}
        >
          {POSTER_SIZES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          {sizeId === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>
      <div className="seg seg-wide">
        <button className={!landscape ? 'on' : ''} onClick={() => landscape && resize(s.trimHeightMm, s.trimWidthMm)}>Portrait</button>
        <button className={landscape ? 'on' : ''} onClick={() => !landscape && resize(s.trimHeightMm, s.trimWidthMm)}>Landscape</button>
      </div>
    </div>
  );
}

/** Layout › Background: the sheet's colour and a photo behind everything. */
export function PosterBackgroundPanel() {
  const doc = useEditor((s) => s.doc)!;
  const sheet = doc.spreads[0];
  return (
    <div className="stack">
      <label className="field">
        <span>Colour</span>
        <ColorInput value={sheet?.background ?? doc.style.background} label="Poster background" apply={(d, c) => setSurfaceBackground(d, d.spreads[0].id, c)} />
      </label>
      <div className="field">
        <span>Photo</span>
        <BackgroundImageField surfaceId={sheet.id} />
      </div>
    </div>
  );
}

/**
 * Where the photos go on the sheet: all of it, or a box you mark on the sheet (the sky of a
 * background photo, say). Arrange, Shuffle and the photo count keep to it.
 */
function PhotoAreaField({ doc, settings }: { doc: BookDocument; settings: CollageSettings }) {
  const sheet = doc.spreads[0];
  const marking = useEditor((s) => s.canvasTool?.kind === 'area');
  const W = doc.settings.trimWidthMm;
  const H = doc.settings.trimHeightMm;
  const start = () => {
    // Start from the current area (a template's, or the sheet inside the margin).
    const r = photoArea(doc, settings);
    const clampF = (v: number) => Math.max(0, Math.min(1, v));
    const x0 = clampF(r.x / W);
    const y0 = clampF(r.y / H);
    const rect = settings.area ? { x: x0, y: y0, w: clampF((r.x + r.w) / W) - x0, h: clampF((r.y + r.h) / H) - y0 } : null;
    const shape = settings.areaShape ?? null;
    useEditor.getState().setCanvasTool({ kind: 'area', surfaceId: sheet.id, mode: shape ? 'free' : 'box', rect: shape ? null : rect, shape });
  };
  const a = settings.area;
  return (
    <div className="field photo-area-field">
      <span>Photo area</span>
      <div className="row">
        <span className="small">{settings.areaShape ? 'Freeform outline' : a ? `Box — ${Math.round(a.w * 100)}% × ${Math.round(a.h * 100)}% of the sheet` : 'Whole sheet'}</span>
      </div>
      <div className="btn-grid">
        <button className={`btn btn-small ${marking ? 'btn-on' : ''}`} onClick={() => (marking ? useEditor.getState().setCanvasTool(null) : start())} title="Drag a box on the sheet: photos are laid out only inside it">
          <Icon name="crop" /> {marking ? 'Marking…' : a ? 'Change area' : 'Choose area'}
        </button>
        <button className="btn btn-small" disabled={!a} onClick={() => setPhotoArea(undefined)}>Whole sheet</button>
      </div>
    </div>
  );
}
