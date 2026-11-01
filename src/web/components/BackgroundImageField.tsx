import { useState } from 'react';
import { NO_GRADE, backgroundBox, isNeutralGrade, posterGeometry, scaleBackground, setBackgroundImage, updateBackgroundImage, type BookDocument, type ColorGrade } from '../../core';
import { thumbUrl } from '../api';
import { useEditor } from '../store';
import { ASSET_MIME } from './Canvas';
import { GradeSliders, InvertButton } from './DesignPanel';
import { Icon } from './Icon';

/**
 * A photo behind everything on the sheet. Drop a library photo on the field (or use the photo in the
 * library preview); fill or fit it and fade it. Arrange and Shuffle never touch it.
 */
export function BackgroundImageField({ surfaceId }: { surfaceId: string }) {
  const bg = useEditor((s) => s.doc?.spreads.find((x) => x.id === surfaceId)?.backgroundImage ?? s.doc?.cover?.backgroundImage);
  const asset = useEditor((s) => (bg ? s.assetMap.get(bg.assetId) : undefined));
  const preview = useEditor((s) => (s.previewAssetId ? s.assetMap.get(s.previewAssetId) : undefined));
  const [over, setOver] = useState(false);
  const editing = useEditor((s) => s.canvasTool?.kind === 'background' && s.canvasTool.surfaceId === surfaceId);
  const settings = useEditor((s) => s.doc!.settings);
  const { run, gesture, endGesture, setCanvasTool } = useEditor.getState();

  const use = (id: string) => {
    const a = useEditor.getState().assetMap.get(id);
    if (a) run(bg ? 'Replace background image' : 'Add background image', (d) => setBackgroundImage(d, surfaceId, a));
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const id = e.dataTransfer.getData(ASSET_MIME);
      if (!id) return;
      e.preventDefault();
      use(id);
    },
  };

  if (!bg) {
    return (
      <div className={`bg-drop ${over ? 'over' : ''}`} {...dropProps}>
        <Icon name="image" />
        <span className="small">Drag a photo here to put it behind the collage</span>
        <button className="link small" disabled={!preview} onClick={() => preview && use(preview.id)} title={preview ? preview.fileName : 'Click a photo in the library first'}>
          {preview ? `Use ${preview.fileName}` : 'or click a library photo, then use it here'}
        </button>
      </div>
    );
  }
  return (
    <div className={`bg-field stack ${over ? 'over' : ''}`} {...dropProps}>
      <div className="bg-current">
        <div className={`bg-thumb ${asset?.analysis?.transparent ? 'checker' : ''}`}>{asset && <img src={thumbUrl(asset.id)} alt="" />}</div>
        <div className="bg-meta">
          <div className="ellipsis small" title={asset?.fileName}>{asset?.fileName ?? 'Photo not in library'}</div>
          <div className="row">
            {preview && preview.id !== bg.assetId && <button className="link small" onClick={() => use(preview.id)} title={preview.fileName}>Replace with previewed</button>}
            <button className="link small danger" onClick={() => run('Remove background image', (d) => setBackgroundImage(d, surfaceId, null))}>Remove</button>
          </div>
        </div>
      </div>
      <div className="seg seg-wide">
        <button className={bg.fit === 'cover' ? 'on' : ''} title="Fill the whole sheet (crops the photo)" onClick={() => run('Background: fill', (d) => updateBackgroundImage(d, surfaceId, { fit: 'cover' }))}>Fill</button>
        <button className={bg.fit === 'contain' ? 'on' : ''} title="Show the whole photo (the sheet colour shows around it)" onClick={() => run('Background: fit', (d) => updateBackgroundImage(d, surfaceId, { fit: 'contain' }))}>Fit</button>
      </div>
      <div className="btn-grid">
        <button className={`btn btn-small ${editing ? 'btn-on' : ''}`} disabled={!asset} onClick={() => setCanvasTool(editing ? null : { kind: 'background', surfaceId })} title="Drag the photo on the sheet; scroll or drag a corner to resize">
          <Icon name="fit" /> {editing ? 'Done' : 'Move & resize'}
        </button>
        <button className="btn btn-small" disabled={!(bg.box || bg.crop.zoom > 1 || bg.crop.cx !== 0.5 || bg.crop.cy !== 0.5)} onClick={() => run('Reset background position', (d) => updateBackgroundImage(d, surfaceId, { box: undefined, crop: { cx: 0.5, cy: 0.5, zoom: 1 } }))}>
          Reset position
        </button>
      </div>
      {asset && (() => {
        const g = posterGeometry({ settings });
        const fitted = backgroundBox({ ...bg, box: undefined }, g, asset);
        const now = backgroundBox(bg, g, asset);
        const value = bg.fit === 'contain' ? now.w / fitted.w : bg.crop.zoom;
        const centre = { x: now.x + now.w / 2, y: now.y + now.h / 2 };
        return (
          <label className="field">
            <span>{bg.fit === 'contain' ? 'Size' : 'Zoom'} — {Math.round(value * 100)}%</span>
            <input
              type="range" min={bg.fit === 'contain' ? 0.1 : 1} max={bg.fit === 'contain' ? 3 : 5} step={0.01} value={value} aria-label="Background image size"
              onChange={(e) => gesture((d) => updateBackgroundImage(d, surfaceId, scaleBackground(bg, g, asset, Number(e.target.value) / value, bg.fit === 'contain' ? centre : { x: g.width / 2, y: g.height / 2 })))}
              onPointerUp={() => endGesture('Background size')}
              onKeyUp={() => endGesture('Background size')}
            />
          </label>
        );
      })()}
      <label className="field">
        <span>Opacity — {Math.round(bg.opacity * 100)}%</span>
        <input
          type="range" min={0.05} max={1} step={0.01} value={bg.opacity} aria-label="Background image opacity"
          onChange={(e) => gesture((d) => updateBackgroundImage(d, surfaceId, { opacity: Number(e.target.value) }))}
          onPointerUp={() => endGesture('Background opacity')}
          onKeyUp={() => endGesture('Background opacity')}
        />
      </label>
      <BackgroundAdjust surfaceId={surfaceId} value={bg.adjust} />
      <p className="muted small">Fade it to let the photos stand out; the sheet colour shows through. Arrange and Shuffle leave it alone.</p>
    </div>
  );
}

