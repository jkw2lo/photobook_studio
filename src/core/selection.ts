import { produce, type Draft } from 'immer';
import type { BookDocument, Element, Rect, Spread } from './model';
import { pageTrimRect, sideOfX } from './book';
import { CommandError } from './commands';
import { elementBounds } from './geometry';
import { newId } from './random';
import { coverDims, findSurface } from './surface';

// Working with several elements at once: move, group, align, distribute, duplicate, reorder.
// A group is just a shared `groupId`; groups act as one unit when aligning and distributing.

function surfaceOf(d: Draft<BookDocument>, spreadId: string): Draft<Spread> {
  const s = d.cover?.id === spreadId ? d.cover : d.spreads.find((x) => x.id === spreadId);
  if (!s) throw new CommandError('Spread not found');
  return s as Draft<Spread>;
}

/** Ids plus every other member of any group they belong to. */
export function expandGroups(elements: Element[], ids: string[]): string[] {
  const groups = new Set(elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  return elements.filter((e) => ids.includes(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

/** Axis-aligned box around several elements (rotation included). */
export function unionBounds(elements: Element[]): Rect {
  const bs = elements.map(elementBounds);
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function moveElements(doc: BookDocument, spreadId: string, ids: string[], dx: number, dy: number): BookDocument {
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) {
      if (!ids.includes(e.id) || e.locked) continue;
      e.xMm += dx;
      e.yMm += dy;
    }
  });
}

export function groupElements(doc: BookDocument, spreadId: string, ids: string[]): BookDocument {
  if (ids.length < 2) throw new CommandError('Select two or more items to group them');
  const gid = newId();
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) if (ids.includes(e.id)) e.groupId = gid;
  });
}

export function ungroupElements(doc: BookDocument, spreadId: string, ids: string[]): BookDocument {
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) if (ids.includes(e.id)) delete e.groupId;
  });
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Units to align: each group in the selection moves as one; other elements on their own. */
function units(elements: Element[], ids: string[]): Element[][] {
  const chosen = elements.filter((e) => ids.includes(e.id) && !e.locked);
  const byGroup = new Map<string, Element[]>();
  const out: Element[][] = [];
  for (const e of chosen) {
    if (!e.groupId) out.push([e]);
    else if (byGroup.has(e.groupId)) byGroup.get(e.groupId)!.push(e);
    else {
      const g = [e];
      byGroup.set(e.groupId, g);
      out.push(g);
    }
  }
  return out;
}

/** The page (or poster sheet, or cover panel) a box mostly sits on. */
function pageAround(doc: BookDocument, surfaceIndex: number, b: Rect): Rect {
  const s = doc.settings;
  const cx = b.x + b.w / 2;
  if (doc.settings.product === 'poster') return { x: 0, y: 0, w: s.trimWidthMm, h: s.trimHeightMm };
  if (surfaceIndex === -1) {
    const { panelW, panelH, spine } = coverDims(doc);
    const S = spine.mm;
    if (cx < panelW) return { x: 0, y: 0, w: panelW, h: panelH };
    if (cx < panelW + S) return { x: panelW, y: 0, w: S, h: panelH };
    return { x: panelW + S, y: 0, w: panelW, h: panelH };
  }
  return pageTrimRect(sideOfX(cx, s), s);
}

/**
 * Line elements up by an edge or centre — against each other (the selection's box), or against the
 * page they sit on when only one unit is selected or `toPage` is set.
 */
export function alignElements(doc: BookDocument, spreadId: string, ids: string[], edge: AlignEdge, toPage = false): BookDocument {
  const found = findSurface(doc, spreadId);
  if (!found) throw new CommandError('Spread not found');
  const us = units(found.surface.elements, ids);
  if (!us.length) return doc;
  const all = us.flat();
  const target = toPage || us.length === 1 ? pageAround(doc, found.index, unionBounds(all)) : unionBounds(all);
  const moves = new Map<string, [number, number]>();
  for (const u of us) {
    const b = unionBounds(u);
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = target.x - b.x;
    if (edge === 'hcenter') dx = target.x + target.w / 2 - (b.x + b.w / 2);
    if (edge === 'right') dx = target.x + target.w - (b.x + b.w);
    if (edge === 'top') dy = target.y - b.y;
    if (edge === 'vcenter') dy = target.y + target.h / 2 - (b.y + b.h / 2);
    if (edge === 'bottom') dy = target.y + target.h - (b.y + b.h);
    for (const e of u) moves.set(e.id, [dx, dy]);
  }
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) {
      const m = moves.get(e.id);
      if (!m) continue;
      e.xMm += m[0];
      e.yMm += m[1];
    }
  });
}

