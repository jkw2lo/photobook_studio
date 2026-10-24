import { MOSAIC_LAYOUT, TEMPLATES, type LayoutTemplate } from '../../core';
import { CollageDiagram } from './CollageControls';

/** Miniature diagrams of layout templates. */
export function TemplatePicker({
  scope, current, onPick, imageCount, onMosaic,
}: { scope: 'page' | 'spread'; current?: string; onPick: (id: string) => void; imageCount?: number; onMosaic?: () => void }) {
  const list = TEMPLATES.filter((t) => t.scope === scope && t.special !== 'divider').sort((a, b) => a.imageCount - b.imageCount);
  return (
    <div className="template-grid">
      {onMosaic && (
        <button className={`template mosaic-option ${current === MOSAIC_LAYOUT ? 'on' : ''}`} title="Mosaic — fits however many photos are on the page, edge to edge" onClick={onMosaic}>
          <CollageDiagram id="mosaic" /> Mosaic
        </button>
      )}
      {list.map((t) => (
        <button
          key={t.id}
          className={`template ${t.id === current ? 'on' : ''} ${imageCount !== undefined && t.imageCount === imageCount ? 'fits' : ''}`}
          title={`${t.name} — ${t.imageCount} photo${t.imageCount === 1 ? '' : 's'}`}
          onClick={() => onPick(t.id)}
        >
          <TemplateDiagram t={t} wide={scope === 'spread'} />
        </button>
      ))}
    </div>
  );
}

export function TemplateDiagram({ t, wide }: { t: LayoutTemplate; wide?: boolean }) {
  const W = wide ? 64 : 32;
  const H = 32;
  const m = 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="1.5" className="tpl-page" />
      {t.slots.map((s, i) => {
        const inner = s.box === 'bleed' ? 0 : m;
        const x = inner + s.x * (W - 2 * inner);
        const y = inner + s.y * (H - 2 * inner);
        const w = s.w * (W - 2 * inner);
        const h = s.h * (H - 2 * inner);
        const transform = s.rotationDeg ? `rotate(${s.rotationDeg} ${x + w / 2} ${y + h / 2})` : undefined;
        return s.kind === 'image' ? (
          <rect key={i} x={x + 0.6} y={y + 0.6} width={Math.max(1, w - 1.2)} height={Math.max(1, h - 1.2)} className="tpl-img" transform={transform} />
        ) : (
          <rect key={i} x={x + w * 0.2} y={y + h * 0.35} width={w * 0.6} height={Math.max(1, h * 0.3)} className="tpl-text" transform={transform} />
        );
      })}
    </svg>
  );
}
