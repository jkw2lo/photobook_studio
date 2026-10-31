import { useRef, useState } from 'react';
import { api } from '../api';
import type { FolderPickerProps } from './FolderPicker';
import { Icon } from './Icon';
import { Modal } from './Modal';

const PHOTO = /\.(jpe?g|png|heic|heif|webp)$/i;

/**
 * The web version's folder picker. Chrome and Edge can keep access to a folder (photos are read in
 * place, and the folder can stay linked); elsewhere the browser hands over the files once and they
 * are copied into its storage.
 */
export function BrowserFolderPicker({ title, action, offerLink, onChoose, onCancel }: FolderPickerProps) {
  const web = api.web!;
  const [chosen, setChosen] = useState<{ ref: string; name: string; photos: number | null; copied: boolean } | null>(null);
  const [link, setLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const pickDirectory = async () => {
    setError(null);
    try {
      const ref = await web.pickDirectory();
      if (ref) setChosen({ ref, name: ref.replace(/^dir:[\w-]+:/, ''), photos: null, copied: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    const ref = web.registerFiles(files);
    setChosen({ ref, name: ref.replace(/^pick:[\w-]+:/, ''), photos: files.filter((f) => PHOTO.test(f.name)).length, copied: true });
    setLink(false);
  };

  return (
    <Modal title={title} onClose={onCancel} wide>
      <div className="web-picker">
        {web.canPickDirectories ? (
          <>
            <button className="btn btn-primary" onClick={() => void pickDirectory()}><Icon name="folder" /> Choose a folder…</button>
            <p className="muted small">Photos stay in their folder; the browser lets Photobook Studio read it. After you restart the browser it asks for permission again.</p>
            <p className="muted small">
              Or copy photos into this browser instead:{' '}
              <button className="link" onClick={() => dirInput.current?.click()}>a folder</button> ·{' '}
              <button className="link" onClick={() => filesInput.current?.click()}>some photos</button>
            </p>
          </>
        ) : (
          <>
            <div className="row">
              <button className="btn btn-primary" onClick={() => dirInput.current?.click()}><Icon name="folder" /> Choose a folder…</button>
              <button className="btn" onClick={() => filesInput.current?.click()}>Choose photos…</button>
            </div>
            <p className="muted small">This browser can’t keep access to a folder, so the photos are copied into its storage on this device. Nothing is uploaded. In Chrome or Edge, photos can stay in their folder instead.</p>
          </>
        )}
        <input ref={dirInput} type="file" hidden multiple aria-label="Folder to copy in" {...{ webkitdirectory: '', directory: '' }} onChange={(e) => onFiles(e.target.files)} />
        <input ref={filesInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Photos to copy in" onChange={(e) => onFiles(e.target.files)} />
        {error && <div className="notice notice-error">{error}</div>}
        {chosen && (
          <div className="notice">
            <Icon name="folder" />
            <span>
              <strong>{chosen.name}</strong>
              {chosen.photos !== null && ` · ${chosen.photos} photo${chosen.photos === 1 ? '' : 's'}`}
              {chosen.copied ? ' · will be copied into this browser' : ' · read in place, subfolders included'}
            </span>
          </div>
        )}
        {offerLink && chosen && !chosen.copied && (
          <label className="field check folder-link">
            <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} />
            <span>Keep linked: photos added to this folder later join the library, and deleted ones leave it</span>
          </label>
        )}
        <p className="muted small">HEIC photos open in Safari only; elsewhere, convert them to JPEG first.</p>
      </div>
      <div className="modal-foot">
        <span />
        <div className="row">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => chosen && onChoose(chosen.ref, link)} disabled={!chosen}>{action}</button>
        </div>
      </div>
    </Modal>
  );
}
