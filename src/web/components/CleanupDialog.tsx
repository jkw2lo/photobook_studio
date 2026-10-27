import { useMemo, useState } from 'react';
import { cleanupSuggestions, type PhotoAsset } from '../../core';
import { thumbUrl } from '../api';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { Modal } from './Modal';

// Library clean-up: near-identical shots side by side with a suggested keeper, plus blurry or badly
// exposed photos and exact duplicates. Click a photo to keep or hide it; nothing changes until you
// apply. Hiding only keeps photos out of automatic drafts — photos already on pages stay there.

type Tab = 'similar' | 'weak' | 'dups';

export function CleanupDialog({ onClose, usage }: { onClose: () => void; usage: Map<string, number> }) {
  const assets = useEditor((s) => s.assets);
  const assetMap = useEditor((s) => s.assetMap);
  const sug = useMemo(() => cleanupSuggestions(assets), [assets]);
  const [tab, setTab] = useState<Tab>(sug.groups.length ? 'similar' : sug.weak.length ? 'weak' : 'dups');
  // Suggested decision for every photo shown: keepers and favourites kept, the rest hidden.
  const [hide, setHide] = useState<Set<string>>(() => {
    const h = new Set<string>();
    for (const g of sug.groups) for (const id of g.ids) if (id !== g.keeperId && !assetMap.get(id)?.favorite) h.add(id);
    for (const id of [...sug.weak, ...sug.exactDuplicates]) h.add(id);
    // Photos already hidden stay hidden unless you un-hide them here.
    for (const a of assets) if (a.excluded) h.add(a.id);
    return h;
  });
  const [busy, setBusy] = useState(false);
  const reviewed = useMemo(() => new Set([...sug.groups.flatMap((g) => g.ids), ...sug.weak, ...sug.exactDuplicates]), [sug]);
  const changes = [...reviewed].filter((id) => hide.has(id) !== !!assetMap.get(id)?.excluded);
  const toHide = changes.filter((id) => hide.has(id)).length;
  const toShow = changes.length - toHide;

  const toggle = (id: string) => setHide((h) => {
    const n = new Set(h);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const keepOnly = (ids: string[], keep: string) => setHide((h) => {
    const n = new Set(h);
    for (const id of ids) {
      if (id === keep) n.delete(id);
      else n.add(id);
    }
    return n;
  });

  const apply = async () => {
    setBusy(true);
    const st = useEditor.getState();
    try {
      for (let i = 0; i < changes.length; i += 8) {
        await Promise.all(changes.slice(i, i + 8).map((id) => st.patchAsset(id, { excluded: hide.has(id) })));
      }
      st.toast('success', `${toHide ? `Hid ${toHide} photo${toHide === 1 ? '' : 's'}` : ''}${toHide && toShow ? ' · ' : ''}${toShow ? `brought back ${toShow}` : ''}. Hidden photos stay in the library (Hidden filter) and on any page they are already on.`);
      onClose();
    } catch (e) {
      st.toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const card = (id: string, extra?: { keeper?: boolean; group?: string[] }) => {
    const a = assetMap.get(id);
    if (!a) return null;
    return <PhotoCard key={id} asset={a} hidden={hide.has(id)} keeper={extra?.keeper} used={usage.get(id) ?? 0} flags={sug.flags.get(id)} quality={sug.quality.get(id)} onToggle={() => toggle(id)} onKeepOnly={extra?.group ? () => keepOnly(extra.group!, id) : undefined} />;
  };

  return (
    <Modal title="Clean up the library" onClose={onClose} wide>
      <div className="seg seg-wide cleanup-tabs">
        <button className={tab === 'similar' ? 'on' : ''} onClick={() => setTab('similar')}>Similar shots ({sug.groups.length})</button>
        <button className={tab === 'weak' ? 'on' : ''} onClick={() => setTab('weak')}>Blurry or badly exposed ({sug.weak.length})</button>
        <button className={tab === 'dups' ? 'on' : ''} onClick={() => setTab('dups')}>Exact duplicates ({sug.exactDuplicates.length})</button>
      </div>
      <div className="cleanup-body">
        {tab === 'similar' && (
          sug.groups.length ? sug.groups.map((g, i) => (
            <div key={g.ids.join()} className="cleanup-group">
              <div className="row between">
                <span className="small">Group {i + 1} · {g.ids.length} shots</span>
                <button className="link small" onClick={() => keepOnly(g.ids, g.keeperId)}>Keep the suggested one</button>
              </div>
              <div className="cleanup-row">{g.ids.map((id) => card(id, { keeper: id === g.keeperId, group: g.ids }))}</div>
            </div>
          )) : <p className="muted">No near-identical shots — nice.</p>
        )}
        {tab === 'weak' && (sug.weak.length ? <div className="cleanup-grid">{sug.weak.map((id) => card(id))}</div> : <p className="muted">Nothing looks blurry or badly exposed.</p>)}
        {tab === 'dups' && (sug.exactDuplicates.length ? <div className="cleanup-grid">{sug.exactDuplicates.map((id) => card(id))}</div> : <p className="muted">No exact duplicates.</p>)}
      </div>
      <div className="modal-foot">
        <span className="muted small">Click a photo to keep or hide it. The star marks the suggested keeper (sharpest, best exposed; favourites always kept). Hidden photos are left out of drafts but stay in the library and on pages.</span>
        <div className="row">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !changes.length} onClick={() => void apply()}>
            {busy ? 'Applying…' : !changes.length ? 'Nothing to change' : [toHide && `Hide ${toHide}`, toShow && `Bring back ${toShow}`].filter(Boolean).join(' · ')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PhotoCard({ asset, hidden, keeper, used, flags, quality, onToggle, onKeepOnly }: {
  asset: PhotoAsset; hidden: boolean; keeper?: boolean; used: number; flags?: { blurry: boolean; dark: boolean; bright: boolean; lowRes: boolean }; quality?: number;
  onToggle: () => void; onKeepOnly?: () => void;
}) {
  return (
    <div className={`cleanup-card ${hidden ? 'is-hidden' : ''} ${keeper ? 'is-keeper' : ''}`}>
      <button className="cleanup-thumb" onClick={onToggle} title={hidden ? 'Hidden — click to keep' : 'Kept — click to hide'}>
        <img src={thumbUrl(asset.id, 'm')} alt={asset.fileName} loading="lazy" />
        <span className="cleanup-state">{hidden ? <><Icon name="eye-off" size={13} /> Hide</> : <><Icon name="check" size={13} /> Keep</>}</span>
        {keeper && <span className="cleanup-star" title="Suggested keeper"><Icon name="star" size={13} /></span>}
      </button>
      <div className="cleanup-meta">
        <span className="ellipsis small" title={asset.fileName}>{asset.fileName}</span>
        <div className="cleanup-badges">
          {asset.favorite && <span className="badge">★ favourite</span>}
          {used > 0 && <span className="badge badge-used">In book</span>}
          {flags?.blurry && <span className="badge badge-warn">Blurry</span>}
          {flags?.dark && <span className="badge badge-warn">Dark</span>}
          {flags?.bright && <span className="badge badge-warn">Too bright</span>}
          {flags?.lowRes && <span className="badge badge-warn">Low res</span>}
          {quality !== undefined && <span className="badge" title="Sharpness, exposure and resolution, compared with the rest of the library">Quality {Math.round(quality * 100)}</span>}
        </div>
        {onKeepOnly && <button className="link small" onClick={onKeepOnly}>Keep only this one</button>}
      </div>
    </div>
  );
}
