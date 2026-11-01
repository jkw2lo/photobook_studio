import { useState } from 'react';
import { saveNow, useEditor } from '../store';
import { Icon } from './Icon';
import { Modal } from './Modal';

// Quit: save anything pending, then ask the local server to quit the app (started from the Dock,
// the Dock app quits too). Afterwards this tab just says so — there's nothing left to talk to.

export function QuitButton({ compact }: { compact?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<'idle' | 'quitting' | 'quit'>('idle');
  const [error, setError] = useState<string | null>(null);

  const quit = async () => {
    setState('quitting');
    setError(null);
    if (!(await saveNow())) {
      setState('idle');
      return setError('Your latest changes couldn’t be saved, so the app is still open. Check the save status at the top, then try again.');
    }
    try {
      const res = await fetch('/api/quit', { method: 'POST', headers: { 'x-photobook': '1' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
      setState('quit');
      setAsking(false);
      // Browsers only let a page close a tab it opened itself; otherwise the message below stays.
      setTimeout(() => window.close(), 600);
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const dirty = useEditor((s) => s.saveState === 'dirty' || s.saveState === 'saving');

  if (state === 'quit') {
    return (
      <div className="quit-screen" role="status">
        <Icon name="power" size={28} />
        <h2>Photobook Studio has quit</h2>
        <p className="muted">Everything is saved. You can close this tab. Open the app again from the Dock or Applications.</p>
      </div>
    );
  }

  return (
    <>
      <button className={compact ? 'icon-btn' : 'btn'} onClick={() => setAsking(true)} title="Quit Photobook Studio">
        <Icon name="power" />{compact ? null : ' Quit'}
      </button>
      {asking && (
        <Modal title="Quit Photobook Studio?" onClose={() => state !== 'quitting' && setAsking(false)}>
          <div className="stack">
            <p>{dirty ? 'Your latest changes are saved first, then' : 'Everything is saved. The'} app and its local server stop. Your books and photos stay on this computer.</p>
            {error && <div className="notice notice-error small">{error}</div>}
            <div className="row modal-actions">
              <button className="btn btn-ghost" disabled={state === 'quitting'} onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={state === 'quitting'} onClick={() => void quit()}>{state === 'quitting' ? 'Quitting…' : 'Quit'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
