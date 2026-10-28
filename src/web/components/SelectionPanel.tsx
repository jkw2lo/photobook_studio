import { useState } from 'react';
import {
  alignElements, distributeElements, elementOpacity, findSurface, shapeDef, stepElement, updateElement, type AlignEdge, type Element,
} from '../../core';
import { duplicate, group, remove, reorder, toggleLock, ungroup } from '../elementActions';
import { useShallow } from 'zustand/react/shallow';
import { selectedIds, useEditor } from '../store';
import { Icon } from './Icon';
import { OpacitySlider } from './DesignPanel';

// Several things selected: align, distribute, group. And the Layers list for the current page.

const ALIGN: { edge: AlignEdge; title: string; d: string }[] = [
  { edge: 'left', title: 'Align left edges', d: 'M3 2v16M6 5h9v4H6zM6 11h6v4H6z' },
  { edge: 'hcenter', title: 'Align centres (horizontally)', d: 'M10 2v16M5 5h10v4H5zM7 11h6v4H7z' },
  { edge: 'right', title: 'Align right edges', d: 'M17 2v16M5 5h9v4H5zM8 11h6v4H8z' },
  { edge: 'top', title: 'Align top edges', d: 'M2 3h16M5 6h4v9H5zM11 6h4v6h-4z' },
  { edge: 'vcenter', title: 'Align middles (vertically)', d: 'M2 10h16M5 5h4v10H5zM11 7h4v6h-4z' },
  { edge: 'bottom', title: 'Align bottom edges', d: 'M2 17h16M5 5h4v9H5zM11 8h4v6h-4z' },
];

function AlignIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Align / distribute buttons, for one item (to its page) or several (to each other). */
export function AlignTools({ spreadId, ids }: { spreadId: string; ids: string[] }) {
  const { run } = useEditor.getState();
  const [toPage, setToPage] = useState(false);
  const single = ids.length < 2;
  return (
    <div className="stack tight">
      <div className="align-row">
        {ALIGN.map((a) => (
          <button key={a.edge} className="icon-btn" title={`${a.title}${single || toPage ? ' (to the page)' : ''}`} aria-label={a.title} onClick={() => run(a.title, (d) => alignElements(d, spreadId, ids, a.edge, toPage))}>
            <AlignIcon d={a.d} />
          </button>
        ))}
        <button className="icon-btn" title="Space evenly across" aria-label="Distribute horizontally" disabled={ids.length < 3} onClick={() => run('Space evenly across', (d) => distributeElements(d, spreadId, ids, 'h'))}>
          <AlignIcon d="M3 3v14M17 3v14M7 6h6v8H7z" />
        </button>
        <button className="icon-btn" title="Space evenly down" aria-label="Distribute vertically" disabled={ids.length < 3} onClick={() => run('Space evenly down', (d) => distributeElements(d, spreadId, ids, 'v'))}>
          <AlignIcon d="M3 3h14M3 17h14M6 7h8v6H6z" />
        </button>
      </div>
      {!single && (
        <div className="seg seg-wide">
          <button className={!toPage ? 'on' : ''} onClick={() => setToPage(false)}>To each other</button>
          <button className={toPage ? 'on' : ''} onClick={() => setToPage(true)}>To the page</button>
        </div>
      )}
    </div>
  );
}

