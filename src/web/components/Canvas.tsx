import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  COVER_INDEX, addPhotoAt, cropFromPlacement, elementBounds, elementPlacement, geometryFor, imagePlacement, innerBox,
  pageContentRect, pointInElement, setFramePhoto, surfaceAt, swapFramePhotos, updateElement, type BookDocument,
  type Element, type ImageElement, type SurfaceGeometry, MM_PER_PT,
} from '../../core';
import { thumbUrl } from '../api';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { SpreadView } from './SpreadView';

// The interactive editor surface (a spread or the cover). All pointer input lands on one overlay;
// hit-testing uses the same rotated-rectangle geometry as core, so clicks, drags and drops agree
// with what is drawn. Pointer moves are coalesced to one document update per animation frame.

export const ASSET_MIME = 'application/x-photobook-asset';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Gesture =
  | { kind: 'move'; start: Pt; orig: Element; moved: boolean }
  | { kind: 'resize'; start: Pt; orig: Element; handle: Handle }
  | { kind: 'rotate'; orig: Element }
  | { kind: 'crop'; start: Pt; orig: ImageElement }
  | { kind: 'swap'; orig: ImageElement; at: Pt; client: Pt; target: string | null };

interface Pt {
  x: number;
  y: number;
}

interface GuideLine {
  axis: 'x' | 'y';
  at: number;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function Canvas() {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const assets = useEditor((s) => s.assetMap);
  const selection = useEditor((s) => s.selection);
  const cropId = useEditor((s) => s.cropElementId);
  const swapSource = useEditor((s) => s.swapSource);
  const showGuides = useEditor((s) => s.showGuides);
  const zoom = useEditor((s) => s.zoom);
  const surface = surfaceAt(doc, index);
  const spreadCount = doc.spreads.length;
  const g = useMemo(() => geometryFor(doc.settings, spreadCount, index), [doc.settings, spreadCount, index]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number; shift: boolean; alt: boolean } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [swapDrag, setSwapDrag] = useState<{ client: Pt; target: string | null } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setEditingText(null);
    setHoverId(null);
  }, [index]);

  usePrefetchNeighbours(doc, index);

  // Pinch-to-zoom on a trackpad arrives as ctrl+wheel; handled natively so we can preventDefault.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = useEditor.getState();
      st.setZoom(st.zoom * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  if (!surface) return <NoCover />;

  const b = g.bleed;
  const fit = Math.min((size.w - 120) / (g.width + 2 * b), (size.h - 72) / (g.height + 2 * b));
  const scale = Math.max(0.3, fit * zoom);
  const selected = selection && selection.spreadId === surface.id ? surface.elements.find((e) => e.id === selection.elementId) : undefined;

  const toMm = (clientX: number, clientY: number): Pt => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale - b, y: (clientY - r.top) / scale - b };
  };

  const hitTest = (p: Pt, filter: (e: Element) => boolean = () => true) => {
    for (let i = surface.elements.length - 1; i >= 0; i--) {
      const el = surface.elements[i];
      if (filter(el) && pointInElement(el, p.x, p.y)) return el;
    }
    return undefined;
  };

  const { run, gesture, endGesture, select, setCrop, setSwapSource } = useEditor.getState();
  const capture = (pointerId: number) => {
    try {
      overlayRef.current!.setPointerCapture(pointerId);
    } catch {
      // synthetic or already-released pointers cannot be captured; dragging still works
    }
  };

  // ---- snapping ---------------------------------------------------------------------------
  const snapTargets = (exclude: string) => {
    const xs = [-b, g.width + b, g.width / 2];
    const ys = [-b, 0, g.height / 2, g.height, g.height + b];
    for (const p of g.panels) xs.push(p.x, p.x + p.w, p.x + p.w / 2);
    for (const r of g.safeRects) {
      xs.push(r.x, r.x + r.w);
      ys.push(r.y, r.y + r.h);
    }
    if (g.kind === 'spread') {
      for (const side of ['left', 'right'] as const) {
        const c = pageContentRect(side, doc.settings, doc.style);
        xs.push(c.x, c.x + c.w);
        ys.push(c.y, c.y + c.h);
      }
    }
    for (const el of surface.elements) {
      if (el.id === exclude) continue;
      const r = elementBounds(el);
      xs.push(r.x, r.x + r.w / 2, r.x + r.w);
      ys.push(r.y, r.y + r.h / 2, r.y + r.h);
    }
    return { xs, ys };
  };

  const snapDelta = (values: number[], targets: number[], threshold: number) => {
    let best: { d: number; at: number } | null = null;
    for (const v of values) for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
    return best;
  };

  // ---- pointer handling -------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editingText) return;
    const p = toMm(e.clientX, e.clientY);
    const handle = (e.target as HTMLElement).dataset.handle;

    if (handle && selected && !selected.locked) {
      capture(e.pointerId);
      if (handle === 'swap' && selected.type === 'image') {
        gestureRef.current = { kind: 'swap', orig: selected, at: p, client: { x: e.clientX, y: e.clientY }, target: null };
        setSwapDrag({ client: { x: e.clientX, y: e.clientY }, target: null });
      } else {
        gestureRef.current = handle === 'rotate' ? { kind: 'rotate', orig: selected } : { kind: 'resize', start: p, orig: selected, handle: handle as Handle };
      }
      return;
    }

    if (cropId) {
      const el = surface.elements.find((x) => x.id === cropId) as ImageElement | undefined;
      if (el && pointInElement(el, p.x, p.y)) {
        capture(e.pointerId);
        gestureRef.current = { kind: 'crop', start: p, orig: el };
        return;
      }
      setCrop(null);
    }

    const hit = hitTest(p);
    if (swapSource && hit?.type === 'image') {
      run('Swap photos', (d) => swapFramePhotos(d, swapSource, { spreadId: surface.id, elementId: hit.id }, assets));
      setSwapSource(null);
      select({ spreadId: surface.id, elementId: hit.id });
      return;
    }
    if (swapSource) setSwapSource(null);
    if (!hit) {
      select(null);
      return;
    }
    select({ spreadId: surface.id, elementId: hit.id });
    if (!hit.locked) {
      capture(e.pointerId);
      gestureRef.current = { kind: 'move', start: p, orig: hit, moved: false };
    }
  };

  /** Apply the latest pointer position; called at most once per animation frame. */
  const applyMove = (clientX: number, clientY: number, shiftKey: boolean, altKey: boolean) => {
    const gst = gestureRef.current;
    if (!gst) return;
    const p = toMm(clientX, clientY);
    const id = gst.orig.id;
    const sid = surface.id;

    if (gst.kind === 'swap') {
      const target = hitTest(p, (el) => el.type === 'image' && el.id !== id && !el.locked);
      gst.target = target?.id ?? null;
      setSwapDrag({ client: { x: clientX, y: clientY }, target: gst.target });
      return;
    }
    if (gst.kind === 'move') {
      let dx = p.x - gst.start.x;
      let dy = p.y - gst.start.y;
      if (!gst.moved && Math.hypot(dx, dy) * scale < 3) return;
      gst.moved = true;
      if (shiftKey) (Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0));
      const lines: GuideLine[] = [];
      if (!altKey) {
        const r = elementBounds({ ...gst.orig, xMm: gst.orig.xMm + dx, yMm: gst.orig.yMm + dy });
        const t = snapTargets(id);
        const threshold = 6 / scale;
        const sx = snapDelta([r.x, r.x + r.w / 2, r.x + r.w], t.xs, threshold);
        const sy = snapDelta([r.y, r.y + r.h / 2, r.y + r.h], t.ys, threshold);
        if (sx) {
          dx += sx.d;
          lines.push({ axis: 'x', at: sx.at });
        }
        if (sy) {
          dy += sy.d;
          lines.push({ axis: 'y', at: sy.at });
        }
      }
      setGuides((prev) => (sameGuides(prev, lines) ? prev : lines));
      gesture((d) => updateElement(d, sid, id, { xMm: gst.orig.xMm + dx, yMm: gst.orig.yMm + dy }));
    } else if (gst.kind === 'resize') {
      const o = gst.orig;
      const rad = (o.rotationDeg * Math.PI) / 180;
      const dxw = p.x - gst.start.x;
      const dyw = p.y - gst.start.y;
      // Pointer delta in the element's own (rotated) frame.
      const lx = dxw * Math.cos(rad) + dyw * Math.sin(rad);
      const ly = -dxw * Math.sin(rad) + dyw * Math.cos(rad);
      let w = o.widthMm;
      let h = o.heightMm;
      if (gst.handle.includes('e')) w = o.widthMm + lx;
      if (gst.handle.includes('w')) w = o.widthMm - lx;
      if (gst.handle.includes('s')) h = o.heightMm + ly;
      if (gst.handle.includes('n')) h = o.heightMm - ly;
      if (shiftKey && gst.handle.length === 2) {
        const k = Math.max(w / o.widthMm, h / o.heightMm);
        w = o.widthMm * k;
        h = o.heightMm * k;
      }
      w = Math.max(5, w);
      h = Math.max(5, h);
      let ox = 0;
      let oy = 0;
      if (gst.handle.includes('e')) ox = (w - o.widthMm) / 2;
      if (gst.handle.includes('w')) ox = -(w - o.widthMm) / 2;
      if (gst.handle.includes('s')) oy = (h - o.heightMm) / 2;
      if (gst.handle.includes('n')) oy = -(h - o.heightMm) / 2;
      const cx = o.xMm + o.widthMm / 2 + ox * Math.cos(rad) - oy * Math.sin(rad);
      const cy = o.yMm + o.heightMm / 2 + ox * Math.sin(rad) + oy * Math.cos(rad);
      gesture((d) => updateElement(d, sid, id, { xMm: cx - w / 2, yMm: cy - h / 2, widthMm: w, heightMm: h }));
    } else if (gst.kind === 'rotate') {
      const o = gst.orig;
      const cx = o.xMm + o.widthMm / 2;
      const cy = o.yMm + o.heightMm / 2;
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(deg) < 2) deg = 0;
      gesture((d) => updateElement(d, sid, id, { rotationDeg: Math.round(deg * 10) / 10 }));
    } else if (gst.kind === 'crop') {
      const o = gst.orig;
      const asset = o.assetId ? assets.get(o.assetId) : undefined;
      if (!asset) return;
      const rad = (o.rotationDeg * Math.PI) / 180;
      const dxw = p.x - gst.start.x;
      const dyw = p.y - gst.start.y;
      const lx = dxw * Math.cos(rad) + dyw * Math.sin(rad);
      const ly = -dxw * Math.sin(rad) + dyw * Math.cos(rad);
      const box = innerBox(o);
      const img = { w: asset.widthPx, h: asset.heightPx };
      const start = imagePlacement(box, img, o.crop, o.fit);
      const moved = imagePlacement(box, img, { ...o.crop, cx: (box.w / 2 - (start.x + lx)) / start.w, cy: (box.h / 2 - (start.y + ly)) / start.h }, o.fit);
      gesture((d) => updateElement(d, sid, id, { crop: cropFromPlacement(box, moved, o.crop.zoom) }));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!gestureRef.current) {
      // Hover feedback: outline what a click would grab.
      if (e.buttons === 0 && !editingText) {
        const hit = hitTest(toMm(e.clientX, e.clientY));
        const id = hit?.id ?? null;
        if (id !== hoverId) setHoverId(id);
      }
      return;
    }
    pendingRef.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey };
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const pm = pendingRef.current;
        if (pm) applyMove(pm.x, pm.y, pm.shift, pm.alt);
      });
    }
  };

  const onPointerUp = () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      const pm = pendingRef.current;
      if (pm) applyMove(pm.x, pm.y, pm.shift, pm.alt);
    }
    pendingRef.current = null;
    const gst = gestureRef.current;
    gestureRef.current = null;
    setGuides([]);
    if (!gst) return;
    if (gst.kind === 'swap') {
      setSwapDrag(null);
      if (gst.target) {
        run('Swap photos', (d) => swapFramePhotos(d, { spreadId: surface.id, elementId: gst.orig.id }, { spreadId: surface.id, elementId: gst.target! }, assets));
        select({ spreadId: surface.id, elementId: gst.target });
      }
      return;
    }
    const labels = { move: 'Move', resize: 'Resize', rotate: 'Rotate', crop: 'Adjust crop' } as const;
    endGesture(`${labels[gst.kind]} ${gst.orig.type === 'image' ? 'photo' : gst.orig.type === 'text' ? 'text' : 'shape'}`);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = hitTest(toMm(e.clientX, e.clientY));
    if (!hit || hit.locked) return;
    select({ spreadId: surface.id, elementId: hit.id });
    if (hit.type === 'image' && hit.assetId) setCrop(hit.id);
    if (hit.type === 'text') setEditingText(hit.id);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!cropId || e.ctrlKey || e.metaKey) return;
    const el = surface.elements.find((x) => x.id === cropId) as ImageElement | undefined;
    if (!el) return;
    const zoomNext = Math.max(1, Math.min(5, el.crop.zoom * Math.exp(-e.deltaY * 0.0015)));
    // Consecutive wheel ticks merge into one undo step.
    gesture((d) => updateElement(d, surface.id, el.id, { crop: { ...el.crop, zoom: Math.round(zoomNext * 1000) / 1000 } }));
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => endGesture('Zoom photo'), 300);
  };
  // ---- drag & drop from the library -------------------------------------------------------
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const hit = hitTest(toMm(e.clientX, e.clientY), (el) => el.type === 'image' && !el.locked);
    const id = hit?.id ?? null;
    if (id !== dropTarget) setDropTarget(id);
  };

  const onDrop = (e: React.DragEvent) => {
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    setDropTarget(null);
    if (!assetId) return;
    e.preventDefault();
    const asset = assets.get(assetId);
    if (!asset) return;
    const p = toMm(e.clientX, e.clientY);
    const hit = hitTest(p, (el) => el.type === 'image' && !el.locked);
    if (surface.locked) return useEditor.getState().toast('error', `This ${index === COVER_INDEX ? 'cover' : 'spread'} is locked. Unlock it to change photos.`);
    if (hit) {
      run(hit.type === 'image' && hit.assetId ? 'Replace photo' : 'Place photo', (d) => setFramePhoto(d, surface.id, hit.id, asset));
      select({ spreadId: surface.id, elementId: hit.id });
    } else {
      let newId = '';
      run('Add photo', (d) => {
        const r = addPhotoAt(d, surface.id, asset, p.x, p.y);
        newId = r.newId;
        return r.doc;
      });
      if (newId) select({ spreadId: surface.id, elementId: newId });
    }
  };

  const cropEl = cropId ? (surface.elements.find((x) => x.id === cropId) as ImageElement | undefined) : undefined;
  const cropAsset = cropEl?.assetId ? assets.get(cropEl.assetId) : undefined;
  const hovered = hoverId && hoverId !== selected?.id ? surface.elements.find((x) => x.id === hoverId) : undefined;
  const swapTarget = swapDrag?.target ? surface.elements.find((x) => x.id === swapDrag.target) : undefined;
  const totalW = (g.width + 2 * b) * scale;
  const cursor = hovered && !hovered.locked ? 'move' : undefined;
  const isPosterDoc = doc.settings.product === 'poster';
  const canPrev = !isPosterDoc && index > COVER_INDEX;
  const canNext = index < doc.spreads.length - 1;

  return (
    <div className="canvas" ref={wrapRef}>
      <div className="canvas-inner" style={{ minWidth: totalW + 120, minHeight: (g.height + 2 * b) * scale + 72 }}>
        {!isPosterDoc && (
          <button className="nav-arrow" disabled={!canPrev} onClick={() => useEditor.getState().goToSpread(index - 1)} title="Previous (←)">
            <Icon name="left" size={20} />
          </button>
        )}
        <div className="canvas-spread">
          <SpreadView settings={doc.settings} style={doc.style} spreadCount={spreadCount} index={index} surface={surface} scale={scale} assets={assets} hiddenElementId={editingText}>
            {showGuides && <Guides g={g} scale={scale} />}
            {cropEl && cropAsset && <CropGhost el={cropEl} scale={scale} offset={b} assetId={cropAsset.id} asset={cropAsset} />}
            {guides.map((gl, i) =>
              gl.axis === 'x' ? <div key={i} className="snap-line snap-x" style={{ left: (gl.at + b) * scale }} /> : <div key={i} className="snap-line snap-y" style={{ top: (gl.at + b) * scale }} />,
            )}
            {hovered && !gestureRef.current && <Outline el={hovered} scale={scale} offset={b} className="hover-outline" />}
            {dropTarget && <Outline el={surface.elements.find((x) => x.id === dropTarget)!} scale={scale} offset={b} className="drop-outline" />}
            {swapTarget && <Outline el={swapTarget} scale={scale} offset={b} className="drop-outline" />}
            {selected && !editingText && <SelectionBox el={selected} scale={scale} offset={b} cropping={cropId === selected.id} />}
            {surface.locked && <div className="lock-veil" title="Locked: regeneration and layout changes leave it untouched" />}
            {editingText && <TextEditor surface={surface} elementId={editingText} scale={scale} offset={b} onDone={() => setEditingText(null)} />}
            <div
              ref={overlayRef}
              className={`overlay ${swapSource ? 'overlay-swap' : ''} ${cropId ? 'overlay-crop' : ''}`}
              style={{ pointerEvents: editingText ? 'none' : undefined, cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => !gestureRef.current && setHoverId(null)}
              onPointerCancel={() => {
                gestureRef.current = null;
                setSwapDrag(null);
                useEditor.getState().cancelGesture();
              }}
              onDoubleClick={onDoubleClick}
              onWheel={onWheel}
              onDragOver={onDragOver}
              onDragLeave={() => setDropTarget(null)}
              onDrop={onDrop}
            >
              {selected && !selected.locked && !editingText && !cropId && <HandleLayer el={selected} scale={scale} offset={b} />}
            </div>
          </SpreadView>
          <div className="page-labels" style={{ width: totalW }}>
            {g.panels.map((p) => (
              <span key={p.id} style={{ left: (p.x + p.w / 2 + b) * scale }}>{p.label}</span>
            ))}
          </div>
        </div>
        {!isPosterDoc && (
          <button className="nav-arrow" disabled={!canNext} onClick={() => useEditor.getState().goToSpread(index + 1)} title="Next (→)">
            <Icon name="right" size={20} />
          </button>
        )}
      </div>
      {swapDrag && (
        <div className="swap-ghost" style={{ left: swapDrag.client.x, top: swapDrag.client.y }}>
          {selected?.type === 'image' && selected.assetId && <img src={thumbUrl(selected.assetId)} alt="" />}
        </div>
      )}
      {swapSource && <div className="canvas-hint">Click another photo to swap with — on any spread. Esc to cancel.</div>}
      {cropId && <div className="canvas-hint">Drag to reposition · scroll to zoom · Esc or click outside when done</div>}
    </div>
  );
}

