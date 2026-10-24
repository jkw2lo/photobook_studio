import type { ReactElement } from 'react';
import { COLLAGE_STYLES, PHOTO_ORDERS, type BookDocument, type CollageSettings } from '../../core';

// Shared controls for collage settings: used by the Auto collage dialog and the poster panel.
// Spacing and borders scale with the sheet, so "Small" looks the same on 11 × 14 and 24 × 36.

const GAPS = [
  { label: 'None', f: 0 },
  { label: 'Hairline', f: 0.005 },
  { label: 'Small', f: 0.011 },
  { label: 'Roomy', f: 0.024 },
];
const MARGINS = [
  { label: 'Edge to edge', short: 'None', f: 0 },
  { label: 'Thin', short: 'Thin', f: 0.035 },
  { label: 'Classic', short: 'Classic', f: 0.07 },
  { label: 'Gallery', short: 'Gallery', f: 0.12 },
];

const shortSide = (doc: BookDocument) => Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm);
const round1 = (v: number) => Math.round(v * 10) / 10;
export const gapOptions = (doc: BookDocument) => GAPS.map((g) => ({ label: g.label, mm: round1(g.f * shortSide(doc)) }));
export const marginOptions = (doc: BookDocument) =>
  MARGINS.map((m) => ({ label: m.label, short: m.short, mm: m.f === 0 ? 0 : round1(Math.max(doc.settings.safeMarginMm + 2, m.f * shortSide(doc))) }));

/** Closest option to a stored value (so a saved 12.4 mm still highlights "Thin"). */
const nearest = (opts: { mm: number }[], v: number) => opts.reduce((b, o) => (Math.abs(o.mm - v) < Math.abs(b.mm - v) ? o : b), opts[0]).mm;

export function CollageControls({ doc, value, onChange, compact }: { doc: BookDocument; value: CollageSettings; onChange: (next: CollageSettings) => void; compact?: boolean }) {
  const gaps = gapOptions(doc);
  const margins = marginOptions(doc);
  return (
    <div className="stack">
      <div className={compact ? 'collage-styles compact' : 'collage-styles'}>
        {COLLAGE_STYLES.map((s) => (
          <button key={s.id} type="button" className={`collage-style ${value.style === s.id ? 'on' : ''}`} onClick={() => onChange({ ...value, style: s.id })} title={s.description}>
            <CollageDiagram id={s.id} />
            <strong>{s.name}</strong>
            {!compact && <span className="muted small">{s.description}</span>}
          </button>
        ))}
      </div>
      <div className="field">
        <span>Arrange</span>
        <div className="seg seg-wide">
          {PHOTO_ORDERS.map((o) => (
            <button key={o.id} type="button" title={o.description} className={(value.order ?? 'time') === o.id ? 'on' : ''} onClick={() => onChange({ ...value, order: o.id })}>{o.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{compact ? 'Spacing' : 'Spacing between photos'}</span>
        <div className="seg seg-wide">
          {gaps.map((g) => (
            <button key={g.label} type="button" className={nearest(gaps, value.gapMm) === g.mm ? 'on' : ''} onClick={() => onChange({ ...value, gapMm: g.mm })}>{g.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{compact ? 'Border' : 'Border around the collage'}</span>
        <div className="seg seg-wide">
          {margins.map((m) => (
            <button key={m.label} type="button" title={m.label} className={nearest(margins, value.marginMm) === m.mm ? 'on' : ''} onClick={() => onChange({ ...value, marginMm: m.mm })}>{compact ? m.short : m.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Title</span>
        <div className="seg seg-wide">
          {(['none', 'top', 'bottom'] as const).map((t) => (
            <button key={t} type="button" className={value.titlePosition === t ? 'on' : ''} onClick={() => onChange({ ...value, titlePosition: t })}>
              {compact ? ({ none: 'None', top: 'Top', bottom: 'Bottom' } as const)[t] : t === 'none' ? 'No title' : t === 'top' ? 'Title at top' : 'Title at bottom'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CollageDiagram({ id }: { id: string }) {
  const W = 46;
  const H = 34;
  const r = (x: number, y: number, w: number, h: number, rot = 0, k = 0) => (
    <rect key={`${x}-${y}-${k}`} x={x} y={y} width={w} height={h} className="tpl-img" transform={rot ? `rotate(${rot} ${x + w / 2} ${y + h / 2})` : undefined} />
  );
  let shapes: ReactElement[] = [];
  if (id === 'grid') {
    for (let i = 0; i < 12; i++) shapes.push(r(3 + (i % 4) * 10.3, 3 + Math.floor(i / 4) * 9.6, 9.3, 8.6, 0, i));
  } else if (id === 'hero') {
    shapes = [r(3, 3, 40, 14), r(3, 18.5, 12, 6), r(16, 18.5, 14, 6), r(31, 18.5, 12, 6), r(3, 25.5, 16, 5.5), r(20, 25.5, 9, 5.5), r(30, 25.5, 13, 5.5)];
  } else if (id === 'scatter') {
    shapes = [r(4, 4, 14, 11, -8, 1), r(19, 3, 13, 10, 6, 2), r(31, 6, 12, 10, -4, 3), r(6, 17, 13, 11, 5, 4), r(19, 17, 14, 12, -6, 5), r(31, 18, 12, 10, 8, 6)];
  } else {
    shapes = [r(3, 3, 16, 9), r(20, 3, 9, 9), r(30, 3, 13, 9), r(3, 13, 10, 9), r(14, 13, 17, 9), r(32, 13, 11, 9), r(3, 23, 14, 8), r(18, 23, 11, 8), r(30, 23, 13, 8)];
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="collage-diagram">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="1.5" className="tpl-page" />
      {shapes}
    </svg>
  );
}
