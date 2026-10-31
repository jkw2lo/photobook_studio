import { useEffect, useState } from 'react';
import { api, isBrowserBackend, type FolderListing } from '../api';
import { BrowserFolderPicker } from './BrowserFolderPicker';
import { Icon } from './Icon';
import { Modal } from './Modal';

export interface FolderPickerProps {
  title: string;
  action: string;
  /** Offer "keep linked" (sync the folder with the library from now on). */
  offerLink?: boolean;
  onChoose: (path: string, link: boolean) => void;
  onCancel: () => void;
}

/** Choose a folder: through the local server, or (web version) with the browser's own picker. */
export const FolderPicker = isBrowserBackend ? BrowserFolderPicker : ServerFolderPicker;

/** Browse local folders through the local server (the browser cannot expose real paths itself). */
function ServerFolderPicker({ title, action, offerLink, onChoose, onCancel }: FolderPickerProps) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [link, setLink] = useState(false);
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
    onChoose(path, offerLink ? link : false);
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
      {offerLink && (
        <label className="field check folder-link">
          <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
          <span>Keep linked: photos added to this folder later join the library, and deleted ones leave it</span>
        </label>
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
