import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { COVER_INDEX, coverDims, geometryFor, spreadPagesLabel, type BookDocument } from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { SpreadView } from './SpreadView';

// Flip-through preview: the book as a reader sees it — closed front cover, each spread with real
// page turns, the back cover — with no guides, handles or bleed. Posters show the trimmed sheet.

/** What one view shows: the front or back cover (one board) or a spread (two pages). */
type View = { kind: 'front' } | { kind: 'back' } | { kind: 'spread'; index: number };

const TURN_MS = 650;

export function FlipPreview({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const start = useEditor((s) => s.currentSpread);
  const poster = doc.settings.product === 'poster';
  const views = useMemo<View[]>(() => {
    if (poster) return [{ kind: 'spread', index: 0 }];
    return [...(doc.cover ? [{ kind: 'front' } as View] : []), ...doc.spreads.map((_, index) => ({ kind: 'spread', index }) as View), ...(doc.cover ? [{ kind: 'back' } as View] : [])];
  }, [doc.cover, doc.spreads, poster]);
  const startAt = Math.max(0, views.findIndex((v) => (start === COVER_INDEX ? v.kind === 'front' : v.kind === 'spread' && v.index === start)));
  const [at, setAt] = useState(startAt);
  const [turn, setTurn] = useState<null | { from: number; to: number }>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const go = useCallback(
    (to: number) => {
      if (turn || to < 0 || to >= views.length || to === at) return;
      const both = views[at].kind === 'spread' && views[to].kind === 'spread' && Math.abs(to - at) === 1;
      if (!both) return setAt(to);
      setTurn({ from: at, to });
      setTimeout(() => {
        setAt(to);
        setTurn(null);
      }, TURN_MS);
    },
    [at, turn, views],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        go(at + 1);
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(at - 1);
      if (e.key === 'Home') go(0);
      if (e.key === 'End') go(views.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, go, onClose, views.length]);

  const s = doc.settings;
  const W = s.trimWidthMm;
  const H = s.trimHeightMm;
  const spreadW = poster ? W : 2 * W;
  // Fit the open book (or the sheet) in the window with room for the controls.
  const scale = Math.min((size.w - 160) / spreadW, (size.h - 150) / H);
  const view = views[at];
  const label = (v: View) => (v.kind === 'front' ? 'Front cover' : v.kind === 'back' ? 'Back cover' : poster ? doc.title : spreadPagesLabel(v.index, doc.spreads.length));

  return (
    <div className="flip" role="dialog" aria-label="Preview">
      <div className="flip-top">
        <span className="flip-title">{doc.title}</span>
        <span className="muted small">{turn ? label(views[turn.to]) : label(view)}</span>
        <button className="icon-btn" onClick={onClose} title="Close preview (Esc)" aria-label="Close preview"><Icon name="x" /></button>
      </div>
      <div className="flip-stage">
        {!poster && <button className="flip-arrow" disabled={at === 0} onClick={() => go(at - 1)} aria-label="Previous page"><Icon name="left" size={22} /></button>}
        <div className="flip-book" style={{ width: spreadW * scale, height: H * scale }}>
          {turn ? <Turning doc={doc} views={views} turn={turn} scale={scale} assets={assets} /> : <Open doc={doc} view={view} scale={scale} assets={assets} poster={poster} onFlip={(dir) => go(at + dir)} />}
        </div>
        {!poster && <button className="flip-arrow" disabled={at === views.length - 1} onClick={() => go(at + 1)} aria-label="Next page"><Icon name="right" size={22} /></button>}
      </div>
      {!poster && (
        <div className="flip-bottom">
          <input type="range" min={0} max={views.length - 1} value={at} onChange={(e) => go(Number(e.target.value))} aria-label="Page" />
          <span className="muted small">Arrow keys or click a page to turn · Esc to close</span>
        </div>
      )}
    </div>
  );
}

type Assets = ReturnType<typeof useEditor.getState>['assetMap'];

/** A view at rest. Clicking the left or right half turns the page. */
function Open({ doc, view, scale, assets, poster, onFlip }: { doc: BookDocument; view: View; scale: number; assets: Assets; poster: boolean; onFlip: (dir: 1 | -1) => void }) {
  const W = doc.settings.trimWidthMm;
  if (poster) return <Half doc={doc} view={view} side="whole" scale={scale} assets={assets} />;
  if (view.kind !== 'spread') {
    // Closed book: one board, on the right for the front, on the left for the back.
    return (
      <div className="flip-pages">
        <div className="flip-slot" style={{ left: view.kind === 'front' ? W * scale : 0 }} onClick={() => onFlip(view.kind === 'front' ? 1 : -1)}>
          <Half doc={doc} view={view} side="left" scale={scale} assets={assets} />
        </div>
      </div>
    );
  }
  return (
    <div className="flip-pages">
      <div className="flip-slot" style={{ left: 0 }} onClick={() => onFlip(-1)}><Half doc={doc} view={view} side="left" scale={scale} assets={assets} /></div>
      <div className="flip-slot" style={{ left: W * scale }} onClick={() => onFlip(1)}><Half doc={doc} view={view} side="right" scale={scale} assets={assets} /></div>
      <div className="flip-gutter" style={{ left: W * scale }} />
    </div>
  );
}

/** A page turning: the leaf rotates about the spine; its back shows the next page. */
function Turning({ doc, views, turn, scale, assets }: { doc: BookDocument; views: View[]; turn: { from: number; to: number }; scale: number; assets: Assets }) {
  const W = doc.settings.trimWidthMm * scale;
  const from = views[turn.from];
  const to = views[turn.to];
  const forward = turn.to > turn.from;
  const leaf: CSSProperties = { left: forward ? W : 0, transformOrigin: forward ? 'left center' : 'right center', animation: `${forward ? 'flip-fwd' : 'flip-back'} ${TURN_MS}ms ease-in-out forwards` };
  return (
    <div className="flip-pages">
      {/* Underneath: what stays put, and what the leaf uncovers. */}
      <div className="flip-slot" style={{ left: 0 }}><Half doc={doc} view={forward ? from : to} side="left" scale={scale} assets={assets} /></div>
      <div className="flip-slot" style={{ left: W }}><Half doc={doc} view={forward ? to : from} side="right" scale={scale} assets={assets} /></div>
      <div className="flip-leaf" style={leaf}>
        <div className="flip-face"><Half doc={doc} view={from} side={forward ? 'right' : 'left'} scale={scale} assets={assets} /></div>
        <div className="flip-face flip-face-back"><Half doc={doc} view={to} side={forward ? 'left' : 'right'} scale={scale} assets={assets} /></div>
        <div className="flip-shade" />
      </div>
      <div className="flip-gutter" style={{ left: W }} />
    </div>
  );
}

/**
 * One page of a view, trimmed (no bleed): the left or right page of a spread, a cover board, or
 * the whole poster sheet. Inside covers show as the board.
 */
function Half({ doc, view, side, scale, assets }: { doc: BookDocument; view: View; side: 'left' | 'right' | 'whole'; scale: number; assets: Assets }) {
  const s = doc.settings;
  const W = s.trimWidthMm;
  const H = s.trimHeightMm;
  const n = doc.spreads.length;
  if (view.kind !== 'spread') {
    if (!doc.cover) return null;
    const g = geometryFor(s, n, COVER_INDEX);
    const { panelW, spine } = coverDims(doc);
    const x0 = view.kind === 'front' ? panelW + spine.mm : 0;
    return (
      <div className="flip-page" style={{ width: panelW * scale, height: H * scale }}>
        <div style={{ position: 'absolute', left: -(x0 + g.bleed) * scale, top: -g.bleed * scale }}>
          <SpreadView settings={s} style={doc.style} spreadCount={n} index={COVER_INDEX} surface={doc.cover} scale={scale} assets={assets} grade={doc.grade} />
        </div>
      </div>
    );
  }
  const index = view.index;
  const inside = (side === 'left' && index === 0) || (side === 'right' && index === n - 1);
  if (inside && doc.settings.product !== 'poster') return <div className="flip-page flip-board" style={{ width: W * scale, height: H * scale }} />;
  const g = geometryFor(s, n, index);
  const x0 = side === 'right' ? W : 0;
  return (
    <div className="flip-page" style={{ width: W * scale, height: H * scale }}>
      <div style={{ position: 'absolute', left: -(x0 + g.bleed) * scale, top: -g.bleed * scale }}>
        <SpreadView settings={s} style={doc.style} spreadCount={n} index={index} surface={doc.spreads[index]} scale={scale} assets={assets} grade={doc.grade} />
      </div>
    </div>
  );
}
