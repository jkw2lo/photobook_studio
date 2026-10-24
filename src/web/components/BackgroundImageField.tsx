import { useState } from 'react';
import { setBackgroundImage, updateBackgroundImage } from '../../core';
import { thumbUrl } from '../api';
import { useEditor } from '../store';
import { ASSET_MIME } from './Canvas';
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
  const { run, gesture, endGesture } = useEditor.getState();

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
      <label className="field">
        <span>Opacity — {Math.round(bg.opacity * 100)}%</span>
        <input
          type="range" min={0.05} max={1} step={0.01} value={bg.opacity} aria-label="Background image opacity"
          onChange={(e) => gesture((d) => updateBackgroundImage(d, surfaceId, { opacity: Number(e.target.value) }))}
          onPointerUp={() => endGesture('Background opacity')}
          onKeyUp={() => endGesture('Background opacity')}
        />
      </label>
      <p className="muted small">Fade it to let the photos stand out; the sheet colour shows through. Arrange and Shuffle leave it alone.</p>
    </div>
  );
}
