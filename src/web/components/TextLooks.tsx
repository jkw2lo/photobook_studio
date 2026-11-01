import { useMemo } from 'react';
import {
  COVER_INDEX, TEXT_LOOKS, TEXT_LOOK_CATEGORIES, addTextAt, applyLookEverywhere, applyTextLook, deleteTextLook, saveTextLook, textLookFields,
  type BookDocument, type TextElement,
} from '../../core';
import { selectedElement, useEditor } from '../store';
import { addPoint } from './AddPanel';
import { Icon } from './Icon';
import { ElementView } from './SpreadView';

// Elements › Looks: finished title treatments, each previewed in its own letters. With a text box
// selected a click restyles it; otherwise it adds a new title in that look. Looks saved from your
// own text boxes sit at the top, so every page can use the same treatment.

const PREVIEW_W = 64;
const PREVIEW_H = 26;

/** A small live preview: the look drawn by the same renderer as the page. */
function LookPreview({ fields, text }: { fields: Partial<TextElement>; text: string }) {
  const el: TextElement = {
    id: 'preview', type: 'text', xMm: 2, yMm: 1, widthMm: PREVIEW_W - 4, heightMm: PREVIEW_H - 2, rotationDeg: 0, locked: false,
    text, role: 'title', fontFamily: 'Inter', fontWeight: 400, fontSizePt: 20, lineHeight: 1, letterSpacingEm: 0, uppercase: false, align: 'center', color: '#000',
    styleLinked: false, ...fields,
  } as TextElement;
  // Fit the sample: shrink the type (and its effects, which are proportional) to the tile.
  const k = Math.min(1, 26 / Math.max(1, el.fontSizePt), (PREVIEW_W - 8) / Math.max(1, text.length * el.fontSizePt * 0.3528 * ((el.uppercase ? 0.82 : 0.6) + (el.letterSpacingEm ?? 0))));
  const scaled: TextElement = {
    ...el, fontSizePt: el.fontSizePt * k, paddingMm: (el.paddingMm ?? 0) * k, strokeWidthMm: el.strokeWidthMm ? el.strokeWidthMm * k : undefined,
    outline2: el.outline2 && { ...el.outline2, widthMm: el.outline2.widthMm * k }, shadow: el.shadow && { ...el.shadow, dxMm: el.shadow.dxMm * k, dyMm: el.shadow.dyMm * k },
    extrude: el.extrude && { ...el.extrude, depthMm: el.extrude.depthMm * k }, glow: el.glow && { ...el.glow, sizeMm: el.glow.sizeMm * k }, arch: el.arch ? el.arch * 0.6 : undefined,
  };
  return (
    <div className="look-preview">
      <ElementView el={scaled} scale={2.2} offset={0} thumbSize="s" />
    </div>
  );
}

export function TextLooksPanel() {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const selected = useEditor(selectedElement);
  const sel = useEditor((s) => s.selection);
  const text = selected?.type === 'text' ? selected : null;
  const surface = index === COVER_INDEX ? doc.cover : doc.spreads[index];
  const { run, select, toast } = useEditor.getState();
  const looks = useMemo(() => TEXT_LOOKS.map((l) => ({ look: l, fields: textLookFields(doc, l) })), [doc.style, doc.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const dark = isDark(doc);

  const use = (name: string, fields: Partial<TextElement>, sample: string) => {
    if (text && sel) return void run(`Look: ${name}`, (d) => applyTextLook(d, sel.spreadId, text.id, fields));
    if (!surface) return;
    const at = addPoint(doc, index);
    let id = '';
    run(`Add title: ${name}`, (d: BookDocument) => {
      const r = addTextAt(d, surface.id, at.x, at.y * 0.6, sample, 'title');
      id = r.newId;
      return applyTextLook(r.doc, surface.id, r.newId, fields);
    });
    if (id) select({ spreadId: surface.id, elementId: id });
  };

  return (
    <div className="stack">
      <p className="muted small">{text ? 'Click a look to restyle the selected text.' : 'Click a look to add a title in it — or select some text first to restyle it.'}</p>
      {text && sel && (
        <div className="btn-grid">
          <button className="btn btn-small" onClick={() => {
            const name = window.prompt('Name this look', `${text.fontFamily} title`);
            if (name === null) return;
            run('Save look', (d) => saveTextLook(d, name, text).doc);
            toast('success', `Saved “${name || 'My look'}” — find it at the top of Looks on any page.`);
          }} title="Keep this text's look to reuse on other pages"><Icon name="star" /> Save this look</button>
        </div>
      )}
      {!!doc.textLooks?.length && (
        <>
          <div className="section-title">Your looks</div>
          <div className="look-grid">
            {doc.textLooks.map((l) => (
              <div key={l.id} className="look-card-wrap">
                <button className={`look-card ${dark ? 'dark' : ''}`} style={{ background: doc.style.background }} onClick={() => use(l.name, l.fields, l.name)} title={text ? `Restyle the selected text as “${l.name}”` : `Add a title in “${l.name}”`}>
                  <LookPreview fields={l.fields} text={text?.text.split('\n')[0].slice(0, 14) || l.name} />
                  <span className="small">{l.name}</span>
                </button>
                <div className="look-card-actions">
                  {text && sel && <button className="link small" title="Restyle every text box in the document with the same font and size as the selected one" onClick={() => {
                    let n = 0;
                    run(`Look everywhere: ${l.name}`, (d) => {
                      const r = applyLookEverywhere(applyTextLook(d, sel.spreadId, text.id, l.fields), text, l.fields);
                      n = r.changed;
                      return r.doc;
                    });
                    toast('success', `“${l.name}” applied here and to ${n} matching text box${n === 1 ? '' : 'es'}.`);
                  }}>Use everywhere</button>}
                  <button className="icon-btn" title="Delete this saved look" onClick={() => run('Delete look', (d) => deleteTextLook(d, l.id))}><Icon name="x" size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {TEXT_LOOK_CATEGORIES.map((cat) => (
        <div key={cat} className="stack">
          <div className="section-title">{cat}</div>
          <div className="look-grid">
            {looks.filter((x) => x.look.category === cat).map(({ look, fields }) => (
              <button key={look.id} className={`look-card ${cat === 'Neon' ? 'dark' : ''}`} style={{ background: cat === 'Neon' ? '#14121c' : doc.style.background }} onClick={() => use(look.name, fields, look.sample)} title={text ? `Restyle the selected text as ${look.name}` : `Add “${look.sample}” in ${look.name}`}>
                <LookPreview fields={fields} text={text?.text.split('\n')[0].slice(0, 14) || look.sample} />
                <span className="small">{look.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="muted small">Every look stays editable: fonts, colours and effects are in the text's Text and Effects tabs.</p>
    </div>
  );
}

function isDark(doc: BookDocument): boolean {
  const x = doc.style.background.replace('#', '').padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) || 0);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}
