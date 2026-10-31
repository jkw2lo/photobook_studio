import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  COVER_INDEX, addPhotoAt, defaultCrop, effectiveDpi, elementBounds, elementPlacement, geometryFor, innerBox, panCrop, toInnerBox, zoomCropAt,
  elementsInRect, expandGroups, sizeSnap, spacingSnap, type SpacingMark, pageContentRect, pointInElement, setFramePhoto, unionBounds, surfaceAt, swapFramePhotos, updateElement, type BookDocument,
  type Element, type ImageElement, type PhotoAsset, type SurfaceGeometry, MM_PER_PT,
  backgroundArea, backgroundBox, imagePlacement, moveBackground, reframeCrop, scaleBackground, updateBackgroundImage, type BackgroundImage, type CropHandle, type Rect,
} from '../../core';
import { thumbUrl } from '../api';
import { setPhotoArea } from '../elementActions';
import { selectedIds, useEditor, type CanvasTool } from '../store';
import { ContextMenu, type MenuTarget } from './ContextMenu';
import { Icon } from './Icon';
import { SpreadView, textCss } from './SpreadView';

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
  /** Drag a corner of the whole photo: scale it about the opposite corner (inner-box mm). */
  | { kind: 'cropzoom'; anchor: Pt; startDist: number; orig: ImageElement }
  /** Drag an edge or corner of the crop box: the frame changes, the photo stays put. */
  | { kind: 'cropbox'; start: Pt; orig: ImageElement; handle: CropHandle }
  | { kind: 'bgmove'; start: Pt; orig: BackgroundImage }
  | { kind: 'bgscale'; anchor: Pt; startDist: number; orig: BackgroundImage }
  | { kind: 'area'; start: Pt; orig: Rect; handle: Handle | 'move' | 'draw'; before: Rect | null }
  | { kind: 'swap'; orig: ImageElement; at: Pt; client: Pt; target: string | null }
  | { kind: 'multimove'; start: Pt; origs: Element[]; moved: boolean; clickedId: string; wasSelected: boolean }
  | { kind: 'marquee'; start: Pt; additive: boolean; base: string[] };

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
  const canvasTool = useEditor((s) => s.canvasTool);
  /** Width ÷ height the crop box keeps (null = free). */
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  useEffect(() => setCropRatio(null), [cropId]);
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
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Equal-gap markers and size matches shown while dragging. */
  const [marks, setMarks] = useState<SpacingMark[]>([]);
  const [sizeMatch, setSizeMatch] = useState<{ w: { x: number; y: number; w: number; h: number } | null; h: { x: number; y: number; w: number; h: number } | null }>({ w: null, h: null });
  const multi = useEditor((s) => s.multi);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last pointer position in mm during a gesture (where a selection box ends). */
  const pendingEnd = useRef<Pt | null>(null);

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
    setMenu(null);
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
      // While cropping, a pinch zooms the photo (handled on the overlay), not the canvas.
      if (st.cropElementId) return;
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
  const tool = canvasTool && canvasTool.surfaceId === surface.id ? canvasTool : null;
  const bg = surface.backgroundImage;
  const bgAsset = bg ? assets.get(bg.assetId) : undefined;
  const W = g.width;
  const H = g.height;
  /** The tool's photo area in mm (from fractions of the sheet). */
  const areaMm = (r: Rect): Rect => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });

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
  const snapTargets = (exclude: string | Set<string>) => {
    const skip = typeof exclude === 'string' ? new Set([exclude]) : exclude;
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
      if (skip.has(el.id)) continue;
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

  /** Equal-spacing snap on the axes that had no edge snap; shows the matching gaps. */
  const spacing = (r: { x: number; y: number; w: number; h: number }, exclude: Set<string>, threshold: number, onX: boolean, onY: boolean) => {
    const others = surface.elements.filter((x) => !exclude.has(x.id)).map(elementBounds);
    const sp = spacingSnap(r, others, threshold);
    const marks: SpacingMark[] = [];
    let dx = 0;
    let dy = 0;
    if (onX && sp.x) {
      dx = sp.x.d;
      marks.push(...sp.x.marks);
    }
    if (onY && sp.y) {
      dy = sp.y.d;
      marks.push(...sp.y.marks);
    }
    setMarks((prev) => (prev.length === 0 && marks.length === 0 ? prev : marks));
    return { dx, dy };
  };

  // ---- pointer handling -------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editingText) return;
    const p = toMm(e.clientX, e.clientY);
    const handle = (e.target as HTMLElement).dataset.handle;

    // Moving the background photo: drag anywhere moves it, a corner resizes it.
    if (tool?.kind === 'background') {
      if (!bg || !bgAsset) return;
      capture(e.pointerId);
      if (handle?.startsWith('bg-')) {
        const r = bgExtents(bg, g, bgAsset);
        const c = handle.slice(3);
        const anchor = { x: c.includes('w') ? r.x + r.w : r.x, y: c.includes('n') ? r.y + r.h : r.y };
        gestureRef.current = { kind: 'bgscale', anchor, startDist: Math.max(1, Math.hypot(p.x - anchor.x, p.y - anchor.y)), orig: bg };
      } else gestureRef.current = { kind: 'bgmove', start: p, orig: bg };
      return;
    }
    // Marking the photo area: drag its edges, move it, or draw a new one.
    if (tool?.kind === 'area') {
      capture(e.pointerId);
      const r = tool.rect ? areaMm(tool.rect) : null;
      const before = tool.rect;
      if (handle?.startsWith('area-') && r) gestureRef.current = { kind: 'area', start: p, orig: r, handle: handle.slice(5) as Handle, before };
      else if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) gestureRef.current = { kind: 'area', start: p, orig: r, handle: 'move', before };
      else gestureRef.current = { kind: 'area', start: p, orig: { x: p.x, y: p.y, w: 0, h: 0 }, handle: 'draw', before };
      return;
    }

    if (cropId) {
      const el = surface.elements.find((x) => x.id === cropId) as ImageElement | undefined;
      const asset = el?.assetId ? assets.get(el.assetId) : undefined;
      if (el && asset) {
        if (handle?.startsWith('cropbox-')) {
          capture(e.pointerId);
          gestureRef.current = { kind: 'cropbox', start: p, orig: el, handle: handle.slice(8) as CropHandle };
          return;
        }
        const { placement } = elementPlacement(el, asset);
        if (handle?.startsWith('cropzoom-')) {
          capture(e.pointerId);
          const c = handle.slice(9);
          const anchor = { x: c.includes('w') ? placement.x + placement.w : placement.x, y: c.includes('n') ? placement.y + placement.h : placement.y };
          const at = toInnerBox(el, p.x, p.y);
          gestureRef.current = { kind: 'cropzoom', anchor, startDist: Math.max(1, Math.hypot(at.x - anchor.x, at.y - anchor.y)), orig: el };
          return;
        }
        // Drag anywhere on the photo — inside the frame or on the faint part outside it — to move it.
        const at = toInnerBox(el, p.x, p.y);
        const onPhoto = at.x >= placement.x && at.x <= placement.x + placement.w && at.y >= placement.y && at.y <= placement.y + placement.h;
        if (onPhoto || pointInElement(el, p.x, p.y)) {
          capture(e.pointerId);
          gestureRef.current = { kind: 'crop', start: p, orig: el };
          return;
        }
      }
      // Clicking away keeps the crop.
      setCrop(null);
    }

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

    const hit = hitTest(p);
    if (swapSource && hit?.type === 'image') {
      run('Swap photos', (d) => swapFramePhotos(d, swapSource, { spreadId: surface.id, elementId: hit.id }, assets));
      setSwapSource(null);
      select({ spreadId: surface.id, elementId: hit.id });
      return;
    }
    if (swapSource) setSwapSource(null);
    const current = selection?.spreadId === surface.id ? selectedIds(useEditor.getState()) : [];
    if (!hit) {
      // Empty space: drag a box to select several items (Shift adds to the selection).
      capture(e.pointerId);
      gestureRef.current = { kind: 'marquee', start: p, additive: e.shiftKey, base: e.shiftKey ? current : [] };
      if (!e.shiftKey) select(null);
      return;
    }
    if (e.shiftKey) {
      useEditor.getState().toggleInSelection(surface.id, hit.id);
      return;
    }
    const wasSelected = current.includes(hit.id);
    const ids = wasSelected ? current : expandGroups(surface.elements, [hit.id]);
    if (!wasSelected) select({ spreadId: surface.id, elementId: hit.id });
    if (ids.length > 1) {
      // Several items (or a group): drag moves them all; a click without dragging on an already
      // selected group picks just that one item.
      capture(e.pointerId);
      gestureRef.current = { kind: 'multimove', start: p, origs: surface.elements.filter((el) => ids.includes(el.id)), moved: false, clickedId: hit.id, wasSelected };
      return;
    }
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
    const sid = surface.id;
    if (gst.kind === 'marquee') {
      setMarquee({ x: Math.min(gst.start.x, p.x), y: Math.min(gst.start.y, p.y), w: Math.abs(p.x - gst.start.x), h: Math.abs(p.y - gst.start.y) });
      return;
    }
    if (gst.kind === 'bgmove' || gst.kind === 'bgscale') {
      if (!bgAsset) return;
      const patch = gst.kind === 'bgmove'
        ? moveBackground(gst.orig, g, bgAsset, p.x - gst.start.x, p.y - gst.start.y)
        : scaleBackground(gst.orig, g, bgAsset, Math.hypot(p.x - gst.anchor.x, p.y - gst.anchor.y) / gst.startDist, gst.anchor);
      gesture((d) => updateBackgroundImage(d, sid, patch));
      return;
    }
    if (gst.kind === 'area') {
      const t = useEditor.getState().canvasTool;
      if (t?.kind !== 'area') return;
      const o = gst.orig;
      const dx = p.x - gst.start.x;
      const dy = p.y - gst.start.y;
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.w;
      let y1 = o.y + o.h;
      if (gst.handle === 'draw') [x0, y0, x1, y1] = [Math.min(gst.start.x, p.x), Math.min(gst.start.y, p.y), Math.max(gst.start.x, p.x), Math.max(gst.start.y, p.y)];
      else if (gst.handle === 'move') {
        const mx = Math.max(-x0, Math.min(W - x1, dx));
        const my = Math.max(-y0, Math.min(H - y1, dy));
        [x0, x1, y0, y1] = [x0 + mx, x1 + mx, y0 + my, y1 + my];
      } else {
        if (gst.handle.includes('w')) x0 = Math.min(x1 - 10, x0 + dx);
        if (gst.handle.includes('e')) x1 = Math.max(x0 + 10, x1 + dx);
        if (gst.handle.includes('n')) y0 = Math.min(y1 - 10, y0 + dy);
        if (gst.handle.includes('s')) y1 = Math.max(y0 + 10, y1 + dy);
      }
      // Stay on the sheet; edges close to the sheet's edge snap to it (photos then run into the bleed).
      const snap = altKey ? 0 : 8 / scale;
      const edge = (v: number, max: number) => (v < snap ? 0 : v > max - snap ? max : Math.max(0, Math.min(max, v)));
      [x0, x1, y0, y1] = [edge(x0, W), edge(x1, W), edge(y0, H), edge(y1, H)];
      useEditor.setState({ canvasTool: { ...t, rect: { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H } } });
      return;
    }
    if (gst.kind === 'multimove') {
      let dx = p.x - gst.start.x;
      let dy = p.y - gst.start.y;
      if (!gst.moved && Math.hypot(dx, dy) * scale < 3) return;
      gst.moved = true;
      if (shiftKey) (Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0));
      const movable = gst.origs.filter((o) => !o.locked);
      const lines: GuideLine[] = [];
      if (!altKey && movable.length) {
        // Snap the selection's outer box, like a single element.
        const r = unionBounds(movable.map((o) => ({ ...o, xMm: o.xMm + dx, yMm: o.yMm + dy })));
        const t = snapTargets(new Set(gst.origs.map((o) => o.id)));
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
        const sp = spacing(unionBounds(movable.map((o) => ({ ...o, xMm: o.xMm + dx, yMm: o.yMm + dy }))), new Set(gst.origs.map((o) => o.id)), threshold, !sx, !sy);
        dx += sp.dx;
        dy += sp.dy;
      }
      setGuides((prev) => (sameGuides(prev, lines) ? prev : lines));
      gesture((d) => movable.reduce((acc, o) => updateElement(acc, sid, o.id, { xMm: o.xMm + dx, yMm: o.yMm + dy }), d));
      return;
    }
    const id = gst.orig.id;

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
        // No edge to snap to on an axis: try equal spacing with the neighbours.
        const sp = spacing(elementBounds({ ...gst.orig, xMm: gst.orig.xMm + dx, yMm: gst.orig.yMm + dy }), new Set([id]), threshold, !sx, !sy);
        dx += sp.dx;
        dy += sp.dy;
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
      // Match another item's width or height (Alt turns snapping off).
      setMarks([]);
      if (!altKey && !(shiftKey && gst.handle.length === 2)) {
        const others = surface.elements.filter((x) => x.id !== o.id).map(elementBounds);
        const m = sizeSnap(w, h, others, 5 / scale);
        if (gst.handle.includes('e') || gst.handle.includes('w')) w = m.w;
        if (gst.handle.includes('n') || gst.handle.includes('s')) h = m.h;
        setSizeMatch({ w: m.matchW && (gst.handle.includes('e') || gst.handle.includes('w')) ? m.matchW : null, h: m.matchH && (gst.handle.includes('n') || gst.handle.includes('s')) ? m.matchH : null });
      }
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
      const a = toInnerBox(o, gst.start.x, gst.start.y);
      const b2 = toInnerBox(o, p.x, p.y);
      const crop = panCrop(innerBox(o), { w: asset.widthPx, h: asset.heightPx }, o.crop, o.fit, b2.x - a.x, b2.y - a.y);
      gesture((d) => updateElement(d, sid, id, { crop }));
    } else if (gst.kind === 'cropzoom') {
      // Dragging a corner of the whole photo scales it about the opposite corner.
      const o = gst.orig;
      const asset = o.assetId ? assets.get(o.assetId) : undefined;
      if (!asset) return;
      const at = toInnerBox(o, p.x, p.y);
      const factor = Math.hypot(at.x - gst.anchor.x, at.y - gst.anchor.y) / gst.startDist;
      const crop = zoomCropAt(innerBox(o), { w: asset.widthPx, h: asset.heightPx }, o.crop, o.fit, factor, gst.anchor);
      gesture((d) => updateElement(d, sid, id, { crop }));
    } else if (gst.kind === 'cropbox') {
      const o = gst.orig;
      const asset = o.assetId ? assets.get(o.assetId) : undefined;
      if (!asset) return;
      // Pointer movement in the frame's own (rotated) axes.
      const rad = (o.rotationDeg * Math.PI) / 180;
      const dxw = p.x - gst.start.x;
      const dyw = p.y - gst.start.y;
      const lx = dxw * Math.cos(rad) + dyw * Math.sin(rad);
      const ly = -dxw * Math.sin(rad) + dyw * Math.cos(rad);
      const ratio = cropRatio ?? (shiftKey ? o.widthMm / o.heightMm : null);
      const patch = reframeCrop(o, { w: asset.widthPx, h: asset.heightPx }, gst.handle, lx, ly, ratio);
      gesture((d) => updateElement(d, sid, id, patch));
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
    pendingEnd.current = toMm(e.clientX, e.clientY);
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
    setMarks([]);
    setSizeMatch({ w: null, h: null });
    if (!gst) return;
    if (gst.kind === 'marquee') {
      const r = marqueeRef(gst, pendingEnd.current);
      setMarquee(null);
      if (r && (r.w * scale > 3 || r.h * scale > 3)) {
        const ids = elementsInRect(surface.elements, r);
        useEditor.getState().selectMany(surface.id, [...new Set([...gst.base, ...ids])]);
      }
      return;
    }
    if (gst.kind === 'multimove') {
      if (gst.moved) endGesture(`Move ${gst.origs.length} items`);
      else if (gst.wasSelected) select({ spreadId: surface.id, elementId: gst.clickedId }, { only: true });
      return;
    }
    if (gst.kind === 'swap') {
      setSwapDrag(null);
      if (gst.target) {
        run('Swap photos', (d) => swapFramePhotos(d, { spreadId: surface.id, elementId: gst.orig.id }, { spreadId: surface.id, elementId: gst.target! }, assets));
        select({ spreadId: surface.id, elementId: gst.target });
      }
      return;
    }
    if (gst.kind === 'bgmove' || gst.kind === 'bgscale') return endGesture(gst.kind === 'bgmove' ? 'Move background' : 'Resize background');
    if (gst.kind === 'area') {
      // A click without a drag (or a tiny box) keeps the area as it was.
      const t = useEditor.getState().canvasTool;
      if (t?.kind === 'area' && gst.handle === 'draw' && (!t.rect || t.rect.w * W < 10 || t.rect.h * H < 10)) useEditor.setState({ canvasTool: { ...t, rect: gst.before } });
      return;
    }
    if (gst.kind === 'cropbox') return endGesture('Crop photo');
    const labels = { move: 'Move', resize: 'Resize', rotate: 'Rotate', crop: 'Adjust crop', cropzoom: 'Zoom photo' } as const;
    endGesture(`${labels[gst.kind]} ${gst.orig.type === 'image' ? 'photo' : gst.orig.type === 'text' ? 'text' : 'shape'}`);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool) return;
    const hit = hitTest(toMm(e.clientX, e.clientY));
    // Double-click the background photo (where nothing else is) to move or resize it.
    if (!hit && bg && bgAsset && !surface.locked) return useEditor.getState().setCanvasTool({ kind: 'background', surfaceId: surface.id });
    if (!hit || hit.locked) return;
    select({ spreadId: surface.id, elementId: hit.id });
    // Double-click a photo to crop it; double-click again to finish.
    if (hit.type === 'image' && hit.assetId) setCrop(cropId === hit.id ? null : hit.id);
    if (hit.type === 'text') setEditingText(hit.id);
  };

  /** Right-click: select what's under the pointer and show its actions. */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = hitTest(toMm(e.clientX, e.clientY));
    if (!hit) return setMenu(null);
    if (cropId && cropId !== hit.id) setCrop(null);
    if (swapSource) setSwapSource(null);
    const sel = { spreadId: surface.id, elementId: hit.id };
    // Right-clicking inside a multiple selection keeps it (the menu then acts on all of it).
    const current = selection?.spreadId === surface.id ? selectedIds(useEditor.getState()) : [];
    if (!current.includes(hit.id)) select(sel);
    setMenu({ sel, x: e.clientX, y: e.clientY });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (tool?.kind === 'background' && bg && bgAsset) {
      const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.0015));
      const patch = scaleBackground(bg, g, bgAsset, factor, toMm(e.clientX, e.clientY));
      gesture((d) => updateBackgroundImage(d, surface.id, patch));
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => endGesture('Resize background'), 300);
      return;
    }
    if (!cropId) return;
    const el = surface.elements.find((x) => x.id === cropId) as ImageElement | undefined;
    const asset = el?.assetId ? assets.get(el.assetId) : undefined;
    if (!el || !asset) return;
    // Scroll or pinch zooms the photo around the point under the pointer.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.0015));
    const p = toMm(e.clientX, e.clientY);
    const at = toInnerBox(el, p.x, p.y);
    const crop = zoomCropAt(innerBox(el), { w: asset.widthPx, h: asset.heightPx }, el.crop, el.fit, factor, at);
    // Consecutive wheel ticks merge into one undo step.
    gesture((d) => updateElement(d, surface.id, el.id, { crop }));
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

  const multiEls = selection?.spreadId === surface.id && multi.length > 1 ? surface.elements.filter((x) => multi.includes(x.id)) : [];
  const cropEl = cropId ? (surface.elements.find((x) => x.id === cropId) as ImageElement | undefined) : undefined;
  const cropAsset = cropEl?.assetId ? assets.get(cropEl.assetId) : undefined;
  const hovered = !tool && hoverId && hoverId !== selected?.id ? surface.elements.find((x) => x.id === hoverId) : undefined;
  const swapTarget = swapDrag?.target ? surface.elements.find((x) => x.id === swapDrag.target) : undefined;
  const totalW = (g.width + 2 * b) * scale;
  const cursor = tool?.kind === 'background' ? 'move' : tool?.kind === 'area' ? 'crosshair' : hovered && !hovered.locked ? 'move' : undefined;
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
          <SpreadView settings={doc.settings} style={doc.style} spreadCount={spreadCount} index={index} surface={surface} scale={scale} assets={assets} grade={doc.grade} hiddenElementId={editingText}>
            {showGuides && <Guides g={g} scale={scale} />}
            {cropEl && cropAsset && <CropGhost el={cropEl} scale={scale} offset={b} assetId={cropAsset.id} asset={cropAsset} />}
            {tool?.kind === 'background' && bg && bgAsset && <BgGhost bg={bg} g={g} asset={bgAsset} scale={scale} />}
            {tool?.kind === 'area' && <AreaShade rect={tool.rect ? areaMm(tool.rect) : null} scale={scale} offset={b} />}
            {guides.map((gl, i) =>
              gl.axis === 'x' ? <div key={i} className="snap-line snap-x" style={{ left: (gl.at + b) * scale }} /> : <div key={i} className="snap-line snap-y" style={{ top: (gl.at + b) * scale }} />,
            )}
            {marks.map((m, i) => <GapMark key={i} m={m} scale={scale} offset={b} />)}
            {sizeMatch.w && <div className="size-match" style={{ left: (sizeMatch.w.x + b) * scale, top: (sizeMatch.w.y + b) * scale - 10, width: sizeMatch.w.w * scale }}>=</div>}
            {sizeMatch.h && <div className="size-match size-match-v" style={{ left: (sizeMatch.h.x + b) * scale - 12, top: (sizeMatch.h.y + b) * scale, height: sizeMatch.h.h * scale }}>=</div>}
            {hovered && !gestureRef.current && <Outline el={hovered} scale={scale} offset={b} className="hover-outline" />}
            {dropTarget && <Outline el={surface.elements.find((x) => x.id === dropTarget)!} scale={scale} offset={b} className="drop-outline" />}
            {swapTarget && <Outline el={swapTarget} scale={scale} offset={b} className="drop-outline" />}
            {isPosterDoc && <PinBadges elements={surface.elements} scale={scale} offset={b} />}
            {multiEls.length > 1 && !editingText && (
              <>
                {multiEls.map((el) => <Outline key={el.id} el={el} scale={scale} offset={b} className="multi-outline" />)}
                <MultiBox els={multiEls} scale={scale} offset={b} />
              </>
            )}
            {marquee && <div className="marquee" style={{ left: (marquee.x + b) * scale, top: (marquee.y + b) * scale, width: marquee.w * scale, height: marquee.h * scale }} />}
            {selected && !editingText && multiEls.length <= 1 && <SelectionBox el={selected} scale={scale} offset={b} cropping={cropId === selected.id} />}
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
                setMarquee(null);
                setSwapDrag(null);
                useEditor.getState().cancelGesture();
              }}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              onWheel={onWheel}
              onDragOver={onDragOver}
              onDragLeave={() => setDropTarget(null)}
              onDrop={onDrop}
            >
              {selected && !selected.locked && !editingText && !cropId && multiEls.length <= 1 && <HandleLayer el={selected} scale={scale} offset={b} />}
              {cropEl && cropAsset && <CropHandles el={cropEl} asset={cropAsset} scale={scale} offset={b} />}
              {tool?.kind === 'background' && bg && bgAsset && <CornerHandles rect={bgExtents(bg, g, bgAsset)} scale={scale} offset={b} prefix="bg-" title="Drag to resize the photo" />}
              {tool?.kind === 'area' && tool.rect && <AreaHandles rect={areaMm(tool.rect)} scale={scale} offset={b} />}
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
      {cropEl && cropAsset && <CropToolbar key={cropEl.id} el={cropEl} asset={cropAsset} surfaceId={surface.id} ratio={cropRatio} onRatio={setCropRatio} />}
      {tool && <ToolBar tool={tool} />}
      {menu && <ContextMenu target={menu} onClose={() => setMenu(null)} onEditText={(id) => setEditingText(id)} />}
    </div>
  );
}

