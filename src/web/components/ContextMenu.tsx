import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findSurface } from '../../core';
import { duplicate, remove, reorder, togglePin, toggleKeepCrop, toggleLock } from '../elementActions';
import { useEditor, type Selection } from '../store';
import { Icon } from './Icon';

// Right-click menu for an element on the canvas: a row of quick action icons, then the same
// actions (and a few more) with labels and shortcuts.

export interface MenuTarget {
  sel: Selection;
  x: number;
  y: number;
}

export function ContextMenu({ target, onClose, onEditText }: { target: MenuTarget; onClose: () => void; onEditText: (id: string) => void }) {
  const doc = useEditor((s) => s.doc)!;
  const el = useEditor((s) => (s.doc ? findSurface(s.doc, target.sel.spreadId)?.surface.elements.find((e) => e.id === target.sel.elementId) : undefined));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.min(target.x, window.innerWidth - r.width - 8), top: Math.min(target.y, window.innerHeight - r.height - 8) });
  }, [target.x, target.y]);

  useEffect(() => {
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  if (!el) return null;
  const { sel } = target;
  const poster = doc.settings.product === 'poster';
  const photo = el.type === 'image' && !!el.assetId;
  const { setCrop, setSwapSource } = useEditor.getState();
  const go = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const quick: { icon: string; label: string; on?: boolean; disabled?: boolean; run: () => void }[] = [];
  if (poster && el.type === 'image') quick.push({ icon: 'pin', label: el.pinned ? 'Unpin (P)' : 'Pin in place (P)', on: el.pinned, run: () => togglePin(sel, el) });
  if (photo) quick.push({ icon: 'crop', label: 'Adjust crop', disabled: el.locked, run: () => setCrop(el.id) });
  if (photo) quick.push({ icon: 'swap', label: 'Swap with…', disabled: el.locked, run: () => setSwapSource(sel) });
  if (el.type === 'text') quick.push({ icon: 'text', label: 'Edit text', disabled: el.locked, run: () => onEditText(el.id) });
  quick.push({ icon: 'front', label: 'Bring to front', run: () => reorder(sel, 'front') });
  quick.push({ icon: 'copy', label: 'Duplicate (⌘D)', run: () => duplicate(sel) });
  quick.push({ icon: 'trash', label: 'Delete (⌫)', disabled: el.locked, run: () => remove(sel, el) });

  return (
    <div className="ctx-menu" ref={ref} style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-quick">
        {quick.map((q) => (
          <button key={q.icon} className={`icon-btn ${q.on ? 'on' : ''} ${q.icon === 'trash' ? 'danger' : ''}`} title={q.label} aria-label={q.label} disabled={q.disabled} onClick={go(q.run)}>
            <Icon name={q.icon} />
          </button>
        ))}
      </div>
      {poster && el.type === 'image' && (
        <>
          <MenuItem icon="pin" label={el.pinned ? 'Unpin' : 'Pin in place'} hint="P" checked={!!el.pinned} onClick={go(() => togglePin(sel, el))} />
          <MenuItem icon="crop" label="Keep crop when arranging" checked={!!el.keepCrop && !el.pinned} disabled={el.pinned || !photo} onClick={go(() => toggleKeepCrop(sel, el))} />
          <div className="ctx-sep" />
        </>
      )}
      {photo && <MenuItem icon="crop" label="Adjust crop" hint="dbl-click" disabled={el.locked} onClick={go(() => setCrop(el.id))} />}
      {photo && <MenuItem icon="swap" label="Swap with…" disabled={el.locked} onClick={go(() => setSwapSource(sel))} />}
      {el.type === 'text' && <MenuItem icon="text" label="Edit text" hint="dbl-click" disabled={el.locked} onClick={go(() => onEditText(el.id))} />}
      <MenuItem icon="front" label="Bring to front" onClick={go(() => reorder(sel, 'front'))} />
      <MenuItem icon="down" label="Send to back" onClick={go(() => reorder(sel, 'back'))} />
      <div className="ctx-sep" />
      <MenuItem icon="copy" label="Duplicate" hint="⌘D" onClick={go(() => duplicate(sel))} />
      <MenuItem icon={el.locked ? 'unlock' : 'lock'} label={el.locked ? 'Unlock' : 'Lock'} hint="L" onClick={go(() => toggleLock(sel, el))} />
      <MenuItem icon="trash" label="Delete" hint="⌫" danger disabled={el.locked} onClick={go(() => remove(sel, el))} />
    </div>
  );
}

function MenuItem({ icon, label, hint, checked, disabled, danger, onClick }: { icon: string; label: string; hint?: string; checked?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className={`ctx-item ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
      {checked && <Icon name="check" size={13} />}
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