/** Inspector when several elements are selected. */
export function MultiPanel() {
  const doc = useEditor((s) => s.doc)!;
  const sel = useEditor((s) => s.selection)!;
  const ids = useEditor(useShallow(selectedIds));
  const els = findSurface(doc, sel.spreadId)?.surface.elements.filter((e) => ids.includes(e.id)) ?? [];
  const primary = els.find((e) => e.id === sel.elementId) ?? els[0];
  const groups = new Set(els.map((e) => e.groupId).filter(Boolean));
  const oneGroup = groups.size === 1 && els.every((e) => e.groupId);
  const locked = els.every((e) => e.locked);
  const kinds = { image: 0, text: 0, shape: 0, calendar: 0 };
  for (const e of els) kinds[e.type]++;
  const summary = [kinds.image && `${kinds.image} photo${kinds.image > 1 ? 's' : ''}`, kinds.text && `${kinds.text} text`, kinds.shape && `${kinds.shape} shape${kinds.shape > 1 ? 's' : ''}`, kinds.calendar && `${kinds.calendar} calendar${kinds.calendar > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  if (!primary) return null;
  return (
    <div className="stack">
      <div className="row between">
        <strong>{oneGroup ? 'Group' : `${els.length} items`}</strong>
        <div className="row">
          <button className={`icon-btn ${locked ? 'on' : ''}`} title={locked ? 'Unlock all (L)' : 'Lock all (L)'} onClick={() => toggleLock(sel, primary)}><Icon name={locked ? 'lock' : 'unlock'} /></button>
          <button className="icon-btn" title="Duplicate (⌘D)" onClick={() => duplicate(sel)}><Icon name="copy" /></button>
          <button className="icon-btn danger" title="Delete (⌫)" onClick={() => remove(sel, primary)}><Icon name="trash" /></button>
        </div>
      </div>
      <p className="muted small">{summary}. Drag any of them to move them together; Shift-click adds or removes items.</p>

      <div className="btn-grid">
        {oneGroup ? (
          <button className="btn btn-small" onClick={() => ungroup(sel)} title="⇧⌘G"><Icon name="grid" /> Ungroup</button>
        ) : (
          <button className="btn btn-small btn-primary" onClick={() => group(sel)} title="⌘G — move and align them as one"><Icon name="grid" /> Group</button>
        )}
        <button className="btn btn-small" onClick={() => reorder(sel, 'front')}><Icon name="front" /> To front</button>
        <button className="btn btn-small" onClick={() => reorder(sel, 'back')}><Icon name="down" /> To back</button>
      </div>

      <div className="section-title">Align</div>
      <AlignTools spreadId={sel.spreadId} ids={ids} />
      <OpacitySlider spreadId={sel.spreadId} ids={ids} value={elementOpacity(primary)} label="Opacity (all selected)" />
      {oneGroup && <p className="muted small">Click a grouped item again to select just that item and edit it.</p>}
    </div>
  );
}

// ---- layers ------------------------------------------------------------------------------------

function layerName(e: Element, assetName: (id: string) => string | undefined): string {
  if (e.type === 'image') return e.assetId ? assetName(e.assetId) ?? 'Photo' : 'Empty frame';
  if (e.type === 'text') return e.text.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Text';
  if (e.type === 'calendar') return `Calendar · ${e.title?.trim() || (e.mode === 'month' ? 'month' : 'trip')}`;
  if (e.outline) return `Map · ${e.outline.name}`;
  return shapeDef(e.shape).name;
}

/** Everything on the current page, top of the stack first: select, reorder, lock. */
export function LayersPanel() {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const assets = useEditor((s) => s.assetMap);
  const ids = useEditor(useShallow(selectedIds));
  const [open, setOpen] = useState(false);
  const surface = index === -1 ? doc.cover : doc.spreads[index];
  if (!surface || !surface.elements.length) return null;
  const { run, select, toggleInSelection } = useEditor.getState();
  const rows = [...surface.elements].reverse();
  return (
    <div className="layers">
      <button className="layers-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Layers <span className="muted">({surface.elements.length})</span></span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div className="layers-list" role="list">
          {rows.map((e) => {
            const i = surface.elements.indexOf(e);
            const on = ids.includes(e.id);
            return (
              <div key={e.id} role="listitem" className={`layer ${on ? 'on' : ''}`} onClick={(ev) => (ev.shiftKey ? toggleInSelection(surface.id, e.id) : select({ spreadId: surface.id, elementId: e.id }, { only: true }))}>
                <Icon name={e.type === 'image' ? 'image' : e.type === 'text' ? 'text' : e.type === 'calendar' ? 'grid' : 'sparkle'} size={13} />
                <span className="layer-name">{layerName(e, (id) => assets.get(id)?.fileName)}</span>
                {e.groupId && <span className="layer-tag" title="In a group">G</span>}
                {e.type === 'image' && e.pinned && <Icon name="pin" size={11} />}
                <button className="icon-btn" title={e.locked ? 'Unlock' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); run(e.locked ? 'Unlock' : 'Lock', (d) => updateElement(d, surface.id, e.id, { locked: !e.locked })); }}>
                  <Icon name={e.locked ? 'lock' : 'unlock'} size={12} />
                </button>
                <button className="icon-btn" title="Up a layer" disabled={i === surface.elements.length - 1} onClick={(ev) => { ev.stopPropagation(); run('Bring forward', (d) => stepElement(d, surface.id, e.id, 1)); }}>↑</button>
                <button className="icon-btn" title="Down a layer" disabled={i === 0} onClick={(ev) => { ev.stopPropagation(); run('Send backward', (d) => stepElement(d, surface.id, e.id, -1)); }}>↓</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
