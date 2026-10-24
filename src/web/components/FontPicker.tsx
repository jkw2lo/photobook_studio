import { useEffect, useRef, useState } from 'react';
import { FONT_CATEGORIES, FONT_FAMILIES } from '../../core';
import { Icon } from './Icon';

/** Font chooser that shows every family in its own face, grouped by style. */
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="font-picker" ref={ref}>
      <button type="button" className="font-picker-btn" style={{ fontFamily: `'${value}'` }} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span>{value}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="font-menu" role="listbox" ref={listRef}>
          {FONT_CATEGORIES.map((c) => {
            const fams = FONT_FAMILIES.filter((f) => f.category === c.id);
            if (!fams.length) return null;
            return (
              <div key={c.id}>
                <div className="font-menu-cat">{c.label}</div>
                {fams.map((f) => (
                  <button
                    key={f.family}
                    type="button"
                    role="option"
                    aria-selected={f.family === value}
                    className={`font-option ${f.family === value ? 'on' : ''}`}
                    onClick={() => {
                      onChange(f.family);
                      setOpen(false);
                    }}
                  >
                    <span className="font-option-name" style={{ fontFamily: `'${f.family}'` }}>{f.family}</span>
                    <span className="font-option-note">{f.note}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
