import { useEffect, useState } from 'react';
import { api, type FolderListing } from '../api';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Browse local folders through the local server (the browser cannot expose real paths itself). */
export function FolderPicker({ title, action, onChoose, onCancel }: { title: string; action: string; onChoose: (path: string) => void; onCancel: () => void }) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = async (p?: string): Promise<boolean> => {
    try {
      const l = await api.listFolder(p);
      setListing(l);
      setPath(l.path);
      setError(null);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  useEffect(() => {
    let last: string | undefined;
    try {
      last = localStorage.getItem('photobook:lastFolder') ?? undefined;
    } catch {
      // storage unavailable
    }
    void open(last).then((ok) => (ok ? undefined : open()));
  }, []);

  const choose = () => {
    try {
      localStorage.setItem('photobook:lastFolder', path);
    } catch {
      // storage unavailable
    }
    onChoose(path);
  };

  return (
    <Modal title={title} onClose={onCancel} wide>
      <form
        className="path-row"
        onSubmit={(e) => {
          e.preventDefault();
          void open(path);
        }}
      >
        <input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} aria-label="Folder path" />
        <button className="btn btn-small" type="submit">Go</button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}
      {listing && (
        <div className="folder-list">
          {listing.parent && (
            <button className="folder" onClick={() => open(listing.parent!)}>
              <Icon name="up" /> ..
            </button>
          )}
          {listing.folders.map((f) => (
            <button key={f} className="folder" onDoubleClick={() => open(`${listing.path}/${f}`)} onClick={() => open(`${listing.path}/${f}`)}>
              <Icon name="folder" /> {f}
            </button>
          ))}
          {listing.folders.length === 0 && <p className="muted pad">No subfolders.</p>}
        </div>
      )}
      <div className="modal-foot">
        <span className="muted">
          {listing ? `${listing.photos} photo${listing.photos === 1 ? '' : 's'} directly in this folder · subfolders included` : ''}
        </span>
        <div className="row">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={choose} disabled={!listing}>{action}</button>
        </div>
      </div>
    </Modal>
  );
}
