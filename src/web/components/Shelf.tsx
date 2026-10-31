import { useCallback, useEffect, useState } from 'react';
import { api, isBrowserBackend, shelfPreviewUrl, type LinkedFolder, type ShelfFolder, type ShelfListing } from '../api';
import { useEditor } from '../store';
import { FolderPicker } from './FolderPicker';
import { Icon } from './Icon';

const OPEN_KEY = 'photobook:shelfOpen';

/** Home folder shown as ~ (macOS paths); the web version's folder references as plain names. */
export const tildePath = (p: string) => p.replace(/^\/Users\/[^/]+(?=\/|$)/, '~').replace(/^(dir|pick):[\w-]+:/, '');

const inside = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);

/**
 * The Shelf: subfolders of one shared folder (where Background Studio sorts and cuts out to),
 * offered in every book. Linking one imports it and keeps it in sync.
 */
export function Shelf() {
  const links = useEditor((s) => s.links);
  const syncing = useEditor((s) => s.syncing);
  const job = useEditor((s) => s.importJob);
  const busy = !!job && (job.status === 'scanning' || job.status === 'running');
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [listing, setListing] = useState<ShelfListing | null>(null);
  const [path, setPath] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(async (p?: string) => {
    try {
      setListing(await api.shelf(p));
      setError(null);
    } catch (e) {
      // The folder we were in went away: go back to the top of the shelf.
      if (p) return void setPath(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // After a link is added or removed (or its photos change), counts and "Linked" states change too.
  const linkKey = links.map((l) => `${l.folder}:${l.assetIds.length}`).join('|');
  useEffect(() => {
    if (open) void load(path);
  }, [open, path, load, linkKey]);

  // Coming back from another app (Background Studio, Finder): re-read the shelf and the linked folders.
  useEffect(() => {
    const onFocus = () => {
      if (open) void load(path);
      void useEditor.getState().syncLinks();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [open, path, load]);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      // storage unavailable
    }
  };

  const link = (f: ShelfFolder) => void useEditor.getState().startImport(f.path, { link: true });
  const unlink = async (l: LinkedFolder) => {
    await useEditor.getState().unlinkFolder(l.folder);
    useEditor.getState().toast('success', `Stopped syncing ${l.name}. Its photos stay in the library.`);
  };

  const offShelf = listing ? links.filter((l) => !listing.root || !inside(l.folder, listing.root)) : [];

  // Web version: the shelf is a folder chosen with the browser's picker (Chrome and Edge only).
  const chooseRoot = () => {
    if (!isBrowserBackend) return setChoosing(true);
    void api.web!.pickDirectory().then(async (ref) => {
      if (!ref) return;
      setPath(undefined);
      setListing(await api.setShelfRoot(ref));
    }).catch((e) => useEditor.getState().toast('error', e instanceof Error ? e.message : String(e)));
  };
  const allowAccess = async () => {
    const projectId = useEditor.getState().projectId;
    if (!projectId) return;
    await api.web!.requestFolderAccess(projectId);
    await load(path);
    await useEditor.getState().refreshAssets();
    await useEditor.getState().refreshLinks();
    void useEditor.getState().syncLinks({ force: true });
  };

  return (
    <section className={`shelf ${open ? '' : 'closed'}`}>
      <div className="shelf-head">
        <button className="shelf-toggle" onClick={toggle} aria-expanded={open}>
          <Icon name="down" size={12} />
          <span>Shelf</span>
          {links.length > 0 && <span className="chip-count">{links.length} linked</span>}
        </button>
        {syncing && <span className="muted small shelf-syncing">Checking…</span>}
        {open && (
          <div className="row shelf-tools">
            <button className="icon-btn" title="Check the shelf and linked folders for new photos" disabled={syncing || busy} onClick={() => {
              void load(path);
              void useEditor.getState().syncLinks({ force: true });
            }}>
              <Icon name="rotate" size={14} />
            </button>
            <button className="icon-btn" title="Use a different folder as the shelf" onClick={chooseRoot} hidden={listing?.unsupported}>
              <Icon name="folder" size={14} />
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="shelf-body">
          {error && <div className="notice notice-error">{error}</div>}
          {listing?.unsupported && (
            <p className="muted small shelf-note">
              The Shelf links folders and keeps them in sync, which needs a browser that can keep access to a folder: Chrome or Edge. Here, import photos with Import above.
            </p>
          )}
          {listing?.needsAccess && (
            <div className="shelf-empty">
              <p className="small">The browser needs your permission again to read <strong>{tildePath(listing.root)}</strong>.</p>
              <button className="btn btn-small" onClick={() => void allowAccess()}>Allow access</button>
            </div>
          )}
          {listing && !listing.exists && !listing.unsupported && isBrowserBackend && (
            <div className="shelf-empty">
              <p className="small">Choose a folder as your shelf: its subfolders are offered in every book, ready to link and keep in sync.</p>
              <button className="btn btn-small" onClick={chooseRoot}>Choose a folder…</button>
            </div>
          )}
          {listing && !listing.exists && !isBrowserBackend && (
            <div className="shelf-empty">
              <p className="small">
                Your shelf folder isn't there yet: <code>{tildePath(listing.root)}</code>
              </p>
              <p className="muted small">Point Background Studio's results and sorted copies here, and every book can link them.</p>
              <div className="row">
                <button className="btn btn-small" onClick={async () => setListing(await api.createShelf())}>Create it</button>
                <button className="btn btn-small btn-ghost" onClick={chooseRoot}>Use another folder…</button>
              </div>
            </div>
          )}
          {listing?.exists && !listing.needsAccess && (
            <>
              <div className="shelf-path muted small" title={listing.path}>
                {listing.parent ? (
                  <button className="link" onClick={() => setPath(listing.parent === listing.root ? undefined : listing.parent!)}>
                    <Icon name="left" size={11} /> Back
                  </button>
                ) : null}
                <span className="ellipsis">{tildePath(listing.path)}</span>
              </div>
              {listing.folders.length === 0 && (
                <p className="muted small shelf-note">
                  {listing.parent ? 'No folders in here.' : 'Nothing on the shelf yet. Folders you add here (sorted copies, cutouts) show up in every book.'}
                </p>
              )}
              <ul className="shelf-list">
                {listing.folders.map((f) => (
                  <ShelfRow key={f.path} folder={f} links={links} busy={busy} onOpen={() => setPath(f.path)} onLink={() => link(f)} onUnlink={unlink} />
                ))}
              </ul>
              {listing.parent && listing.loosePhotos > 0 && (
                <p className="muted small shelf-note">
                  {listing.loosePhotos} photo{listing.loosePhotos === 1 ? '' : 's'} directly in this folder.{' '}
                  {!links.some((l) => inside(listing.path, l.folder)) && (
                    <button className="link" disabled={busy} onClick={() => void useEditor.getState().startImport(listing.path, { link: true })}>Link this whole folder</button>
                  )}
                </p>
              )}
            </>
          )}
          {offShelf.length > 0 && (
            <div className="shelf-elsewhere">
              <span className="muted small">Also linked</span>
              {offShelf.map((l) => (
                <span key={l.folder} className={`shelf-tag ${l.exists && !l.needsAccess ? '' : 'shelf-tag-missing'}`} title={l.needsAccess ? `Needs permission again: ${tildePath(l.folder)}` : l.exists ? tildePath(l.folder) : `Not found: ${tildePath(l.folder)}`}>
                  {l.name}
                  <button className="icon-btn" title="Stop syncing (photos stay in the library)" onClick={() => void unlink(l)}><Icon name="x" size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {choosing && (
        <FolderPicker
          title="Choose your shelf folder"
          action="Use as shelf"
          onCancel={() => setChoosing(false)}
          onChoose={async (root) => {
            setChoosing(false);
            try {
              setPath(undefined);
              setListing(await api.setShelfRoot(root));
            } catch (e) {
              useEditor.getState().toast('error', e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </section>
  );
}

function ShelfRow({ folder, links, busy, onOpen, onLink, onUnlink }: {
  folder: ShelfFolder;
  links: LinkedFolder[];
  busy: boolean;
  onOpen: () => void;
  onLink: () => void;
  onUnlink: (l: LinkedFolder) => void;
}) {
  const own = links.find((l) => l.folder === folder.path);
  const parent = own ? undefined : links.find((l) => inside(folder.path, l.folder));
  const canOpen = folder.subfolders > 0;
  const detail = [`${folder.photos} photo${folder.photos === 1 ? '' : 's'}`, folder.subfolders ? `${folder.subfolders} folder${folder.subfolders === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  return (
    <li className={`shelf-row ${own || parent ? 'shelf-row-linked' : ''}`}>
      <button className="shelf-row-main" onClick={canOpen ? onOpen : undefined} disabled={!canOpen} title={canOpen ? `Open ${folder.name}` : tildePath(folder.path)}>
        <span className="shelf-thumbs">
          {folder.previews.length ? folder.previews.map((p) => <img key={p} src={shelfPreviewUrl(p)} alt="" loading="lazy" draggable={false} />) : <Icon name="folder" size={18} />}
        </span>
        <span className="shelf-row-text">
          <strong className="ellipsis">{folder.name}</strong>
          <span className="muted small ellipsis">{detail}</span>
        </span>
        {canOpen && <Icon name="right" size={12} />}
      </button>
      {own ? (
        <span className="shelf-linked" title={`In this book's library, kept in sync (${own.assetIds.length} photos)`}>
          <Icon name="check" size={12} /> Linked
          <button className="icon-btn" title="Stop syncing (photos stay in the library)" onClick={() => onUnlink(own)}><Icon name="x" size={11} /></button>
        </span>
      ) : parent ? (
        <span className="muted small" title={`Linked through ${parent.name}`}>Via {parent.name}</span>
      ) : (
        <button className="btn btn-small" disabled={busy || folder.photos === 0} onClick={onLink} title="Add these photos to this book and keep the folder in sync">
          <Icon name="plus" size={12} /> Link
        </button>
      )}
    </li>
  );
}
