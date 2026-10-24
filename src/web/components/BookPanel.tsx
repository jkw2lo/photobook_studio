import { useEffect, useState } from 'react';
import {
  PRINTERS, nearestWeight, weightName, SIZE_PRESETS, STYLE_PRESETS, applyPrinter, applyStylePreset, binding, fontFamily, pageCountOf,
  printer, setTitle, updateSettings, updateStyle, type BindingId, type BleedMode, type FontRef,
} from '../../core';
import { api } from '../api';
import { useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { FontPicker } from './FontPicker';
import { Icon } from './Icon';
import { NumField } from './Inspector';

export function BookPanel() {
  const doc = useEditor((s) => s.doc)!;
  const projectId = useEditor((s) => s.projectId)!;
  const revision = useEditor((s) => s.revision);
  const { run } = useEditor.getState();
  const st = doc.settings;
  const style = doc.style;

  return (
    <div className="stack">
      <label className="field">
        <span>Title</span>
        <input value={doc.title} onChange={(e) => useEditor.getState().gesture((d) => setTitle(d, e.target.value))} onBlur={() => useEditor.getState().endGesture('Rename book')} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <label className="field">
        <span>Subtitle</span>
        <input value={doc.subtitle} placeholder="Defaults to the date range" onChange={(e) => useEditor.getState().gesture((d) => setTitle(d, d.title, e.target.value))} onBlur={() => useEditor.getState().endGesture('Edit subtitle')} onKeyDown={(e) => e.stopPropagation()} />
      </label>

      <PrinterSection />

      <div className="section-title">Style</div>
      <label className="field">
        <span>Preset</span>
        <select value={style.presetId} onChange={(e) => run('Change style', (d) => applyStylePreset(d, e.target.value))}>
          {STYLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="muted small">{STYLE_PRESETS.find((p) => p.id === style.presetId)?.description} Existing pages keep their layout until you regenerate or re-apply layouts.</p>
      <div className="field-row">
        <NumField label="Outer margin" value={style.marginOuterMm} min={0} max={60} suffix="mm" onCommit={(v) => run('Margins', (d) => updateStyle(d, { marginOuterMm: v }))} />
        <NumField label="Inner margin" value={style.marginInnerMm} min={0} max={60} suffix="mm" onCommit={(v) => run('Margins', (d) => updateStyle(d, { marginInnerMm: v }))} />
      </div>
      <div className="field-row">
        <NumField label="Top margin" value={style.marginTopMm} min={0} max={60} suffix="mm" onCommit={(v) => run('Margins', (d) => updateStyle(d, { marginTopMm: v }))} />
        <NumField label="Bottom margin" value={style.marginBottomMm} min={0} max={60} suffix="mm" onCommit={(v) => run('Margins', (d) => updateStyle(d, { marginBottomMm: v }))} />
      </div>
      <div className="field-row">
        <NumField label="Gap" value={style.gapMm} min={0} max={30} suffix="mm" onCommit={(v) => run('Gap', (d) => updateStyle(d, { gapMm: v }))} />
        <NumField label="Photo border" value={style.imageBorderMm} min={0} max={15} suffix="mm" onCommit={(v) => run('Photo border', (d) => updateStyle(d, { imageBorderMm: v }))} />
      </div>
      <div className="field-row">
        <label className="field">
          <span>Paper</span>
          <ColorInput value={style.background} label="Paper colour" apply={(d, c) => updateStyle(d, { background: c })} />
        </label>
        <label className="field">
          <span>Text</span>
          <ColorInput value={style.textColor} label="Text colour" apply={(d, c) => updateStyle(d, { textColor: c })} />
        </label>
      </div>
      <FontSelect label="Headings" value={style.headingFont} onChange={(f) => run('Heading font', (d) => updateStyle(d, { headingFont: f }))} />
      <FontSelect label="Body" value={style.bodyFont} onChange={(f) => run('Body font', (d) => updateStyle(d, { bodyFont: f }))} />
      <FontSelect label="Captions" value={style.captionFont} onChange={(f) => run('Caption font', (d) => updateStyle(d, { captionFont: f }))} />
      <p className="muted small">Fonts and margins apply to new layouts and regenerated pages.</p>

      <History projectId={projectId} revision={revision} />
    </div>
  );
}

function FontSelect({ label, value, onChange }: { label: string; value: FontRef; onChange: (f: FontRef) => void }) {
  return (
    <div className="field-row">
      <div className="field field-grow">
        <span>{label}</span>
        <FontPicker value={value.family} onChange={(family) => onChange({ family, weight: nearestWeight(family, value.weight) })} />
      </div>
      <label className="field field-weight">
        <span>Weight</span>
        <select value={value.weight} onChange={(e) => onChange({ ...value, weight: Number(e.target.value) })}>
          {fontFamily(value.family).weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
        </select>
      </label>
    </div>
  );
}

/** Saved versions (last 50 autosaves). Restoring is itself an undoable edit. */
function History({ projectId, revision }: { projectId: string; revision: number }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ revision: number; savedAt: string }[]>([]);
  useEffect(() => {
    if (open) void api.revisions(projectId).then(setList);
  }, [open, projectId, revision]);
  return (
    <div>
      <button className="btn btn-small" onClick={() => setOpen(!open)}>
        <Icon name="history" /> Version history
      </button>
      {open && (
        <ul className="history">
          {list.slice(0, 20).map((r) => (
            <li key={r.revision}>
              <span>{new Date(r.savedAt).toLocaleString()}</span>
              {r.revision === revision ? (
                <em className="muted">current</em>
              ) : (
                <button
                  className="link"
                  onClick={async () => {
                    const { doc } = await api.revision(projectId, r.revision);
                    useEditor.getState().run(`Restore version from ${new Date(r.savedAt).toLocaleTimeString()}`, () => doc);
                    useEditor.getState().toast('success', 'Version restored. Undo to go back.');
                  }}
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PrinterSection() {
  const doc = useEditor((s) => s.doc)!;
  const { run } = useEditor.getState();
  const st = doc.settings;
  const pr = printer(st.printerId);
  const bind = binding(st);
  const pages = pageCountOf(doc);
  const hasContent = doc.spreads.some((s) => s.elements.length);
  const sizes = pr.id === 'custom' ? SIZE_PRESETS.map((z) => ({ id: z.id, name: z.name, widthMm: z.widthMm, heightMm: z.heightMm })) : pr.sizes;
  const sizeId = sizes.find((z) => Math.abs(z.widthMm - st.trimWidthMm) < 0.5 && Math.abs(z.heightMm - st.trimHeightMm) < 0.5)?.id ?? 'custom';
  const confirmReflow = () => !hasContent || window.confirm('Changing the trim size does not rescale existing layouts — regenerate or re-apply layouts afterwards. Continue?');
  const outOfRange = (bind.minPages && pages < bind.minPages) || (bind.maxPages && pages > bind.maxPages);

  return (
    <>
      <div className="section-title">Printer</div>
      <div className="field-row">
        <label className="field">
          <span>Printer</span>
          <select
            value={st.printerId}
            onChange={(e) => {
              const next = printer(e.target.value);
              const willResize = next.sizes.length > 0 && !next.sizes.some((z) => Math.abs(z.widthMm - st.trimWidthMm) < 0.5 && Math.abs(z.heightMm - st.trimHeightMm) < 0.5);
              if (willResize && !confirmReflow()) return;
              run(`Printer: ${next.name}`, (d) => applyPrinter(d, next.id, st.bindingId));
            }}
          >
            {PRINTERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Binding</span>
          <select value={bind.id} onChange={(e) => run('Binding', (d) => applyPrinter(d, st.printerId, e.target.value as BindingId, sizeId))}>
            {pr.bindings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Trim size</span>
        <select
          value={sizeId}
          onChange={(e) => {
            const z = sizes.find((x) => x.id === e.target.value);
            if (!z || !confirmReflow()) return;
            run('Change page size', (d) => (pr.id === 'custom' ? updateSettings(d, { trimWidthMm: z.widthMm, trimHeightMm: z.heightMm }) : applyPrinter(d, pr.id, st.bindingId, z.id)));
          }}
        >
          {sizes.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          {sizeId === 'custom' && <option value="custom">Custom ({st.trimWidthMm.toFixed(1)} × {st.trimHeightMm.toFixed(1)} mm)</option>}
        </select>
      </label>
      <p className={`small ${outOfRange ? 'warn-text' : 'muted'}`}>
        {pages} pages{bind.minPages ? ` · ${pr.name} ${bind.name} takes ${bind.minPages}–${bind.maxPages}` : ''}. {pr.notes}
      </p>
      <div className="field-row">
        <NumField label="Bleed" value={st.bleedMm} min={0} max={10} step={0.125} suffix="mm" onCommit={(v) => run('Bleed', (d) => updateSettings(d, { bleedMm: v }))} />
        <label className="field">
          <span>Bleed at the spine</span>
          <select value={st.bleedMode} onChange={(e) => run('Bleed mode', (d) => updateSettings(d, { bleedMode: e.target.value as BleedMode }))}>
            <option value="all">Yes — all four sides</option>
            <option value="outer">No — outer edges only</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <NumField label="Safe margin" value={st.safeMarginMm} min={0} max={30} suffix="mm" onCommit={(v) => run('Safe margin', (d) => updateSettings(d, { safeMarginMm: v }))} />
        <NumField label="Binding zone" value={st.bindingZoneMm} min={0} max={40} suffix="mm" onCommit={(v) => run('Binding zone', (d) => updateSettings(d, { bindingZoneMm: v }))} />
      </div>
      <label className="field check">
        <input type="checkbox" checked={st.pageNumbers} onChange={(e) => run('Page numbers', (d) => updateSettings(d, { pageNumbers: e.target.checked }))} />
        <span>Page numbers</span>
      </label>
    </>
  );
}