function sameGuides(a: GuideLine[], b: GuideLine[]) {
  return a.length === b.length && a.every((x, i) => x.axis === b[i].axis && Math.abs(x.at - b[i].at) < 1e-6);
}

/** Warm the image cache for the spreads either side, so paging through the book is instant. */
function usePrefetchNeighbours(doc: BookDocument, index: number) {
  useEffect(() => {
    const ids = new Set<string>();
    for (const i of [index - 1, index + 1]) {
      const s = surfaceAt(doc, i);
      s?.elements.forEach((e) => e.type === 'image' && e.assetId && ids.add(e.assetId));
    }
    const t = setTimeout(() => ids.forEach((id) => (new Image().src = thumbUrl(id, 'm'))), 200);
    return () => clearTimeout(t);
    // only when the page changes, not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, doc.spreads.length]);
}

function NoCover() {
  return (
    <div className="canvas">
      <div className="canvas-inner">
        <div className="stage-empty static">
          <h3>No cover yet</h3>
          <p className="muted">Choose a cover layout in the panel on the right. It uses your book’s best photos and title, and you can change everything afterwards.</p>
        </div>
      </div>
    </div>
  );
}

function frameStyle(el: Element, scale: number, offset: number): CSSProperties {
  return {
    left: (el.xMm + offset) * scale,
    top: (el.yMm + offset) * scale,
    width: el.widthMm * scale,
    height: el.heightMm * scale,
    transform: el.rotationDeg ? `rotate(${el.rotationDeg}deg)` : undefined,
  };
}

function Outline({ el, scale, offset, className }: { el: Element; scale: number; offset: number; className: string }) {
  if (!el) return null;
  return <div className={className} style={frameStyle(el, scale, offset)} />;
}

function SelectionBox({ el, scale, offset, cropping }: { el: Element; scale: number; offset: number; cropping: boolean }) {
  return <div className={`selection ${el.locked ? 'selection-locked' : ''} ${cropping ? 'selection-crop' : ''}`} style={frameStyle(el, scale, offset)} />;
}

function HandleLayer({ el, scale, offset }: { el: Element; scale: number; offset: number }) {
  const big = el.widthMm * scale > 70 && el.heightMm * scale > 50;
  return (
    <div className="handles" style={frameStyle(el, scale, offset)}>
      {HANDLES.map((h) => (
        <div key={h} className={`handle handle-${h}`} data-handle={h} />
      ))}
      <div className="handle handle-rotate" data-handle="rotate" title="Rotate (Shift: 15° steps)" />
      {el.type === 'image' && el.assetId && big && (
        <div className="handle-swap" data-handle="swap" title="Drag onto another photo to swap them">
          <Icon name="swap" size={14} />
        </div>
      )}
    </div>
  );
}

/** While cropping, show the whole photo faintly beyond the frame so you can see what is cut. */
function CropGhost({ el, scale, offset, assetId, asset }: { el: ImageElement; scale: number; offset: number; assetId: string; asset: { widthPx: number; heightPx: number } }) {
  const { box, placement } = elementPlacement(el, asset);
  return (
    <div className="crop-ghost" style={frameStyle(el, scale, offset)}>
      <img
        src={thumbUrl(assetId, 'm')}
        alt=""
        draggable={false}
        style={{ left: (box.x + placement.x) * scale, top: (box.y + placement.y) * scale, width: placement.w * scale, height: placement.h * scale }}
      />
    </div>
  );
}

function Guides({ g, scale }: { g: SurfaceGeometry; scale: number }) {
  const b = g.bleed;
  const px = (mm: number) => (mm + b) * scale;
  return (
    <div className="guides">
      {/* Everything outside the trim is cut off (or wrapped around the boards): dim it. */}
      <div className="guide-bleed" style={{ left: 0, top: 0, right: 0, height: b * scale }} />
      <div className="guide-bleed" style={{ left: 0, bottom: 0, right: 0, height: b * scale }} />
      <div className="guide-bleed" style={{ left: 0, top: b * scale, width: b * scale, bottom: b * scale }} />
      <div className="guide-bleed" style={{ right: 0, top: b * scale, width: b * scale, bottom: b * scale }} />
      <div className="guide-trim" style={{ left: px(0), top: px(0), width: g.width * scale, height: g.height * scale }} />
      {g.foldZone && <div className="guide-binding" style={{ left: px(g.foldZone.x), top: px(0), width: g.foldZone.w * scale, height: g.height * scale }} />}
      {g.folds.map((f) => (
        <div key={f} className="guide-spine" style={{ left: px(f), top: px(0), height: g.height * scale }} />
      ))}
      {g.safeRects.map((r, i) => (
        <div key={i} className="guide-safe" style={{ left: px(r.x), top: px(r.y), width: r.w * scale, height: r.h * scale }} />
      ))}
    </div>
  );
}

function TextEditor({ surface, elementId, scale, offset, onDone }: { surface: { id: string; elements: Element[] }; elementId: string; scale: number; offset: number; onDone: () => void }) {
  const el = surface.elements.find((e) => e.id === elementId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(el?.type === 'text' ? el.text : '');
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  if (!el || el.type !== 'text') return null;
  const commit = () => {
    if (value !== el.text) useEditor.getState().run('Edit text', (d) => updateElement(d, surface.id, elementId, { text: value }));
    onDone();
  };
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
      }}
      style={{
        ...frameStyle(el, scale, offset),
        minHeight: el.heightMm * scale,
        fontFamily: `'${el.fontFamily}'`,
        fontWeight: el.fontWeight,
        fontSize: el.fontSizePt * MM_PER_PT * scale,
        lineHeight: el.lineHeight,
        letterSpacing: el.letterSpacingEm ? `${el.letterSpacingEm}em` : undefined,
        textTransform: el.uppercase ? 'uppercase' : undefined,
        textAlign: el.align,
        color: el.color,
      }}
    />
  );
}