/** A measured gap: a thin line with ticks at both ends and its length in mm. */
function GapMark({ m, scale, offset }: { m: SpacingMark; scale: number; offset: number }) {
  const len = m.to - m.from;
  if (len <= 0) return null;
  const style: CSSProperties = m.axis === 'x'
    ? { left: (m.from + offset) * scale, top: (m.at + offset) * scale, width: len * scale }
    : { left: (m.at + offset) * scale, top: (m.from + offset) * scale, height: len * scale };
  return (
    <div className={`gap-mark gap-${m.axis}`} style={style}>
      <span>{len.toFixed(1)}</span>
    </div>
  );
}

function marqueeRef(g: { start: Pt }, end: Pt | null) {
  if (!end) return null;
  return { x: Math.min(g.start.x, end.x), y: Math.min(g.start.y, end.y), w: Math.abs(end.x - g.start.x), h: Math.abs(end.y - g.start.y) };
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

/** A small pin on every pinned photo, so it's clear which ones Arrange will leave alone. */
function PinBadges({ elements, scale, offset }: { elements: Element[]; scale: number; offset: number }) {
  return (
    <>
      {elements.map((el) =>
        el.type === 'image' && (el.pinned || el.keepCrop || el.keepRotation) ? (
          <div key={el.id} className="pin-badge-frame" style={frameStyle(el, scale, offset)}>
            <span className={`pin-badge ${el.pinned ? '' : 'pin-badge-crop'}`} title={el.pinned ? 'Pinned: Arrange leaves it where it is' : `${[el.keepCrop && 'Crop', el.keepRotation && 'rotation'].filter(Boolean).join(' and ')} kept when arranging`}>
              <Icon name={el.pinned ? 'pin' : el.keepCrop ? 'crop' : 'rotate'} size={11} />
            </span>
          </div>
        ) : null,
      )}
    </>
  );
}

/** Dashed box around everything selected. */
function MultiBox({ els, scale, offset }: { els: Element[]; scale: number; offset: number }) {
  const r = unionBounds(els);
  return <div className="multi-box" style={{ left: (r.x + offset) * scale, top: (r.y + offset) * scale, width: r.w * scale, height: r.h * scale }} />;
}

function SelectionBox({ el, scale, offset, cropping }: { el: Element; scale: number; offset: number; cropping: boolean }) {
  return (
    <div className={`selection ${el.locked ? 'selection-locked' : ''} ${cropping ? 'selection-crop' : ''}`} style={frameStyle(el, scale, offset)}>
      {/* Rule-of-thirds guide while cropping. */}
      {cropping && <div className="crop-grid"><i /><i /><i /><i /></div>}
    </div>
  );
}

/** How far the whole background photo reaches (surface mm): its box when fitted, the photo beyond the sheet when filling. */
function bgExtents(bg: BackgroundImage, g: SurfaceGeometry, asset: PhotoAsset): Rect {
  if (bg.fit === 'contain') return backgroundBox(bg, g, asset);
  const area = backgroundArea(g);
  const p = imagePlacement(area, { w: asset.widthPx, h: asset.heightPx }, bg.crop, 'cover');
  return { x: area.x + p.x, y: area.y + p.y, w: p.w, h: p.h };
}

/** While moving the background: the whole photo, faint where it runs off the sheet, and its outline. */
function BgGhost({ bg, g, asset, scale }: { bg: BackgroundImage; g: SurfaceGeometry; asset: PhotoAsset; scale: number }) {
  const r = bgExtents(bg, g, asset);
  const style = { left: (r.x + g.bleed) * scale, top: (r.y + g.bleed) * scale, width: r.w * scale, height: r.h * scale };
  return (
    <>
      <div className="crop-ghost bg-ghost" style={{ inset: 0 }}>
        <img src={thumbUrl(asset.id, 'm')} alt="" draggable={false} style={style} />
      </div>
      <div className="bg-outline" style={style} />
    </>
  );
}

/** Four corner handles on a rectangle (surface mm), named `<prefix>nw` … */
function CornerHandles({ rect, scale, offset, prefix, title }: { rect: Rect; scale: number; offset: number; prefix: string; title: string }) {
  const x0 = (rect.x + offset) * scale;
  const y0 = (rect.y + offset) * scale;
  const x1 = x0 + rect.w * scale;
  const y1 = y0 + rect.h * scale;
  return (
    <>
      {([['nw', x0, y0], ['ne', x1, y0], ['sw', x0, y1], ['se', x1, y1]] as const).map(([c, x, y]) => (
        <div key={c} className={`handle crop-handle crop-handle-${c}`} data-handle={`${prefix}${c}`} style={{ left: x, top: y }} title={title} />
      ))}
    </>
  );
}

/** The collage's photo area while it's being marked: everything else dimmed. */
function AreaShade({ rect, scale, offset }: { rect: Rect | null; scale: number; offset: number }) {
  return (
    <div className="area-shade">
      {rect ? (
        <div className="area-box" style={{ left: (rect.x + offset) * scale, top: (rect.y + offset) * scale, width: rect.w * scale, height: rect.h * scale }}>
          <span>Photos go here</span>
        </div>
      ) : (
        <div className="area-hint">Drag on the sheet to mark where the photos go</div>
      )}
    </div>
  );
}

function AreaHandles({ rect, scale, offset }: { rect: Rect; scale: number; offset: number }) {
  return (
    <div className="handles" style={{ left: (rect.x + offset) * scale, top: (rect.y + offset) * scale, width: rect.w * scale, height: rect.h * scale }}>
      {HANDLES.map((h) => <div key={h} className={`handle handle-${h}`} data-handle={`area-${h}`} />)}
    </div>
  );
}

/** Floating controls for the background and photo-area tools. */
function ToolBar({ tool }: { tool: CanvasTool }) {
  const st = useEditor.getState();
  if (tool.kind === 'background') {
    return (
      <div className="crop-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <strong className="small">Background photo</strong>
        <button className="btn btn-small btn-ghost" onClick={() => st.run('Reset background position', (d) => updateBackgroundImage(d, tool.surfaceId, { box: undefined, crop: { cx: 0.5, cy: 0.5, zoom: 1 } }))}>Reset</button>
        <button className="btn btn-small btn-primary" onClick={() => st.setCanvasTool(null)}>Done</button>
        <span className="crop-tip muted">Drag to move · scroll or drag a corner to resize · Esc when done</span>
      </div>
    );
  }
  return (
    <div className="crop-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <strong className="small">Photo area</strong>
      <button className="btn btn-small btn-ghost" onClick={() => setPhotoArea(undefined)} title="Let the photos use the whole sheet again">Whole sheet</button>
      <button className="btn btn-small btn-ghost" onClick={() => st.setCanvasTool(null)}>Cancel</button>
      <button className="btn btn-small btn-primary" disabled={!tool.rect} onClick={() => tool.rect && setPhotoArea(tool.rect)}>Apply</button>
      <span className="crop-tip muted">Drag to draw a box · drag its edges to adjust · Alt turns off edge snapping</span>
    </div>
  );
}

const CROP_EDGES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * While cropping: the crop box (the frame) with corner brackets and edge bars — drag them to crop,
 * the photo stays still — and small round handles on the whole photo's corners to scale it.
 */
function CropHandles({ el, asset, scale, offset }: { el: ImageElement; asset: PhotoAsset; scale: number; offset: number }) {
  const { box, placement } = elementPlacement(el, asset);
  const x0 = (box.x + placement.x) * scale;
  const y0 = (box.y + placement.y) * scale;
  const w = placement.w * scale;
  const h = placement.h * scale;
  return (
    <div className="handles" style={frameStyle(el, scale, offset)}>
      <div className="crop-outline" style={{ left: x0, top: y0, width: w, height: h }} />
      {([['nw', x0, y0], ['ne', x0 + w, y0], ['sw', x0, y0 + h], ['se', x0 + w, y0 + h]] as const).map(([c, x, y]) => (
        <div key={c} className={`handle crop-handle crop-handle-${c}`} data-handle={`cropzoom-${c}`} style={{ left: x, top: y }} title="Drag to make the photo bigger or smaller" />
      ))}
      {CROP_EDGES.map((c) => <div key={c} className={`cropbox-handle cropbox-${c}`} data-handle={`cropbox-${c}`} title="Drag to crop (Shift keeps the shape)" />)}
    </div>
  );
}

const CROP_RATIOS: { id: string; label: string; ratio: (a: PhotoAsset, el: ImageElement) => number | null }[] = [
  { id: 'free', label: 'Free', ratio: () => null },
  { id: 'frame', label: 'Keep shape', ratio: (_a, el) => el.widthMm / el.heightMm },
  { id: 'original', label: 'Original', ratio: (a) => a.widthPx / a.heightPx },
  { id: '1:1', label: 'Square', ratio: () => 1 },
  { id: '4:5', label: '4 : 5', ratio: () => 4 / 5 },
  { id: '3:4', label: '3 : 4', ratio: () => 3 / 4 },
  { id: '2:3', label: '2 : 3', ratio: () => 2 / 3 },
  { id: '9:16', label: '9 : 16', ratio: () => 9 / 16 },
];

/** Floating controls while cropping: shape, zoom, fill/fit, reset, cancel, done — and the print resolution. */
function CropToolbar({ el, asset, surfaceId, ratio, onRatio }: { el: ImageElement; asset: PhotoAsset; surfaceId: string; ratio: number | null; onRatio: (r: number | null) => void }) {
  const doc = useEditor((s) => s.doc)!;
  const { run, gesture, endGesture, setCrop, cancelCrop } = useEditor.getState();
  const [shape, setShape] = useState('free');
  const [landscape, setLandscape] = useState(el.widthMm >= el.heightMm);
  const box = innerBox(el);
  const img = { w: asset.widthPx, h: asset.heightPx };
  const setZoom = (z: number, live: boolean) => {
    const crop = zoomCropAt(box, img, el.crop, el.fit, z / (el.crop.zoom || 1), { x: box.w / 2, y: box.h / 2 });
    if (live) gesture((d) => updateElement(d, surfaceId, el.id, { crop }));
    else run('Zoom photo', (d) => updateElement(d, surfaceId, el.id, { crop }));
  };
  /** Crop the box to a shape (portrait shapes turn landscape when the frame is), about its centre. */
  const pick = (id: string, wide = landscape) => {
    setShape(id);
    const def = CROP_RATIOS.find((r) => r.id === id)!;
    let r = def.ratio(asset, el);
    if (r && (id !== 'frame' && id !== 'original') && wide !== r > 1 && r !== 1) r = 1 / r;
    onRatio(r);
    if (r) run(`Crop to ${def.label.toLowerCase()}`, (d) => updateElement(d, surfaceId, el.id, reframeCrop(el, img, null, 0, 0, r)));
  };
  const rotatable = shape !== 'free' && shape !== 'frame' && shape !== 'original' && shape !== '1:1';
  const dpi = Math.round(effectiveDpi(el, asset));
  const dpiClass = dpi >= doc.settings.minDpiWarning ? 'ok' : dpi >= doc.settings.minDpiError ? 'warn' : 'error';
  return (
    <div className="crop-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <select className="crop-shape" value={shape} onChange={(e) => pick(e.target.value)} aria-label="Crop shape" title="Crop to a shape; the crop box keeps it while you drag">
        {CROP_RATIOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      {rotatable && (
        <button className="icon-btn" title={landscape ? 'Make it portrait' : 'Make it landscape'} onClick={() => {
          setLandscape(!landscape);
          pick(shape, !landscape);
        }}>
          <Icon name="rotate" size={14} />
        </button>
      )}
      <button className="icon-btn" title="Zoom out (−)" onClick={() => setZoom(Math.max(1, el.crop.zoom / 1.15), false)}>−</button>
      <input
        type="range" min={1} max={5} step={0.01} value={el.crop.zoom} aria-label="Photo zoom"
        onChange={(e) => setZoom(Number(e.target.value), true)}
        onPointerUp={() => endGesture('Zoom photo')}
        onKeyUp={() => endGesture('Zoom photo')}
      />
      <button className="icon-btn" title="Zoom in (+)" onClick={() => setZoom(Math.min(5, el.crop.zoom * 1.15), false)}>+</button>
      <span className="crop-pct">{Math.round(el.crop.zoom * 100)}%</span>
      <span className={`dpi dpi-${dpiClass}`} title="Print resolution at this crop">{dpi} DPI</span>
      <div className="seg seg-compact">
        <button className={el.fit === 'cover' ? 'on' : ''} onClick={() => run('Fill frame', (d) => updateElement(d, surfaceId, el.id, { fit: 'cover' }))} title="Fill the frame (crops the photo)">Fill</button>
        <button className={el.fit === 'contain' ? 'on' : ''} onClick={() => run('Fit whole photo', (d) => updateElement(d, surfaceId, el.id, { fit: 'contain' }))} title="Show the whole photo">Fit</button>
      </div>
      <button className="btn btn-small btn-ghost" onClick={() => run('Reset crop', (d) => updateElement(d, surfaceId, el.id, { crop: defaultCrop(asset) }))}>Reset</button>
      <button className="btn btn-small btn-ghost" onClick={cancelCrop} title="Undo this crop (Esc)">Cancel</button>
      <button className="btn btn-small btn-primary" onClick={() => setCrop(null)} title="Keep this crop (Enter)">Done</button>
      {ratio === null && <span className="crop-tip muted">Drag the photo · drag the box's edges to crop · scroll to zoom</span>}
    </div>
  );
}

function HandleLayer({ el, scale, offset }: { el: Element; scale: number; offset: number }) {
  // The swap button shrinks with the frame rather than disappearing, so every photo can be swapped
  // (a photo swapped into a narrow frame keeps its button). Only truly tiny frames go without.
  const short = Math.min(el.widthMm, el.heightMm) * scale;
  const swapPx = Math.round(Math.max(18, Math.min(30, short * 0.4)));
  return (
    <div className="handles" style={frameStyle(el, scale, offset)}>
      {HANDLES.map((h) => (
        <div key={h} className={`handle handle-${h}`} data-handle={h} />
      ))}
      <div className="handle handle-rotate" data-handle="rotate" title="Rotate (Shift: 15° steps)" />
      {el.type === 'image' && el.assetId && short >= 26 && (
        <div className="handle-swap" data-handle="swap" title="Drag onto another photo to swap them" style={{ width: swapPx, height: swapPx, margin: -swapPx / 2 }}>
          <Icon name="swap" size={Math.round(swapPx * 0.47)} />
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
        ...textCss(el, scale),
      }}
    />
  );
}
