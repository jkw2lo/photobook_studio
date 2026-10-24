import { useEffect, useRef } from 'react';
import type { BookDocument } from '../../core';
import { useEditor } from '../store';

/**
 * Colour picker that previews live while you drag in the system picker and commits one undo step
 * when the picker closes (the native `change` event), instead of one step per intermediate colour.
 */
export function ColorInput({ value, label, apply }: { value: string; label: string; apply: (d: BookDocument, color: string) => BookDocument }) {
  const ref = useRef<HTMLInputElement>(null);
  const labelRef = useRef(label);
  labelRef.current = label;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const end = () => useEditor.getState().endGesture(labelRef.current);
    el.addEventListener('change', end);
    el.addEventListener('blur', end);
    return () => {
      el.removeEventListener('change', end);
      el.removeEventListener('blur', end);
    };
  }, []);
  return <input ref={ref} type="color" value={value} onChange={(e) => useEditor.getState().gesture((d) => apply(d, e.target.value))} />;
}
