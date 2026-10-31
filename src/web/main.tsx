import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Bundled fonts (generated from src/core/fonts.ts): served by this app, never fetched from the internet.
import './fonts.css';
import './styles.css';
import { Editor } from './components/Editor';
import { Home } from './components/Home';
import { API_VERSION } from '../core';
import { isBrowserBackend } from './api';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const hash = useHashRoute();
  const m = hash.match(/^#\/book\/([\w-]+)/);
  return (
    <>
      {/* The web version has no server to be out of date. */}
      {!isBrowserBackend && <VersionCheck />}
      {m ? <Editor key={m[1]} projectId={m[1]} /> : <Home />}
    </>
  );
}

/**
 * Warn when this page and the running server come from different versions — typically the app
 * was rebuilt but the server process kept running old code. Saving across that gap can fail.
 */
function VersionCheck() {
  const [stale, setStale] = useState<null | { server: number | undefined; canRestart: boolean }>(null);
  const [state, setState] = useState<'idle' | 'restarting' | 'failed'>('idle');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { apiVersion?: number; canRestart?: boolean }) => {
        if (h.apiVersion !== API_VERSION) setStale({ server: h.apiVersion, canRestart: !!h.canRestart });
      })
      .catch(() => undefined);
  }, []);
  if (!stale) return null;

  const restart = async () => {
    setState('restarting');
    try {
      const r = await fetch('/api/restart', { method: 'POST', headers: { 'x-photobook': '1' } });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      // Wait for the new server (it may rebuild the editor first), then reload onto it.
      const until = Date.now() + 90_000;
      while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, 700));
        const h = await fetch('/api/health', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
        if (h?.apiVersion === API_VERSION) return location.reload();
      }
      throw new Error('The server did not come back with the new version. Quit and reopen the Photobook Studio app.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('failed');
    }
  };

  return (
    <div className="version-banner" role="alert">
      <strong>The app was updated, but the server is still running the old version.</strong>{' '}
      {stale.canRestart ? (
        <>
          Restart it to finish updating — your work is saved.{' '}
          <button className="btn btn-small btn-primary" disabled={state === 'restarting'} onClick={() => void restart()}>
            {state === 'restarting' ? 'Restarting…' : 'Restart server now'}
          </button>
          {state === 'failed' && <span> {error}</span>}
        </>
      ) : (
        <>Stop the server (Ctrl+C in its Terminal window) and start it again, then reload this page. Until then, new books and saves may not work correctly.</>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