/** Brightness, contrast… of the background photo alone (the poster's grade still applies on top). */
function BackgroundAdjust({ surfaceId, value }: { surfaceId: string; value: ColorGrade | undefined }) {
  const [open, setOpen] = useState(!isNeutralGrade(value));
  const apply = (d: BookDocument, next: ColorGrade | undefined) => updateBackgroundImage(d, surfaceId, { adjust: next && !isNeutralGrade(next) ? next : undefined });
  return (
    <div className="stack">
      <button className="link small bg-adjust-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={open ? 'down' : 'right'} size={11} /> Brightness & contrast{isNeutralGrade(value) ? '' : ' · adjusted'}
      </button>
      {open && (
        <>
          <div className="btn-grid">
            <button className={`btn btn-small ${value?.mono === 'bw' ? 'btn-on' : ''}`} onClick={() => useEditor.getState().run('Background black & white', (d) => apply(d, { ...(value ?? NO_GRADE), mono: value?.mono === 'bw' ? undefined : 'bw', preset: 'custom' }))}>Black & white</button>
            <InvertButton value={value ?? NO_GRADE} apply={apply} label="background" />
          </div>
          <GradeSliders value={value ?? NO_GRADE} apply={apply} label="Background" />
          {!isNeutralGrade(value) && <button className="link small" onClick={() => useEditor.getState().run('Reset background adjustments', (d) => apply(d, undefined))}>Reset adjustments</button>}
        </>
      )}
    </div>
  );
}
