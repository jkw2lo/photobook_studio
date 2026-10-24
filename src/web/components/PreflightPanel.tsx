import { useDeferredValue, useMemo } from 'react';
import { preflight, surfaceAt, type PreflightIssue } from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';

/**
 * Preflight is cheap but not free. It runs on the committed document only — mid-drag frames reuse
 * the last result — and at low priority (useDeferredValue), so it never competes with dragging.
 */
export function usePreflight(): PreflightIssue[] {
  const doc = useEditor((s) => (s.gestureBase ? s.gestureBase : s.doc));
  const assets = useEditor((s) => s.assetMap);
  const deferred = useDeferredValue(doc);
  return useMemo(() => (deferred ? preflight(deferred, assets) : []), [deferred, assets]);
}

export function PreflightPanel() {
  const issues = usePreflight();
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity] || (a.spreadIndex ?? -1) - (b.spreadIndex ?? -1));
  const jump = (i: PreflightIssue) => {
    const st = useEditor.getState();
    if (i.spreadIndex === undefined || !st.doc) return;
    st.goToSpread(i.spreadIndex);
    const surface = surfaceAt(st.doc, i.spreadIndex);
    if (i.elementId && surface) st.select({ spreadId: surface.id, elementId: i.elementId });
  };
  if (!sorted.length) {
    return (
      <div className="preflight-ok">
        <Icon name="check" size={20} />
        <p>No print problems found.</p>
        <p className="muted small">Checked: photo resolution, bleed, safe area, binding, inside covers, missing originals.</p>
      </div>
    );
  }
  return (
    <ul className="issues">
      {sorted.map((i) => (
        <li key={i.id} className={`issue issue-${i.severity}`} onClick={() => jump(i)}>
          <Icon name={i.severity === 'info' ? 'info' : 'alert'} />
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}
