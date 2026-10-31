import { useEffect, useRef, useState } from 'react';
import { api, type StorageInfo } from '../api';
import { Icon } from './Icon';

const OPEN_KEY = 'photobook:webNotesOpen';
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(n / 1e6))} MB`);

/** Web version: how it differs from the local app, where the data lives, and how to keep it safe. */
export function WebNotes({ onRestored }: { onRestored: () => void }) {
  const web = api.web!;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const refresh = () => void web.storage().then(setStorage, () => undefined);
  useEffect(refresh, [web]);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      // storage unavailable
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    setStatus({ kind: 'ok', text: `Restoring ${file.name}…` });
    try {
      const r = await web.restoreBackup(file);
      setStatus({ kind: 'ok', text: `Restored “${r.title}” with ${r.photos} photo${r.photos === 1 ? '' : 's'}.` });
      onRestored();
      refresh();
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const folders = web.canPickDirectories;
  return (
    <section className={`web-notes ${open ? '' : 'closed'}`}>
      <div className="row between">
        <button className="shelf-toggle" onClick={toggle} aria-expanded={open}>
          <Icon name="down" size={12} />
          <span>Web version — how it works here</span>
        </button>
        <div className="row">
          <button className="btn btn-small" onClick={() => restoreInput.current?.click()}><Icon name="upload" /> Restore from backup…</button>
          <input ref={restoreInput} type="file" hidden accept=".photobook,application/octet-stream" aria-label="Backup file to restore" onChange={(e) => {
            void restore(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </div>
      </div>
      {status && <div className={`notice ${status.kind === 'error' ? 'notice-error' : ''}`}>{status.text}</div>}
      {open && (
        <div className="web-notes-body">
          <p>
            Photobook Studio runs entirely in this browser. Books, thumbnails and imported photos are stored here, on this device; nothing is uploaded and there is no account.
          </p>
          <ul>
            <li>
              <strong>Folders.</strong>{' '}
              {folders
                ? 'This browser can read a folder in place: photos stay where they are, and folders can be linked and kept in sync from the Shelf. After a browser restart it asks for permission again.'
                : 'This browser copies imported photos into its storage (they stay on this device). Linked folders and the Shelf need Chrome or Edge.'}
            </li>
            <li><strong>HEIC photos</strong> open in Safari only. In other browsers, convert them to JPEG first.</li>
            <li>
              <strong>Storage.</strong>{' '}
              {storage ? (
                <>
                  Using {mb(storage.usageBytes)}{storage.quotaBytes ? ` of about ${mb(storage.quotaBytes)} available` : ''}.{' '}
                  {storage.persisted
                    ? 'The browser has agreed to keep this data.'
                    : <>The browser may clear it if the device runs low on space, or when you clear site data. <button className="link" onClick={() => void web.persist().then(refresh)}>Ask the browser to keep it</button></>}
                </>
              ) : 'Kept in this browser’s site data.'}{' '}
              Back up books you care about: the <Icon name="download" size={12} /> button on each book saves one file with its pages and photos.
            </li>
            <li><strong>Exports</strong> (print PDFs, poster images, the flipbook) are made in the browser and downloaded; big books take a while and need memory.</li>
            <li>Not in the web version: the Mac app launcher and updates, and folder paths typed by hand. For those, run Photobook Studio locally (see the project’s README).</li>
          </ul>
        </div>
      )}
    </section>
  );
}

/** Save a project as one backup file (web version). */
export async function downloadBackup(projectId: string): Promise<string> {
  const r = await api.web!.backupProject(projectId);
  const a = document.createElement('a');
  a.href = r.url;
  a.download = r.file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(r.url), 60_000);
  const size = r.bytes >= 1e9 ? `${(r.bytes / 1e9).toFixed(1)} GB` : `${(r.bytes / 1e6).toFixed(1)} MB`;
  return `Saved ${r.file} (${size}, ${r.photos} photo${r.photos === 1 ? '' : 's'})${r.withoutOriginal ? `. ${r.withoutOriginal} original${r.withoutOriginal === 1 ? '' : 's'} couldn’t be read and only their thumbnails are included` : ''}.`;
}
