import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { COVER_INDEX, geometryFor, surfaceAt } from '../../core';
import { useEditor } from '../store';
import { Modal } from './Modal';
import { SpreadView } from './SpreadView';

// "See it for real": the poster (or a page) drawn into a simple room — framed on a wall above a sofa,
// or as a print lying on a table. The scenes are drawn here (no photos fetched), and the design is
// the same rendering as the editor, sized true to scale against the furniture.

type Scene = 'wall' | 'table';
type Frame = 'none' | 'black' | 'white' | 'oak';

const SCENE_W = 760;
const SCENE_H = 500;
/** The wall scene shows about 3 m of wall; the table about 60 cm of tabletop. */
const WALL_MM = 3000;
const TABLE_MM = 620;

export function MockupPreview({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const index = useEditor((s) => s.currentSpread);
  const poster = doc.settings.product === 'poster';
  const [scene, setScene] = useState<Scene>(poster ? 'wall' : 'table');
  const [frame, setFrame] = useState<Frame>('black');
  const [wall, setWall] = useState('#e9e3d8');
  const [mat, setMat] = useState(false);
  // Books: the cover if there is one, else the page you're on.
  const shownIndex = poster ? 0 : doc.cover && index === COVER_INDEX ? COVER_INDEX : index;
  const surface = surfaceAt(doc, shownIndex) ?? doc.spreads[0];
  const g = geometryFor(doc.settings, doc.spreads.length, surface === doc.cover ? COVER_INDEX : shownIndex);
  const pxPerMm = scene === 'wall' ? SCENE_W / WALL_MM : SCENE_W / TABLE_MM;
  // Show the trimmed sheet: the bleed is cut off in print.
  const trimW = g.width;
  const trimH = g.height;
  // Prints on the table are shown at a hand-held size (long side ≈ 18 cm); posters on the wall at their real size.
  const fitTable = scene === 'table' ? 180 / Math.max(trimW, trimH) : 1;
  const scale = pxPerMm * fitTable;
  const frameMm = frame === 'none' ? 0 : 22;
  const matMm = mat && frame !== 'none' ? Math.min(trimW, trimH) * 0.12 : 0;

  const art = (
    <div className="mock-art" style={{ width: trimW * scale, height: trimH * scale }}>
      <div style={{ position: 'absolute', left: -g.bleed * scale, top: -g.bleed * scale }}>
        <SpreadView settings={doc.settings} style={doc.style} spreadCount={doc.spreads.length} index={surface === doc.cover ? COVER_INDEX : shownIndex} surface={surface} scale={scale} assets={assets} grade={doc.grade} thumbSize="m" />
      </div>
    </div>
  );

  return (
    <Modal title="See it in a room" onClose={onClose} wide>
      <div className="mock-controls">
        <div className="seg seg-compact" role="radiogroup" aria-label="Scene">
          {poster && <button role="radio" aria-checked={scene === 'wall'} className={scene === 'wall' ? 'on' : ''} onClick={() => setScene('wall')}>On a wall</button>}
          <button role="radio" aria-checked={scene === 'table'} className={scene === 'table' ? 'on' : ''} onClick={() => setScene('table')}>{poster ? 'Postcard on a table' : 'Print on a table'}</button>
        </div>
        {scene === 'wall' && (
          <>
            <div className="seg seg-compact" role="radiogroup" aria-label="Frame">
              {(['none', 'black', 'white', 'oak'] as const).map((f) => <button key={f} role="radio" aria-checked={frame === f} className={frame === f ? 'on' : ''} onClick={() => setFrame(f)}>{f === 'none' ? 'No frame' : f[0].toUpperCase() + f.slice(1)}</button>)}
            </div>
            <label className="check small"><input type="checkbox" checked={mat} disabled={frame === 'none'} onChange={(e) => setMat(e.target.checked)} /> Mat</label>
            <div className="mock-walls" role="radiogroup" aria-label="Wall colour">
              {['#e9e3d8', '#f4f2ee', '#c9d3c6', '#2f3438', '#d8b9a3'].map((c) => <button key={c} role="radio" aria-checked={wall === c} className={wall === c ? 'on' : ''} style={{ background: c }} onClick={() => setWall(c)} title="Wall colour" />)}
            </div>
          </>
        )}
      </div>

      {scene === 'wall' ? (
        <FitScene>
        <div className="mock-scene" style={{ width: SCENE_W, height: SCENE_H, background: wall }}>
          <WallRoom wall={wall} />
          {/* Centred over the sofa, its bottom edge about 25 cm above the sofa's back. */}
          <div className="mock-hang" style={{ left: SCENE_W / 2, top: SOFA_TOP - 250 * pxPerMm - ((trimH + 2 * (frameMm + matMm)) * pxPerMm) / 2 }}>
            <div className={`mock-frame mock-frame-${frame}`} style={{ padding: (frameMm + matMm) * pxPerMm, '--frame-w': `${frameMm * pxPerMm}px` } as CSSProperties}>
              {art}
            </div>
          </div>
        </div>
        </FitScene>
      ) : (
        <FitScene>
        <div className="mock-scene mock-table" style={{ width: SCENE_W, height: SCENE_H }}>
          <TableTop />
          <div className="mock-postcard" style={{ left: SCENE_W * 0.47, top: SCENE_H * 0.52 }}>
            <div className="mock-print">{art}</div>
          </div>
        </div>
        </FitScene>
      )}
      <p className="muted small">{scene === 'wall' ? `Shown at its real size (${(trimW / 10).toFixed(0)} × ${(trimH / 10).toFixed(0)} cm) above a 2 m sofa.` : 'Shown as a hand-held print. The scene is drawn by the app; nothing leaves your computer.'}</p>
    </Modal>
  );
}

/** Shrinks a fixed-size scene to the width available (never enlarges it). */
function FitScene({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setK(Math.min(1, e.contentRect.width / SCENE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="mock-fit" style={{ height: SCENE_H * k }}>
      <div style={{ width: SCENE_W, transform: `scale(${k})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}

const FLOOR_Y = SCENE_H * 0.86;
/** Top of the sofa's back (an 80 cm sofa). */
const SOFA_TOP = FLOOR_Y - 800 * (SCENE_W / WALL_MM);

/** A plain living room: wall, skirting, wooden floor, a sofa, a plant and a floor lamp. */
function WallRoom({ wall }: { wall: string }) {
  const W = SCENE_W;
  const H = SCENE_H;
  const k = W / WALL_MM;
  const floorY = FLOOR_Y;
  const sofaW = 2000 * k;
  const sofaX = (W - sofaW) / 2;
  const sofaTop = SOFA_TOP;
  const dark = parseInt(wall.slice(1, 3), 16) < 90;
  return (
    <svg className="mock-room" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id="mock-light" x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#ffffff" stopOpacity={dark ? 0.08 : 0.28} />
          <stop offset="1" stopColor="#000000" stopOpacity={dark ? 0.25 : 0.12} />
        </linearGradient>
        <linearGradient id="mock-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a87b54" />
          <stop offset="1" stopColor="#7c5638" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#mock-light)" />
      <rect y={floorY} width={W} height={H - floorY} fill="url(#mock-floor)" />
      {Array.from({ length: 9 }, (_, i) => <line key={i} x1={(i * W) / 8 - 40} y1={floorY} x2={(i * W) / 8 - 140} y2={H} stroke="#5f412a" strokeOpacity="0.35" />)}
      <rect y={floorY - 6} width={W} height={7} fill={dark ? '#1d2124' : '#f7f4ee'} />
      {/* sofa */}
      <ellipse cx={W / 2} cy={floorY + 4} rx={sofaW * 0.52} ry={10} fill="#000" opacity="0.18" />
      <rect x={sofaX} y={sofaTop} width={sofaW} height={floorY - sofaTop - 40 * k} rx={22} fill="#5d6b74" />
      <rect x={sofaX + 18} y={sofaTop + (floorY - sofaTop) * 0.42} width={sofaW - 36} height={(floorY - sofaTop) * 0.36} rx={12} fill="#6c7b85" />
      <rect x={sofaX - 14} y={sofaTop + (floorY - sofaTop) * 0.3} width={40} height={(floorY - sofaTop) * 0.58} rx={14} fill="#55636b" />
      <rect x={sofaX + sofaW - 26} y={sofaTop + (floorY - sofaTop) * 0.3} width={40} height={(floorY - sofaTop) * 0.58} rx={14} fill="#55636b" />
      <rect x={sofaX + 30} y={floorY - 40 * k} width={8} height={40 * k} fill="#3a2a1d" />
      <rect x={sofaX + sofaW - 38} y={floorY - 40 * k} width={8} height={40 * k} fill="#3a2a1d" />
      <rect x={sofaX + sofaW * 0.18} y={sofaTop + 26} width={sofaW * 0.16} height={(floorY - sofaTop) * 0.34} rx={10} fill="#d9c8a7" transform={`rotate(-6 ${sofaX + sofaW * 0.26} ${sofaTop + 50})`} />
      {/* plant */}
      <g transform={`translate(${W * 0.88} ${floorY})`}>
        <path d="M-26 0 L-20 -60 L20 -60 L26 0 Z" fill="#c8b8a2" />
        {[-60, -35, -10, 15, 40].map((a, i) => <ellipse key={i} cx={Math.sin((a * Math.PI) / 180) * 50} cy={-110 - (i % 2) * 20} rx="14" ry="48" fill={i % 2 ? '#3f6b47' : '#4f7f55'} transform={`rotate(${a} ${Math.sin((a * Math.PI) / 180) * 50} ${-110 - (i % 2) * 20})`} />)}
      </g>
      {/* floor lamp */}
      <g transform={`translate(${W * 0.1} ${floorY})`}>
        <rect x="-2" y={-H * 0.52} width="4" height={H * 0.52} fill="#2a2a2a" />
        <ellipse cx="0" cy="0" rx="24" ry="5" fill="#2a2a2a" />
        <path d={`M-30 ${-H * 0.52} L-18 ${-H * 0.62} L18 ${-H * 0.62} L30 ${-H * 0.52} Z`} fill="#efe6d4" />
      </g>
    </svg>
  );
}

/** A wooden tabletop seen from above, with a coffee cup and a pencil. */
function TableTop() {
  const W = SCENE_W;
  const H = SCENE_H;
  return (
    <svg className="mock-room" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id="mock-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8875c" />
          <stop offset="1" stopColor="#8a5f3c" />
        </linearGradient>
        <radialGradient id="mock-glow" cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#mock-wood)" />
      {Array.from({ length: 14 }, (_, i) => <path key={i} d={`M0 ${i * 38 + 10} C ${W * 0.3} ${i * 38 + (i % 3) * 9}, ${W * 0.6} ${i * 38 + 24}, ${W} ${i * 38 + 6}`} stroke="#6e4a2e" strokeOpacity="0.22" strokeWidth={1 + (i % 3)} fill="none" />)}
      <rect width={W} height={H} fill="url(#mock-glow)" />
      <g transform={`translate(${W * 0.85} ${H * 0.2})`}>
        <circle r="52" fill="#000" opacity="0.18" transform="translate(6 8)" />
        <circle r="50" fill="#f3efe7" />
        <circle r="39" fill="#5a3a24" />
        <circle r="39" fill="url(#mock-glow)" />
        <rect x="46" y="-10" width="26" height="20" rx="10" fill="none" stroke="#f3efe7" strokeWidth="8" />
      </g>
      <g transform={`translate(${W * 0.14} ${H * 0.78}) rotate(-28)`}>
        <rect x="0" y="0" width="190" height="9" rx="2" fill="#e8b23b" />
        <path d="M190 0 L210 4.5 L190 9 Z" fill="#e9d2a8" />
        <rect x="-14" y="0" width="14" height="9" rx="2" fill="#d97b7b" />
      </g>
    </svg>
  );
}
