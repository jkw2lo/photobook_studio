import { DEFAULT_COLLAGE, duplicateElement, duplicateElements, groupElements, relayoutPoster, removeElements, reorderElement, reorderElements, setLockedMany, ungroupElements, updateElement, type CollageSettings, type Element, type Rect } from '../core';
import { selectedIds, useEditor, type Selection } from './store';

// Element actions shared by the inspector, the right-click menu and keyboard shortcuts.

const st = () => useEditor.getState();
/** Everything selected (one or many). */
const ids = () => selectedIds(st());
const many = () => ids().length > 1;

export function togglePin(sel: Selection, el: Element) {
  if (el.type !== 'image') return;
  st().run(el.pinned ? 'Unpin photo' : 'Pin photo', (d) => updateElement(d, sel.spreadId, el.id, { pinned: !el.pinned }));
}

export function toggleKeepCrop(sel: Selection, el: Element) {
  if (el.type !== 'image') return;
  st().run(el.keepCrop ? 'Stop keeping crop' : 'Keep crop', (d) => updateElement(d, sel.spreadId, el.id, { keepCrop: !el.keepCrop }));
}

export function toggleKeepRotation(sel: Selection, el: Element) {
  if (el.type !== 'image') return;
  st().run(el.keepRotation ? 'Stop keeping rotation' : 'Keep rotation', (d) => updateElement(d, sel.spreadId, el.id, { keepRotation: !el.keepRotation }));
}

export function toggleLock(sel: Selection, el: Element) {
  if (many()) {
    const doc = st().doc;
    const els = doc ? (doc.cover?.id === sel.spreadId ? doc.cover : doc.spreads.find((s) => s.id === sel.spreadId))?.elements ?? [] : [];
    const lock = els.some((e) => ids().includes(e.id) && !e.locked);
    return void st().run(lock ? 'Lock items' : 'Unlock items', (d) => setLockedMany(d, sel.spreadId, ids(), lock));
  }
  st().run(el.locked ? 'Unlock' : 'Lock', (d) => updateElement(d, sel.spreadId, el.id, { locked: !el.locked }));
}

export function duplicate(sel: Selection) {
  if (many()) {
    let newIds: string[] = [];
    st().run(`Duplicate ${ids().length} items`, (d) => {
      const r = duplicateElements(d, sel.spreadId, ids());
      newIds = r.newIds;
      return r.doc;
    });
    if (newIds.length) st().selectMany(sel.spreadId, newIds);
    return;
  }
  let id = '';
  st().run('Duplicate', (d) => {
    const r = duplicateElement(d, sel.spreadId, sel.elementId);
    id = r.newId;
    return r.doc;
  });
  if (id) st().select({ spreadId: sel.spreadId, elementId: id });
}

export function remove(sel: Selection, el: Element) {
  if (many()) {
    const doc = st().doc;
    const els = doc ? (doc.cover?.id === sel.spreadId ? doc.cover : doc.spreads.find((s) => s.id === sel.spreadId))?.elements ?? [] : [];
    const unlocked = els.filter((e) => ids().includes(e.id) && !e.locked).map((e) => e.id);
    if (!unlocked.length) return st().toast('info', 'Unlock the items to delete them.');
    st().run(`Delete ${unlocked.length} items`, (d) => removeElements(d, sel.spreadId, unlocked));
    return st().select(null);
  }
  if (el.locked) return st().toast('info', 'Unlock the element to delete it.');
  st().run('Delete', (d) => removeElements(d, sel.spreadId, [el.id]));
  st().select(null);
}

export function reorder(sel: Selection, where: 'front' | 'back' | 'forward' | 'backward') {
  const label = { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[where];
  if (many() && (where === 'front' || where === 'back')) return void st().run(label, (d) => reorderElements(d, sel.spreadId, ids(), where));
  st().run(label, (d) => reorderElement(d, sel.spreadId, sel.elementId, where));
}

export function group(sel: Selection) {
  if (!many()) return st().toast('info', 'Select two or more items (Shift-click or drag a box) to group them.');
  const chosen = ids();
  if (st().run('Group', (d) => groupElements(d, sel.spreadId, chosen))) st().selectMany(sel.spreadId, chosen, sel.elementId);
}

export function ungroup(sel: Selection) {
  const chosen = ids();
  if (st().run('Ungroup', (d) => ungroupElements(d, sel.spreadId, chosen))) st().selectMany(sel.spreadId, chosen, sel.elementId);
}

/**
 * Where a poster's photos go (fractions of the sheet; undefined = the whole sheet), then re-flow
 * the photos on it into that area.
 */
export function setPhotoArea(area: Rect | undefined) {
  const s = st();
  if (!s.doc) return;
  const next: CollageSettings = { ...(s.doc.collage ?? DEFAULT_COLLAGE), area };
  if (!area) delete next.area;
  const hasPhotos = s.doc.spreads[0]?.elements.some((e) => e.type === 'image' && e.assetId);
  s.run(area ? 'Set photo area' : 'Use the whole sheet for photos', (d) => (hasPhotos ? relayoutPoster(d, s.assetMap, next) : { ...d, collage: next }));
  s.setCanvasTool(null);
}
