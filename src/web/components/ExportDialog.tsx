import { useState } from 'react';
import { binding, coverGeometry, issueCounts, printablePages, printer, updateSettings, type BleedMode } from '../../core';
import { api, type ExportResponse, type FileVerification } from '../api';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { usePreflight } from './PreflightPanel';

const inch = (mm: number) => (mm / 25.4).toFixed(3).replace(/\.?0+$/, '');

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const projectId = useEditor((s) => s.projectId)!;
  const issues = usePreflight();
  const counts = issueCounts(issues);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = doc.settings;
  const pr = printer(s.printerId);
  const pages = printablePages(doc).length;
  const pageW = s.trimWidthMm + s.bleedMm * (s.bleedMode === 'all' ? 2 : 1);
  const pageH = s.trimHeightMm + s.bleedMm * 2;
  const cg = doc.cover ? coverGeometry(doc) : null;
  const poster = s.product === 'poster';
  const posterW = s.trimWidthMm + 2 * s.bleedMm;
  const posterH = s.trimHeightMm + 2 * s.bleedMm;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.exportPdf(projectId, doc));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={poster ? 'Export print-ready poster' : 'Export print-ready PDFs'} onClose={onClose} wide>
      {poster ? (
        <div className="export-summary">
          <div>
            <span className="muted small">Poster · 1 page</span>
            <strong>{posterW.toFixed(1)} × {posterH.toFixed(1)} mm</strong>
            <span className="muted small">{inch(posterW)} × {inch(posterH)} in incl. {s.bleedMm.toFixed(2)} mm bleed</span>
          </div>
          <div>
            <span className="muted small">Trim</span>
            <strong>{inch(s.trimWidthMm)} × {inch(s.trimHeightMm)} in</strong>
            <span className="muted small">{s.trimWidthMm.toFixed(1)} × {s.trimHeightMm.toFixed(1)} mm</span>
          </div>
        </div>
      ) : (
      <>
      <p className="muted small">
        For <strong>{pr.name} · {binding(s).name}</strong>. {pr.notes}
      </p>
      <div className="export-summary">
        <div>
          <span className="muted small">Interior · {pages} pages</span>
          <strong>{pageW.toFixed(2)} × {pageH.toFixed(2)} mm</strong>
          <span className="muted small">{inch(pageW)} × {inch(pageH)} in per page, incl. bleed</span>
        </div>
        <div>
          <span className="muted small">Cover · 1 page</span>
          {cg ? (
            <>
              <strong>{(cg.width + 2 * cg.bleed).toFixed(2)} × {(cg.height + 2 * cg.bleed).toFixed(2)} mm</strong>
              <span className="muted small">{inch(cg.width + 2 * cg.bleed)} × {inch(cg.height + 2 * cg.bleed)} in · spine {cg.spine!.mm.toFixed(2)} mm</span>
            </>
          ) : (
            <span className="warn-text small">No cover yet — open Cover in the filmstrip.</span>
          )}
        </div>
      </div>
      </>
      )}
      {!poster && pr.id === 'custom' && (
        <div className="seg seg-wide">
          {(['all', 'outer'] as BleedMode[]).map((m) => (
            <button key={m} className={s.bleedMode === m ? 'on' : ''} onClick={() => useEditor.getState().run('Bleed mode', (d) => updateSettings(d, { bleedMode: m }))}>
              {m === 'all' ? 'Bleed on all sides' : 'No bleed at the spine'}
            </button>
          ))}
        </div>
      )}

      {(counts.error > 0 || counts.warning > 0) && !result && (
        <div className={`notice ${counts.error ? 'notice-error' : ''}`}>
          <Icon name="alert" /> Preflight found {counts.error} error{counts.error === 1 ? '' : 's'} and {counts.warning} warning{counts.warning === 1 ? '' : 's'}. You can still export — see the Preflight tab.
        </div>
      )}
      {error && <div className="notice notice-error">{error}</div>}

      {result && (
        <div className="export-results">
          <FileCard title={poster ? 'Poster' : 'Interior'} v={result.verification} url={result.url} bytes={result.bytes} extra={result.textOverflow.map((i) => i.message)} />
          {result.cover && (
            <FileCard
              title="Cover"
              v={result.cover.verification}
              url={result.cover.url}
              bytes={result.cover.bytes}
              extra={[`Spine ${result.cover.spineMm.toFixed(2)} mm.`, ...result.cover.textOverflow.map((i) => i.message)]}
            />
          )}
        </div>
      )}

      <div className="modal-foot">
        <span className="muted small">Photos are embedded at up to 300 DPI, sRGB. Files are saved in the app’s data folder on this computer.</span>
        <div className="row">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? 'Exporting…' : result ? 'Export again' : poster ? 'Export PDF' : 'Export PDFs'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FileCard({ title, v, url, bytes, extra }: { title: string; v: FileVerification; url: string; bytes: number; extra: string[] }) {
  return (
    <div className={`export-result ${v.ok ? 'ok' : 'bad'}`}>
      <div className="row">
        <Icon name={v.ok ? 'check' : 'alert'} size={18} />
        <strong>{title} · {v.ok ? 'Verified' : 'Verification failed'}</strong>
      </div>
      <p className="small">
        Re-opened and checked: {v.pageCount} of {v.expectedPageCount} page{v.expectedPageCount === 1 ? '' : 's'}, {v.pageSizeMm.width} × {v.pageSizeMm.height} mm with a {v.trimSizeMm.width} × {v.trimSizeMm.height} mm trim box. {(bytes / 1e6).toFixed(1)} MB.
      </p>
      {v.problems.map((p) => <p key={p} className="small error-text">{p}</p>)}
      {extra.map((p) => <p key={p} className="small muted">{p}</p>)}
      <div className="row">
        <a className="btn btn-small btn-primary" href={url} target="_blank" rel="noreferrer">Open</a>
        <a className="btn btn-small" href={`${url}?download=1`}><Icon name="download" /> Download</a>
      </div>
    </div>
  );
}
