import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Bundled fonts (generated from src/core/fonts.ts): served by this app, never fetched from the internet.
import './fonts.css';
import './styles.css';
import { Editor } from './components/Editor';
import { Home } from './components/Home';
import { API_VERSION } from '../core';

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
      <VersionCheck />
      {m ? <Editor key={m[1]} projectId={m[1]} /> : <Home />}
    </>
  );
}

/**
 * Warn when this page and the running server come from different versions — typically the app
 * was rebuilt but the server process kept running old code. Saving across that gap can fail.
 */
function VersionCheck() {
  const [stale, setStale] = useState<null | { server: number | undefined }>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { apiVersion?: number }) => {
        if (h.apiVersion !== API_VERSION) setStale({ server: h.apiVersion });
      })
      .catch(() => undefined);
  }, []);
  if (!stale) return null;
  return (
    <div className="version-banner" role="alert">
      <strong>The app was updated, but the server is still running the old version.</strong> Stop the server (Ctrl+C in its Terminal window) and start it again, then reload this page. Until then, new books and saves may not work correctly.
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
