import { memo, useMemo, useState } from 'react';
import { chronological, groupSimilar, type BookDocument, type ImageElement, type PhotoAsset } from '../../core';
import { api, thumbUrl, type LinkedFolder } from '../api';
import { useEditor } from '../store';
import { ASSET_MIME } from './Canvas';
import { FolderPicker } from './FolderPicker';
import { Icon } from './Icon';
import { CleanupDialog } from './CleanupDialog';
import { Modal } from './Modal';
import { Shelf, tildePath } from './Shelf';

type Filter = 'all' | 'unused' | 'favorites' | 'hidden' | 'issues' | `link:${string}`;

export function Library() {
  const assets = useEditor((s) => s.assets);
  // Subscribe to which photos are used (a string key), not to the whole document.
  const usageKey = useEditor((s) => (s.doc ? usageKeyOf(s.doc) : ''));
  const job = useEditor((s) => s.importJob);
  const projectId = useEditor((s) => s.projectId)!;
  const links = useEditor((s) => s.links);
  const [filter, setFilter] = useState<Filter>('all');
  const [picker, setPicker] = useState<'import' | 'relink' | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const [removing, setRemoving] = useState(false);
  const syncing = useEditor((s) => s.syncing);
  const previewId = useEditor((s) => s.previewAssetId);

  const usage = useMemo(() => parseUsage(usageKey), [usageKey]);

  // Near-duplicate groups (same rule the generator uses), for the "similar" badge.
  const similarCount = useMemo(() => {
    const g = groupSimilar(assets);
    const sizes = new Map<string, number>();
    for (const id of g.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
    return new Map(assets.map((a) => [a.id, sizes.get(g.get(a.id)!) ?? 1]));
  }, [assets]);

  const missing = assets.filter((a) => a.missing).length;
  const ordered = useMemo(() => chronological(assets), [assets]);
  const linkFilter = filter.startsWith('link:') ? links.find((l) => `link:${l.folder}` === filter) : undefined;
  const fromLink = useMemo(() => new Set(linkFilter?.assetIds ?? []), [linkFilter]);
  // Exact copies of another photo are shown once (the original); Issues lists the copies.
  const isCopy = (a: PhotoAsset) => !!a.exactDuplicateOf && !usage.has(a.id);
  const matches = (a: PhotoAsset, f: Filter) => {
    if (f === 'issues') return a.missing || !!a.exactDuplicateOf;
    if (isCopy(a)) return false;
    if (f.startsWith('link:')) return fromLink.has(a.id);
    if (f === 'unused') return !usage.has(a.id) && !a.excluded;
    if (f === 'favorites') return a.favorite;
    if (f === 'hidden') return a.excluded;
    return true;
  };
  const visible = ordered.filter((a) => matches(a, filter));

  const counts = Object.fromEntries((['all', 'unused', 'favorites', 'hidden', 'issues'] as const).map((f) => [f, assets.filter((a) => matches(a, f)).length])) as Record<'all' | 'unused' | 'favorites' | 'hidden' | 'issues', number>;

  const running = job && (job.status === 'scanning' || job.status === 'running');
  // What "Remove" takes out: everything (copies included) for All or a folder, else what's shown.
  const removeIds = filter === 'all' ? assets.map((a) => a.id) : linkFilter ? [...fromLink] : visible.map((a) => a.id);
  const refreshAll = () => void useEditor.getState().syncLinks({ folders: links.filter((l) => l.exists).map((l) => l.folder) });

  return (
    <aside className="library">
      <div className="panel-head">
        <h2>Library</h2>
        <div className="row">
          {assets.length > 1 && (
            <button className="btn btn-small btn-ghost" onClick={() => setCleanup(true)} title="Review similar shots, blurry photos and duplicates">
              <Icon name="sparkle" /> Clean up
            </button>
          )}
          {links.length > 0 && (
            <button className="icon-btn" onClick={refreshAll} disabled={!!running || syncing} title="Refresh: look for new or deleted photos in every folder this library came from">
              <Icon name="rotate" size={14} />
            </button>
          )}
          <button className="btn btn-small" onClick={() => setPicker('import')} disabled={!!running}>
            <Icon name="plus" /> Import
          </button>
        </div>
      </div>
      {job && (
        <div className="import-progress">
          <div className="import-progress-label">
            {job.status === 'scanning' ? 'Scanning folder…' : job.status === 'running' ? `Checking ${job.processed} / ${job.total}` : `Done — ${job.imported} new${job.alreadyInLibrary ? `, ${job.alreadyInLibrary} already here` : ''}${job.exactDuplicates ? `, ${job.exactDuplicates} duplicate${job.exactDuplicates === 1 ? '' : 's'} skipped` : ''}`}
          </div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${job.total ? (job.processed / job.total) * 100 : 5}%` }} />
          </div>
        </div>
      )}
      <Shelf />
      {missing > 0 && (
        <div className="notice notice-error">
          {missing} original{missing > 1 ? 's' : ''} missing.{' '}
          <button className="link" onClick={() => setPicker('relink')}>Relink…</button>
        </div>
      )}
      <div className="filters">
        {(['all', 'unused', 'favorites', 'hidden', 'issues'] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? 'chip-on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'favorites' ? '★' : f[0].toUpperCase() + f.slice(1)} <span className="chip-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      {links.length > 0 && (
        <div className="filters filters-links">
          <span className="muted small">From</span>
          {links.map((l) => (
            <button
              key={l.folder}
              className={`chip ${filter === `link:${l.folder}` ? 'chip-on' : ''} ${l.exists ? '' : 'chip-missing'}`}
              title={l.exists ? `${tildePath(l.folder)} · ${l.auto ? 'linked: kept in sync' : 'imported: refresh to pick up changes'}` : `Folder not found: ${tildePath(l.folder)}`}
              onClick={() => setFilter(filter === `link:${l.folder}` ? 'all' : `link:${l.folder}`)}
            >
              {l.name} <span className="chip-count">{l.assetIds.length}</span>
            </button>
          ))}
        </div>
      )}
      {linkFilter && (
        <div className="folder-bar">
          <span className="muted small ellipsis" title={linkFilter.folder}>{tildePath(linkFilter.folder)} · {linkFilter.auto ? 'linked' : 'imported'}</span>
          <div className="row">
            <button className="link small" disabled={!linkFilter.exists || !!running || syncing} onClick={() => void useEditor.getState().syncLinks({ folders: [linkFilter.folder] })} title="Add new photos from this folder and drop deleted ones">
              Refresh
            </button>
            <button className="link small" title={linkFilter.auto ? 'Stop syncing this folder (its photos stay)' : 'Forget this folder (its photos stay)'} onClick={async () => {
              await useEditor.getState().unlinkFolder(linkFilter.folder);
              setFilter('all');
            }}>
              {linkFilter.auto ? 'Unlink' : 'Forget'}
            </button>
          </div>
        </div>
      )}
      {assets.length > 0 && (
        <div className="library-actions">
          <span className="muted small">{visible.length} shown</span>
          <button className="link small danger" disabled={!removeIds.length || !!running} onClick={() => setRemoving(true)} title={filter === 'all' ? 'Take every photo out of this library' : 'Take these photos out of this library'}>
            {filter === 'all' ? 'Clear library…' : linkFilter ? 'Remove this folder…' : `Remove ${visible.length}…`}
          </button>
        </div>
      )}
      {assets.length === 0 && !running ? (
        <div className="empty">
          <p>No photos yet.</p>
          <p className="muted">Link a folder from the Shelf above, or import any folder. Originals stay where they are; only thumbnails are created, on this computer.</p>
          <button className="btn" onClick={() => setPicker('import')}>Choose a folder…</button>
        </div>
      ) : (
        <div className="grid">
          {visible.map((a) => (
            <Tile key={a.id} asset={a} used={usage.get(a.id) ?? 0} similar={similarCount.get(a.id) ?? 1} previewed={a.id === previewId} />
          ))}
          {visible.length === 0 && <p className="muted pad">Nothing here.</p>}
        </div>
      )}
      <PreviewPane usage={usage} />
      {cleanup && <CleanupDialog usage={usage} onClose={() => setCleanup(false)} />}
      {removing && (
        <RemoveDialog
          ids={removeIds}
          usage={usage}
          scope={filter === 'all' ? 'all' : linkFilter ? 'folder' : 'shown'}
          folders={filter === 'all' ? links : linkFilter ? [linkFilter] : []}
          onClose={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false);
            setFilter('all');
          }}
        />
      )}
      {picker && (
        <FolderPicker
          title={picker === 'import' ? 'Import photos from a folder' : 'Find missing originals'}
          action={picker === 'import' ? 'Import this folder' : 'Search this folder'}
          offerLink={picker === 'import'}
          onCancel={() => setPicker(null)}
          onChoose={async (folder, link) => {
            setPicker(null);
            if (picker === 'import') await useEditor.getState().startImport(folder, { link });
            else {
              const r = await api.relink(projectId, folder);
              await useEditor.getState().refreshAssets();
              useEditor.getState().toast(r.stillMissing ? 'error' : 'success', `Relinked ${r.relinked}. ${r.stillMissing ? `${r.stillMissing} still missing.` : 'All originals found.'}`);
            }
          }}
        />
      )}
    </aside>
  );
}

/**
 * "assetId:count|…" for every photo placed in the book. Moving or cropping a photo changes the
 * document on every pointer move but not this key, so the library doesn't re-render during drags.
 */
function usageKeyOf(doc: BookDocument): string {
  const m = new Map<string, number>();
  const surfaces = doc.cover ? [doc.cover, ...doc.spreads] : doc.spreads;
  for (const s of surfaces) {
    for (const e of s.elements) if (e.type === 'image' && e.assetId) m.set(e.assetId, (m.get(e.assetId) ?? 0) + 1);
    if (s.backgroundImage) m.set(s.backgroundImage.assetId, (m.get(s.backgroundImage.assetId) ?? 0) + 1);
  }
  return [...m].map(([k, v]) => `${k}:${v}`).sort().join('|');
}

function parseUsage(key: string): Map<string, number> {
  return new Map(key ? key.split('|').map((kv) => { const [k, v] = kv.split(':'); return [k, Number(v)] as [string, number]; }) : []);
}

/** Larger view of the clicked (or selected) photo, with its details and quick actions. */
function PreviewPane({ usage }: { usage: Map<string, number> }) {
  const id = useEditor((s) => s.previewAssetId);
  const asset = useEditor((s) => (id ? s.assetMap.get(id) : undefined));
  const patch = useEditor((s) => s.patchAsset);
  const [open, setOpen] = useState(true);
  const used = asset ? usage.get(asset.id) ?? 0 : 0;
  const showInBook = () => {
    const st = useEditor.getState();
    if (!st.doc || !asset) return;
    const surfaces = [...(st.doc.cover ? [{ s: st.doc.cover, i: -1 }] : []), ...st.doc.spreads.map((s, i) => ({ s, i }))];
    const hit = surfaces.find(({ s }) => s.elements.some((e) => e.type === 'image' && e.assetId === asset.id));
    if (!hit) return;
    st.goToSpread(hit.i);
    const el = hit.s.elements.find((e) => e.type === 'image' && e.assetId === asset.id)!;
    st.select({ spreadId: hit.s.id, elementId: el.id });
  };
  return (
    <div className={`preview-pane ${open ? '' : 'closed'}`}>
      <button className="preview-head" onClick={() => setOpen(!open)}>
        <span>Preview</span>
        <Icon name="down" size={12} />
      </button>
      {open && (
        asset ? (
          <div className="preview-body">
            <div className={`preview-img ${asset.analysis?.transparent ? 'checker' : ''}`} draggable={!asset.missing} onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_MIME, asset.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}>
              <img src={thumbUrl(asset.id, 'm')} alt={asset.fileName} draggable={false} />
            </div>
            <div className="preview-meta">
              <strong className="ellipsis" title={asset.fileName}>{asset.fileName}</strong>
              <span className="muted small">{asset.capturedAt ? formatTaken(asset.capturedAt) : 'No capture date'}</span>
              <span className="muted small">{asset.widthPx} × {asset.heightPx} · {((asset.widthPx * asset.heightPx) / 1e6).toFixed(1)} MP{asset.missing ? ' · original missing' : ''}</span>
            </div>
            <div className="row preview-actions">
              <button className={`icon-btn ${asset.favorite ? 'on' : ''}`} title={asset.favorite ? 'Unfavourite' : 'Favourite: always included in drafts'} onClick={() => patch(asset.id, { favorite: !asset.favorite })}><Icon name="star" /></button>
              <button className={`icon-btn ${asset.excluded ? 'on' : ''}`} title={asset.excluded ? 'Include in drafts' : 'Hide from drafts'} onClick={() => patch(asset.id, { excluded: !asset.excluded })}><Icon name={asset.excluded ? 'eye-off' : 'eye'} /></button>
              <button className="icon-btn" disabled={used > 0} title={used > 0 ? 'On a page: take it off the page first' : 'Remove from this library (the original file stays)'} onClick={async () => {
                const st = useEditor.getState();
                const r = await st.removeAssets([asset.id]);
                if (r.removed) st.toast('success', `Removed ${asset.fileName} from the library. Import its folder again to bring it back.`);
              }}><Icon name="trash" /></button>
              {used > 0 ? <button className="link small" onClick={showInBook}>In book{used > 1 ? ` ×${used}` : ''} — show</button> : <span className="muted small">Not in book · drag onto a page</span>}
            </div>
          </div>
        ) : (
          <p className="muted small preview-empty">Click a photo to preview it here. Drag photos onto a frame to replace, or onto empty space to add.</p>
        )
      )}
    </div>
  );
}

/** Confirm taking photos out of the library. Photos on pages stay; folders they came from can be forgotten too. */
function RemoveDialog({ ids, usage, scope, folders, onClose, onDone }: {
  ids: string[];
  usage: Map<string, number>;
  scope: 'all' | 'folder' | 'shown';
  folders: LinkedFolder[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const onPages = ids.filter((id) => usage.has(id)).length;
  const n = ids.length - onPages;
  const title = scope === 'all' ? 'Clear the library' : scope === 'folder' ? `Remove ${folders[0]?.name ?? 'folder'}` : `Remove ${ids.length} photo${ids.length === 1 ? '' : 's'}`;
  const go = async () => {
    setBusy(true);
    const st = useEditor.getState();
    try {
      const r = await st.removeAssets(ids);
      for (const f of folders) await st.unlinkFolder(f.folder);
      st.toast('success', `Removed ${r.removed} photo${r.removed === 1 ? '' : 's'}${r.keptOnPages ? ` · ${r.keptOnPages} on pages kept` : ''}. Original files are untouched.`);
      onDone();
    } catch (e) {
      st.toast('error', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p>
          {n ? `${n} photo${n === 1 ? '' : 's'} will be taken out of this book's library.` : 'Every one of these photos is on a page, so nothing can be removed.'}
          {onPages > 0 && n > 0 && ` ${onPages} on pages stay${onPages === 1 ? 's' : ''}.`}
        </p>
        {folders.length > 0 && (
          <p className="muted small">
            {folders.length === 1 ? `${folders[0].name} is` : `${folders.length} folders are`} forgotten too, so {folders.length === 1 ? 'it isn’t' : 'they aren’t'} read again.
          </p>
        )}
        <p className="muted small">Your original files aren't touched. Import the folder again to bring photos back.</p>
        <div className="row modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger-solid" disabled={busy || (!n && !folders.length)} onClick={() => void go()}>
            {busy ? 'Removing…' : scope === 'all' ? 'Clear library' : 'Remove'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function formatTaken(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const Tile = memo(function Tile({ asset, used, similar, previewed }: { asset: PhotoAsset; used: number; similar: number; previewed: boolean }) {
  const patch = useEditor((s) => s.patchAsset);
  return (
    <div
      className={`tile ${asset.excluded ? 'tile-hidden' : ''} ${used ? 'tile-used' : ''} ${previewed ? 'tile-previewed' : ''} ${asset.analysis?.transparent ? 'checker tile-cutout' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.tile-actions')) return;
        useEditor.setState({ previewAssetId: asset.id });
      }}
      draggable={!asset.missing}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`${asset.fileName}\n${asset.widthPx}×${asset.heightPx}${asset.capturedAt ? `\n${asset.capturedAt.replace('T', ' ')}` : '\nNo capture date'}`}
    >
      <img src={thumbUrl(asset.id)} alt={asset.fileName} loading="lazy" decoding="async" draggable={false} />
      <div className="tile-badges">
        {used > 0 && <span className="badge badge-used">{used > 1 ? `×${used}` : 'In book'}</span>}
        {asset.exactDuplicateOf && <span className="badge badge-warn">Duplicate</span>}
        {asset.analysis?.transparent && <span className="badge" title="Has transparency: whatever is behind it shows through">Cutout</span>}
        {!asset.exactDuplicateOf && similar > 1 && <span className="badge">Similar ×{similar}</span>}
        {asset.missing && <span className="badge badge-error">Missing</span>}
      </div>
      <div className="tile-actions">
        <button className={`icon-btn ${asset.favorite ? 'on' : ''}`} title={asset.favorite ? 'Unfavourite' : 'Favourite: always included in drafts'} onClick={() => patch(asset.id, { favorite: !asset.favorite })}>
          <Icon name="star" />
        </button>
        <button className={`icon-btn ${asset.excluded ? 'on' : ''}`} title={asset.excluded ? 'Include in drafts' : 'Hide from drafts'} onClick={() => patch(asset.id, { excluded: !asset.excluded })}>
          <Icon name={asset.excluded ? 'eye-off' : 'eye'} />
        </button>
      </div>
    </div>
  );
});

export type { BookDocument, ImageElement };
