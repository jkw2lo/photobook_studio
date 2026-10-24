import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
// Bundled fonts: served from this app, never fetched from the internet.
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import './styles.css';
import { Editor } from './components/Editor';
import { Home } from './components/Home';

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
  return m ? <Editor key={m[1]} projectId={m[1]} /> : <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
