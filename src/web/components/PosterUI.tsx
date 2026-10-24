import { useMemo, useState } from 'react';
import {
  DEFAULT_COLLAGE, POSTER_SIZES, curatePool, generatePoster, relayoutPoster, setSurfaceBackground, updateSettings,
  type BookDocument, type CollageSettings, type PosterReport,
} from '../../core';
import { useEditor } from '../store';
import { CollageControls, gapOptions, marginOptions } from './CollageControls';
import { ColorInput } from './ColorInput';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Sensible first settings for a sheet: spacing and border scaled to its size. */
function initialSettings(doc: BookDocument, usable: number): CollageSettings {
  const saved = doc.collage ?? DEFAULT_COLLAGE;
  const fresh = !doc.spreads[0]?.elements.length;
  return {
    ...saved,
    photoCount: Math.min(usable || saved.photoCount, saved.photoCount),
    gapMm: fresh ? gapOptions(doc)[2].mm : saved.gapMm,
    marginMm: fresh ? marginOptions(doc)[1].mm : saved.marginMm,
  };
}

/** Auto collage: pick photos and a style, generate, try variations. */
export function PosterDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const usable = useMemo(() => curatePool(assets).reps.length, [assets]);
  const [settings, setSettings] = useState<CollageSettings>(() => initialSettings(doc, usable));
  const [report, setReport] = useState<PosterReport | null>(null);
  const maxPhotos = Math.max(1, Math.min(300, assets.filter((a) => !a.excluded && !a.missing).length));

  const generate = (seed: number) => {
    const next = { ...settings, seed };
    let r: PosterReport | null = null;
    const ok = useEditor.getState().run(report || doc.spreads[0]?.elements.length ? 'Regenerate collage' : 'Generate collage', (d) => {
      const res = generatePoster(d, assets, next);
      r = res.report;
      return res.doc;
    });
    if (ok && r) {
      setReport(r);
      setSettings(next);
    }
  };

  return (
    <Modal title="Automatic collage" onClose={onClose} wide>
      <p className="muted">
        Picks the best frame of each burst, skips duplicates and hidden photos, keeps favourites, and spreads the selection across your whole collection. Everything stays editable.
      </p>
      <div className="field">
        <span>Photos — {settings.photoCount} of {maxPhotos} <span className="muted">({usable} after setting aside similar shots)</span></span>
        <input type="range" min={1} max={maxPhotos} value={Math.min(settings.photoCount, maxPhotos)} onChange={(e) => setSettings({ ...settings, photoCount: Number(e.target.value) })} />
      </div>
      <CollageControls doc={doc} value={settings} onChange={(next) => setSettings(next)} />
      {report && (
        <div className="report">
          <div><strong>{report.placed}</strong> photos placed</div>
          <div className="muted small">{report.available} candidates · {report.nearDuplicatesSet} similar shots set aside · {report.exactDuplicates} exact duplicates skipped{report.excluded ? ` · ${report.excluded} hidden` : ''}</div>
          {report.notes.map((n) => <div key={n} className="small">{n}</div>)}
        </div>
      )}
      <div className="modal-foot">
        <span className="muted small">{assets.length === 0 ? 'Import photos first.' : report ? 'Settings changed? Generate again. Or try another variation.' : ''}</span>
        <div className="row">
          {report && (
            <button className="btn" onClick={() => generate(settings.seed + 1)}>
              <Icon name="shuffle" /> Another variation
            </button>
          )}
          <button className={report ? 'btn' : 'btn btn-primary'} disabled={assets.length === 0} onClick={() => generate(settings.seed)}>
            <Icon name="sparkle" /> {report ? 'Generate again' : 'Generate'}
          </button>
          {report && <button className="btn btn-primary" onClick={onClose}>Done</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Inspector panel for a poster when nothing is selected: re-flow the collage, size, colour. */
export function PosterPanel({ onAutoCollage }: { onAutoCollage: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const sheet = doc.spreads[0];
  const settings = doc.collage ?? DEFAULT_COLLAGE;
  const s = doc.settings;
  const landscape = s.trimWidthMm > s.trimHeightMm;
  const sizeId = POSTER_SIZES.find((z) => {
    const [w, h] = landscape ? [z.heightMm, z.widthMm] : [z.widthMm, z.heightMm];
    return Math.abs(w - s.trimWidthMm) < 0.5 && Math.abs(h - s.trimHeightMm) < 0.5;
  })?.id ?? 'custom';
  const hasPhotos = sheet?.elements.some((e) => e.type === 'image' && e.assetId);
  const reflow = (label: string, next: CollageSettings, base?: (d: BookDocument) => BookDocument) =>
    useEditor.getState().run(label, (d) => {
      const prepared = base ? base(d) : d;
      return hasPhotos ? relayoutPoster(prepared, assets, next) : { ...prepared, collage: next };
    });
  const resize = (w: number, h: number) => reflow('Change poster size', settings, (d) => updateSettings(d, { trimWidthMm: w, trimHeightMm: h }));

  return (
    <div className="stack">
      <div className="row between">
        <strong>Poster</strong>
        <button className="btn btn-small btn-primary" onClick={onAutoCollage}>
          <Icon name="sparkle" /> Auto collage
        </button>
      </div>
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
        <div className="field">
          <span>Orientation</span>
          <div className="seg seg-wide">
            <button className={!landscape ? 'on' : ''} onClick={() => landscape && resize(s.trimHeightMm, s.trimWidthMm)}>Portrait</button>
            <button className={landscape ? 'on' : ''} onClick={() => !landscape && resize(s.trimHeightMm, s.trimWidthMm)}>Landscape</button>
          </div>
        </div>
      </div>
      {!hasPhotos && <p className="muted small">The sheet is empty. Use Auto collage to fill it, or drag photos onto it.</p>}
      <div className="section-title">Collage</div>
      {hasPhotos && <p className="muted small">Changes re-flow the photos already on the sheet.</p>}
      <CollageControls doc={doc} value={settings} compact onChange={(next) => reflow(next.style !== settings.style ? 'Change collage style' : 'Adjust collage', next)} />
      {hasPhotos && (
        <button className="btn btn-small" onClick={() => reflow('Shuffle collage', { ...settings, seed: settings.seed + 1 })} disabled={settings.style !== 'scatter'} title={settings.style === 'scatter' ? 'Re-scatter the prints' : 'Only the pinboard style is randomised'}>
          <Icon name="shuffle" /> Re-scatter prints
        </button>
      )}
      <label className="field">
        <span>Background</span>
        <ColorInput value={sheet?.background ?? doc.style.background} label="Poster background" apply={(d, c) => setSurfaceBackground(d, d.spreads[0].id, c)} />
      </label>
      <p className="muted small">Re-flowing replaces manual moves on the sheet — undo (⌘Z) brings them back. Posters warn below {s.minDpiWarning} DPI: they're viewed from further away than book pages.</p>
    </div>
  );
}
