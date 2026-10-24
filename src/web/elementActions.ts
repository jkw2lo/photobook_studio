import { duplicateElement, removeElements, reorderElement, updateElement, type Element } from '../core';
import { useEditor, type Selection } from './store';

// Element actions shared by the inspector, the right-click menu and keyboard shortcuts.

const st = () => useEditor.getState();

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
  st().run(el.locked ? 'Unlock' : 'Lock', (d) => updateElement(d, sel.spreadId, el.id, { locked: !el.locked }));
}

export function duplicate(sel: Selection) {
  let id = '';
  st().run('Duplicate', (d) => {
    const r = duplicateElement(d, sel.spreadId, sel.elementId);
    id = r.newId;
    return r.doc;
  });
  if (id) st().select({ spreadId: sel.spreadId, elementId: id });
}

export function remove(sel: Selection, el: Element) {
  if (el.locked) return st().toast('info', 'Unlock the element to delete it.');
  st().run('Delete', (d) => removeElements(d, sel.spreadId, [el.id]));
  st().select(null);
}

export function reorder(sel: Selection, where: 'front' | 'back' | 'forward' | 'backward') {
  const label = { front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[where];
  st().run(label, (d) => reorderElement(d, sel.spreadId, sel.elementId, where));
}
