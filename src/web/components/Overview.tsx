import { useLayoutEffect, useRef, useState } from 'react';
import { COVER_INDEX, geometryFor, spreadPagesLabel, type Spread } from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { SpreadView } from './SpreadView';

/** The whole book at a glance — the place to judge pacing and rhythm. Click a spread to edit it. */
export function Overview() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const n = doc.spreads.length;
  const cols = width > 1100 ? 3 : 2;
  const cellW = (width - 48 - (cols - 1) * 28) / cols;
  const items: { index: number; surface: Spread; label: string; chapter?: string }[] = [
    ...(doc.cover ? [{ index: COVER_INDEX, surface: doc.cover, label: 'Cover' }] : []),
    ...doc.spreads.map((spread, i) => ({
      index: i,
      surface: spread,
      label: spreadPagesLabel(i, n),
      chapter: spread.chapterId !== doc.spreads[i - 1]?.chapterId ? doc.chapters.find((c) => c.id === spread.chapterId)?.title : undefined,
    })),
  ];
  return (
    <div className="overview" ref={ref}>
      <div className="overview-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {items.map((it) => {
          const g = geometryFor(doc.settings, n, it.index);
          const scale = cellW / (g.width + 2 * g.bleed);
          return (
            <button key={it.surface.id} className="overview-item" onClick={() => useEditor.getState().goToSpread(it.index)}>
              <div className="overview-meta">
                <span>{it.label}</span>
                {it.chapter && <span className="overview-chapter">{it.chapter}</span>}
                {it.surface.locked && <Icon name="lock" size={12} />}
              </div>
              <SpreadView settings={doc.settings} style={doc.style} spreadCount={n} index={it.index} surface={it.surface} scale={scale} assets={assets} thumbSize="s" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