/** Equal gaps between three or more units, keeping the outermost two where they are. */
export function distributeElements(doc: BookDocument, spreadId: string, ids: string[], axis: 'h' | 'v'): BookDocument {
  const found = findSurface(doc, spreadId);
  if (!found) throw new CommandError('Spread not found');
  const us = units(found.surface.elements, ids).map((u) => ({ u, b: unionBounds(u) }));
  if (us.length < 3) throw new CommandError('Select three or more items to space them evenly');
  const pos = (b: Rect) => (axis === 'h' ? b.x : b.y);
  const size = (b: Rect) => (axis === 'h' ? b.w : b.h);
  us.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2));
  const first = us[0].b;
  const last = us[us.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - us.reduce((s, x) => s + size(x.b), 0)) / (us.length - 1);
  const moves = new Map<string, number>();
  let at = pos(first);
  for (const { u, b } of us) {
    for (const e of u) moves.set(e.id, at - pos(b));
    at += size(b) + gap;
  }
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) {
      const m = moves.get(e.id);
      if (m === undefined) continue;
      if (axis === 'h') e.xMm += m;
      else e.yMm += m;
    }
  });
}

/** Copies of several elements, a little offset, keeping their stacking order and groups (as new groups). */
export function duplicateElements(doc: BookDocument, spreadId: string, ids: string[], offsetMm = 5): { doc: BookDocument; newIds: string[] } {
  const newIds: string[] = [];
  const groupMap = new Map<string, string>();
  const next = produce(doc, (d) => {
    const s = surfaceOf(d, spreadId);
    const copies = s.elements
      .filter((e) => ids.includes(e.id))
      .map((e) => {
        const c = JSON.parse(JSON.stringify(e)) as Draft<Element>;
        c.id = newId();
        c.xMm += offsetMm;
        c.yMm += offsetMm;
        c.locked = false;
        if (c.type === 'image') delete c.pinned;
        if (c.groupId) {
          if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, newId());
          c.groupId = groupMap.get(c.groupId);
        }
        newIds.push(c.id);
        return c;
      });
    s.elements.push(...copies);
  });
  return { doc: next, newIds };
}

/** Bring several elements to the front (or send to the back), keeping their order among themselves. */
export function reorderElements(doc: BookDocument, spreadId: string, ids: string[], where: 'front' | 'back'): BookDocument {
  return produce(doc, (d) => {
    const s = surfaceOf(d, spreadId);
    const chosen = s.elements.filter((e) => ids.includes(e.id));
    const rest = s.elements.filter((e) => !ids.includes(e.id));
    s.elements = where === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
  });
}

/** Move one element one step up or down the stack (layers panel). */
export function stepElement(doc: BookDocument, spreadId: string, id: string, dir: 1 | -1): BookDocument {
  return produce(doc, (d) => {
    const s = surfaceOf(d, spreadId);
    const i = s.elements.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.elements.length) return;
    [s.elements[i], s.elements[j]] = [s.elements[j], s.elements[i]];
  });
}

export function setLockedMany(doc: BookDocument, spreadId: string, ids: string[], locked: boolean): BookDocument {
  return produce(doc, (d) => {
    for (const e of surfaceOf(d, spreadId).elements) if (ids.includes(e.id)) e.locked = locked;
  });
}

/** Elements whose box touches a rectangle (marquee selection). */
export function elementsInRect(elements: Element[], r: Rect): string[] {
  return elements
    .filter((e) => {
      const b = elementBounds(e);
      return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
    })
    .map((e) => e.id);
}
