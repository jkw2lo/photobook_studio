import { COVER_INDEX, STICKER_PACKS, addSticker, stickerFields, updateElement, type ShapeElement } from '../../core';
import { selectedElement, useEditor } from '../store';
import { addPoint } from './AddPanel';
import { ElementView } from './SpreadView';

// Elements › Stickers: packs of shapes and icons styled like the text looks (retro shadows, neon
// glow, die-cut borders…). Click to add one; with a shape selected, a pack can restyle it instead.

function StickerPreview({ fields, shape }: { fields: Partial<ShapeElement>; shape: string }) {
  const el = { id: 'p', type: 'shape', xMm: 3, yMm: 3, widthMm: 14, heightMm: 14, rotationDeg: 0, locked: false, fill: '#000', opacity: 1, shape, ...fields } as ShapeElement;
  return (
    <div className="sticker-preview">
      <ElementView el={el} scale={2.4} offset={0} thumbSize="s" />
    </div>
  );
}

export function StickersPanel() {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const selected = useEditor(selectedElement);
  const sel = useEditor((s) => s.selection);
  const surface = index === COVER_INDEX ? doc.cover : doc.spreads[index];
  const shape = selected?.type === 'shape' ? selected : null;
  const { run, select } = useEditor.getState();
  const add = (packId: string, shapeId: string, name: string) => {
    if (!surface) return;
    const at = addPoint(doc, index);
    let id = '';
    run(`Add sticker: ${name}`, (d) => {
      const r = addSticker(d, surface.id, packId, shapeId, at.x, at.y);
      id = r.newId;
      return r.doc;
    });
    if (id) select({ spreadId: surface.id, elementId: id });
  };
  if (!surface) return <p className="muted small">Create the cover first (Layout › Cover), then add to it here.</p>;
  return (
    <div className="stack">
      <p className="muted small">Click a sticker to add it{shape ? ', or restyle the selected shape with a pack' : ''}. Colours and effects stay editable when it's selected.</p>
      {STICKER_PACKS.map((pack) => (
        <div key={pack.id} className="stack">
          <div className="row between">
            <div className="section-title">{pack.name}</div>
            {shape && sel && (
              <button className="link small" onClick={() => run(`Sticker style: ${pack.name}`, (d) => updateElement(d, sel.spreadId, shape.id, stickerFields(pack, 0, shape.widthMm, shape.heightMm)))}>
                Restyle selected
              </button>
            )}
          </div>
          <div className="sticker-grid" style={{ background: pack.backdrop }}>
            {pack.shapes.map((id, i) => (
              <button key={id} className="sticker-btn" title={`Add ${id.replace(/^[a-z]-/, '').replace(/-/g, ' ')}`} onClick={() => add(pack.id, id, `${pack.name} ${id}`)}>
                <StickerPreview shape={id} fields={stickerFields(pack, i, 14, 14)} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
