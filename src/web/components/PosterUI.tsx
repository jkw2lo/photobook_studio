import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_COLLAGE, POSTER_SIZES, curatePool, generatePoster, relayoutPoster, setSurfaceBackground, updateSettings,
  type BookDocument, type CollageSettings, type PhotoAsset, type PosterReport,
} from '../../core';
import { useEditor } from '../store';
import { CollageControls, gapOptions, marginOptions } from './CollageControls';
import { ColorInput } from './ColorInput';
import { Icon } from './Icon';

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
 * Inspector panel for a poster when nothing is selected. Auto collage lives here, beside the sheet,
 * so every regenerate is visible immediately — no dialog covering the result.
 */
export function PosterPanel() {
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
  const s = doc.settings;
  const landscape = s.trimWidthMm > s.trimHeightMm;
  const usable = assetList.filter((a) => !a.excluded && !a.missing).length;
  const maxPhotos = Math.max(1, Math.min(300, usable));
  const hasPhotos = !!sheet?.elements.some((e) => e.type === 'image' && e.assetId);
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

  const sizeId = POSTER_SIZES.find((z) => {
    const [w, h] = landscape ? [z.heightMm, z.widthMm] : [z.widthMm, z.heightMm];
    return Math.abs(w - s.trimWidthMm) < 0.5 && Math.abs(h - s.trimHeightMm) < 0.5;
  })?.id ?? 'custom';

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
  const reflow = (label: string, next: CollageSettings, base?: (d: BookDocument) => BookDocument) =>
    useEditor.getState().run(label, (d) => {
      const prepared = base ? base(d) : d;
      return hasPhotos ? relayoutPoster(prepared, assets, next) : { ...prepared, collage: next };
    });
  const resize = (w: number, h: number) => reflow('Change poster size', settings, (d) => updateSettings(d, { trimWidthMm: w, trimHeightMm: h }));

  return (
    <div className="stack">
      <div ref={sectionRef} className={`auto-collage ${flash ? 'flash' : ''}`}>
        <div className="row between">
          <strong>Auto collage</strong>
          {hasPhotos && <span className="muted small">{sheet.elements.filter((e) => e.type === 'image').length} photos on the sheet</span>}
        </div>
        {assetList.length === 0 ? (
          <p className="muted small">Import photos in the library first.</p>
        ) : (
          <>
            <label className="field">
              <span>Photos — {count} <span className="muted">of {maxPhotos}</span></span>
              <input
                type="range" min={1} max={maxPhotos} value={Math.min(count, maxPhotos)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setCount(n);
                  // Live preview while dragging; one undo step when released.
                  regenerate('Photo count', { ...settings, photoCount: n }, true);
                }}
                onPointerUp={() => useEditor.getState().endGesture('Change photo count')}
                onKeyUp={() => useEditor.getState().endGesture('Change photo count')}
              />
            </label>
            <div className="btn-grid">
              <button className="btn btn-small btn-primary" title="The strongest photos for this count, in time order" onClick={() => regenerate(hasPhotos ? 'Regenerate collage' : 'Generate collage', { ...settings, photoCount: count, seed: 1 })}>
                <Icon name="sparkle" /> {hasPhotos ? 'Best photos' : 'Generate'}
              </button>
              <button className="btn btn-small" disabled={!hasPhotos} onClick={() => regenerate('Shuffle photos', { ...settings, photoCount: count, seed: settings.seed + 1 })} title="A different selection of strong photos (when there are more than fit) in a new arrangement">
                <Icon name="shuffle" /> Shuffle
              </button>
            </div>
            {report && (
              <p className="muted small">
                {report.placed} placed from {report.available} candidates · {report.nearDuplicatesSet} similar shots set aside
                {report.notes.length ? ` · ${report.notes.join(' ')}` : ''}
              </p>
            )}
            <p className="muted small">Best frame of each burst, no duplicates or hidden photos, favourites always kept, spread across the whole collection.</p>
          </>
        )}
      </div>

      <div className="section-title">Layout</div>
      {hasPhotos && <p className="muted small">Style, spacing, border and title re-flow the photos already on the sheet.</p>}
      <CollageControls doc={doc} value={settings} compact onChange={(next) => reflow(next.style !== settings.style ? 'Change collage style' : 'Adjust collage', next)} />
      {hasPhotos && settings.style === 'scatter' && (
        <button className="btn btn-small" onClick={() => reflow('Re-scatter prints', { ...settings, seed: settings.seed + 1 })}>
          <Icon name="shuffle" /> Re-scatter prints
        </button>
      )}

      <div className="section-title">Sheet</div>
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
      <label className="field">
        <span>Background</span>
        <ColorInput value={sheet?.background ?? doc.style.background} label="Poster background" apply={(d, c) => setSurfaceBackground(d, d.spreads[0].id, c)} />
      </label>
      <p className="muted small">Regenerating or re-flowing replaces manual moves on the sheet — undo (⌘Z) brings them back. Posters warn below {s.minDpiWarning} DPI: they're seen from further away than book pages.</p>
    </div>
  );
}
