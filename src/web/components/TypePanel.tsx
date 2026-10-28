import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  TEXT_QUICK_STYLES, TEXT_ROLES, TYPE_PACKS, addTextAt, applyQuickStyle, applyTypePack, fontFamily, pageScale, roleLabel, roleStyle, setRoleStyle, toneColor,
  weightName, type BookStyle, type TextRole, type TextStyle,
} from '../../core';
import { useEditor } from '../store';
import { FontPicker } from './FontPicker';
import { Icon } from './Icon';
import { NumField } from './Inspector';

/** CSS for previewing a style (sizes are fixed for previews; the page uses real sizes). */
export function previewCss(style: BookStyle, ts: TextStyle, px: number): CSSProperties {
  return {
    fontFamily: `'${ts.family}'`,
    fontWeight: ts.weight,
    fontSize: px,
    letterSpacing: ts.letterSpacingEm ? `${ts.letterSpacingEm}em` : undefined,
    textTransform: ts.uppercase ? 'uppercase' : undefined,
    color: toneColor(style, ts.tone),
    lineHeight: 1.15,
  };
}

/** Book tab: choose a type pack, then fine-tune any role. */
export function TypeSection() {
  const doc = useEditor((s) => s.doc)!;
  const { run } = useEditor.getState();
  const style = doc.style;
  const [open, setOpen] = useState<TextRole | null>(null);
  const [showRoles, setShowRoles] = useState(false);

  return (
    <div className="stack">
      <div className="section-title">Type</div>
      <div className="type-packs">
        {TYPE_PACKS.map((p) => {
          const preview = { ...style, textStyles: p.roles };
          return (
            <button key={p.id} className={`type-pack ${style.typePackId === p.id ? 'on' : ''}`} onClick={() => run(`Type: ${p.name}`, (d) => applyTypePack(d, p.id))} title={p.description}>
              <div className="type-pack-sample" style={{ background: style.background }}>
                <span style={previewCss(preview, p.roles.title, 17)}>Aa Title</span>
                <span style={previewCss(preview, p.roles.label, 8)}>{p.roles.label.uppercase ? 'Label' : 'label'} · caption</span>
              </div>
              <span className="type-pack-name">{p.name}</span>
            </button>
          );
        })}
      </div>
      <p className="muted small">
        {style.typePackId === 'custom' ? 'Custom styles. ' : `${TYPE_PACKS.find((p) => p.id === style.typePackId)?.description ?? ''} `}
        Text that follows its style updates everywhere — pages, cover and posters. Text you’ve restyled by hand keeps its look.
      </p>

      <button className="link small" onClick={() => setShowRoles(!showRoles)}>{showRoles ? 'Hide text styles' : 'Customize text styles…'}</button>
      {showRoles && (
        <div className="role-list">
          {TEXT_ROLES.map(({ role, label, sample }) => {
            const ts = roleStyle(style, role);
            return (
              <div key={role} className={`role-row ${open === role ? 'open' : ''}`}>
                <button className="role-head" onClick={() => setOpen(open === role ? null : role)}>
                  <span className="role-name">{label}</span>
                  <span className="role-sample" style={previewCss(style, ts, Math.min(18, Math.max(9, ts.sizePt * 0.8)))}>{sample}</span>
                  <Icon name="down" size={12} />
                </button>
                {open === role && <RoleEditor role={role} ts={ts} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleEditor({ role, ts }: { role: TextRole; ts: TextStyle }) {
  const doc = useEditor((s) => s.doc)!;
  const { run } = useEditor.getState();
  const scale = pageScale(doc);
  const set = (patch: Partial<TextStyle>, what: string) => run(`${roleLabel(role)} ${what}`, (d) => setRoleStyle(d, role, patch));
  return (
    <div className="role-editor stack">
      <FontPicker value={ts.family} onChange={(family) => set({ family }, 'font')} />
      <div className="field-row">
        <label className="field">
          <span>Weight</span>
          <select value={ts.weight} onChange={(e) => set({ weight: Number(e.target.value) }, 'weight')}>
            {fontFamily(ts.family).weights.map((w) => <option key={w} value={w}>{weightName(w)}</option>)}
          </select>
        </label>
        <NumField label="Size" value={Math.round(ts.sizePt * scale * 2) / 2} min={4} max={300} suffix="pt" onCommit={(v) => set({ sizePt: v / scale }, 'size')} />
      </div>
      <div className="field-row">
        <NumField label="Letter spacing" value={Math.round(ts.letterSpacingEm * 100)} min={-10} max={60} step={1} suffix="%" onCommit={(v) => set({ letterSpacingEm: v / 100 }, 'letter spacing')} />
        <NumField label="Line height" value={ts.lineHeight} min={0.8} max={2.5} step={0.05} onCommit={(v) => set({ lineHeight: v }, 'line height')} />
      </div>
      <div className="field-row">
        <div className="field">
          <span>Case</span>
          <div className="seg">
            <button className={!ts.uppercase ? 'on' : ''} onClick={() => set({ uppercase: false }, 'case')}>Aa</button>
            <button className={ts.uppercase ? 'on' : ''} onClick={() => set({ uppercase: true }, 'case')}>AA</button>
          </div>
        </div>
        <div className="field">
          <span>Tone</span>
          <div className="seg">
            <button className={ts.tone === 'text' ? 'on' : ''} onClick={() => set({ tone: 'text' }, 'tone')}>Normal</button>
            <button className={ts.tone === 'muted' ? 'on' : ''} onClick={() => set({ tone: 'muted' }, 'tone')}>Muted</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Add text" with a choice of style; each option previews in its own style. */
/** Add a text box in a role style or a quick style; it is selected straight away. */
function addText(surfaceId: string, at: { x: number; y: number }, role: TextRole, quick?: (typeof TEXT_QUICK_STYLES)[number]) {
  let id = '';
  useEditor.getState().run(quick ? `Add text: ${quick.name}` : `Add ${roleLabel(role).toLowerCase()}`, (d) => {
    const r = addTextAt(d, surfaceId, at.x, at.y, quick?.sample, role);
    id = r.newId;
    return quick ? applyQuickStyle(r.doc, surfaceId, r.newId, quick.id) : r.doc;
  });
  if (id) useEditor.getState().select({ spreadId: surfaceId, elementId: id });
}

/** Every way to add text: the book's text styles, then the quick styles — each shown in its look. */
export function TextChoices({ surfaceId, at, onPick }: { surfaceId: string; at: { x: number; y: number }; onPick?: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const pick = (role: TextRole, quick?: (typeof TEXT_QUICK_STYLES)[number]) => {
    onPick?.();
    addText(surfaceId, at, role, quick);
  };
  return (
    <div className="text-choices">
      <div className="add-text-head">Text styles</div>
      <div className="add-text-roles">
        {TEXT_ROLES.map(({ role, label }) => (
          <button key={role} role="menuitem" className="add-text-option" style={{ background: doc.style.background }} onClick={() => pick(role)} title={`Add ${label.toLowerCase()} text`}>
            {/* Shown on the book's own paper colour, in its own text style. */}
            <span style={previewCss(doc.style, roleStyle(doc.style, role), Math.min(17, Math.max(9, roleStyle(doc.style, role).sizePt * 0.7)))}>{label}</span>
          </button>
        ))}
      </div>
      <div className="add-text-head">Quick styles</div>
      <div className="add-text-quick">
        {TEXT_QUICK_STYLES.map((q) => (
          <button key={q.id} role="menuitem" className="add-text-option quick" title={q.name} onClick={() => pick(q.sizePt >= 20 ? 'title' : 'body', q)}>
            <span
              style={{
                fontFamily: `'${q.family}'`, fontWeight: q.weight, fontStyle: q.italic ? 'italic' : undefined,
                textTransform: q.uppercase ? 'uppercase' : undefined, letterSpacing: q.letterSpacingEm ? `${Math.min(q.letterSpacingEm, 0.15)}em` : undefined,
                fontSize: q.sizePt >= 30 ? 16 : q.sizePt >= 20 ? 14 : 10.5,
                ...(q.background ? { background: q.background.tone === 'text' ? '#1b1b1d' : '#e4e0d6', color: q.background.tone === 'text' ? '#f7f5f0' : '#1b1b1d', padding: '1px 5px' } : {}),
              }}
            >
              {q.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Add text" button with the choices in a drop-down (used where the Add tab isn't at hand). */
export function AddTextMenu({ surfaceId, at, disabled }: { surfaceId: string; at: { x: number; y: number }; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  /** Open below the button, or above it when there isn't room — and never past the window. */
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r && !open) {
      // Stay inside the scrolling panel the button sits in (it clips anything outside it).
      const box = ref.current!.closest('.inspector-body')?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      const below = box.bottom - r.bottom - 8;
      const above = r.top - box.top - 8;
      setPlace(below >= 360 || below >= above ? { maxHeight: Math.max(200, below) } : { top: 'auto', bottom: 'calc(100% + 4px)', maxHeight: above });
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="add-text" ref={ref}>
      <button className="btn btn-small" disabled={disabled} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="text" /> Add text <Icon name="down" size={12} />
      </button>
      {open && (
        <div className="add-text-menu" role="menu" style={place}>
          <TextChoices surfaceId={surfaceId} at={at} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
