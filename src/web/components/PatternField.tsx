import { useMemo } from 'react';
import { PATTERNS, defaultPattern, findSurface, patternPath, setSurfacePattern, type BookDocument, type SurfacePattern } from '../../core';
import { useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { GradientFields } from './DesignPanel';

// A background pattern for a page, sheet or cover: pick one, then its colour (or a gradient), how
// strong it is, its size and its angle. It sits over the background colour and photo, under
// everything else.

function Swatch({ id, color }: { id: string; color: string }) {
  const d = useMemo(() => patternPath({ id, color, opacity: 1, sizeMm: 9, angleDeg: id === 'stripes' || id === 'pinstripe' ? 45 : 0 }, { x: 0, y: 0, w: 36, h: 36 }), [id, color]);
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
      <path d={d} fill={color} />
    </svg>
  );
}

export function PatternField({ surfaceId }: { surfaceId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const surface = findSurface(doc, surfaceId)?.surface;
  const p = surface?.pattern;
  const { run, gesture, endGesture } = useEditor.getState();
  const surfaceW = doc.settings.product === 'poster' ? doc.settings.trimWidthMm : doc.settings.trimWidthMm * 2;
  const set = (label: string, next: SurfacePattern | undefined) => run(label, (d) => setSurfacePattern(d, surfaceId, next));
  const live = (patch: Partial<SurfacePattern>) => p && gesture((d: BookDocument) => setSurfacePattern(d, surfaceId, { ...p, ...patch }));
  const preview = doc.style.textColor;
  return (
    <div className="stack pattern-field">
      <div className="pattern-grid" role="radiogroup" aria-label="Pattern">
        <button role="radio" aria-checked={!p} className={`pattern-swatch ${!p ? 'on' : ''}`} title="No pattern" onClick={() => p && set('No pattern', undefined)}>
          <span className="small">None</span>
        </button>
        {PATTERNS.map((def) => (
          <button key={def.id} role="radio" aria-checked={p?.id === def.id} className={`pattern-swatch ${p?.id === def.id ? 'on' : ''}`} title={def.name}
            onClick={() => set(`Pattern: ${def.name}`, p ? { ...p, id: def.id } : defaultPattern(def.id, surfaceW, preview))}>
            <Swatch id={def.id} color={preview} />
          </button>
        ))}
      </div>
      {p && (
        <>
          <div className="field-row">
            <div className="field">
              <span>Colour</span>
              <div className="seg">
                <button className={!p.gradient ? 'on' : ''} onClick={() => p.gradient && set('Solid pattern', { ...p, gradient: undefined })}>Solid</button>
                <button className={p.gradient ? 'on' : ''} onClick={() => !p.gradient && set('Gradient pattern', { ...p, gradient: { from: p.color, to: doc.style.background === '#ffffff' ? '#e94f37' : doc.style.background, angleDeg: 135 } })}>Gradient</button>
              </div>
            </div>
            {!p.gradient && (
              <label className="field">
                <span>&nbsp;</span>
                <ColorInput value={p.color} label="Pattern colour" apply={(d, c) => setSurfacePattern(d, surfaceId, { ...p, color: c })} />
              </label>
            )}
          </div>
          {p.gradient && <GradientFields value={p.gradient} label="Pattern" apply={(d, g) => setSurfacePattern(d, surfaceId, { ...p, gradient: g })} />}
          <label className="field">
            <span>Strength — {Math.round(p.opacity * 100)}%</span>
            <input type="range" min={0.03} max={1} step={0.01} value={p.opacity} aria-label="Pattern strength" onChange={(e) => live({ opacity: Number(e.target.value) })} onPointerUp={() => endGesture('Pattern strength')} onKeyUp={() => endGesture('Pattern strength')} />
          </label>
          <label className="field">
            <span>Size — {Math.round(p.sizeMm)} mm</span>
            <input type="range" min={2} max={Math.max(40, Math.round(surfaceW / 4))} step={1} value={p.sizeMm} aria-label="Pattern size" onChange={(e) => live({ sizeMm: Number(e.target.value) })} onPointerUp={() => endGesture('Pattern size')} onKeyUp={() => endGesture('Pattern size')} />
          </label>
          <label className="field">
            <span>Angle — {Math.round(p.angleDeg ?? 0)}°</span>
            <input type="range" min={0} max={180} step={1} value={p.angleDeg ?? 0} aria-label="Pattern angle" onChange={(e) => live({ angleDeg: Number(e.target.value) })} onPointerUp={() => endGesture('Pattern angle')} onKeyUp={() => endGesture('Pattern angle')} />
          </label>
        </>
      )}
    </div>
  );
}
