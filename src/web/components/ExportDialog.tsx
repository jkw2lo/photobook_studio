import { useEffect, useState } from 'react';
import { binding, coverGeometry, issueCounts, printablePages, printer, updateSettings, type BleedMode } from '../../core';
import { api, type ExportResponse, type FileVerification, type FlipbookResponse, type ImageExportResponse } from '../api';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { usePreflight } from './PreflightPanel';

const inch = (mm: number) => (mm / 25.4).toFixed(3).replace(/\.?0+$/, '');

type Quality = 'share' | 'good' | 'best';
const QUALITIES: { id: Quality; label: string; hint: string; dpi: number }[] = [
  { id: 'share', label: 'Sharing', hint: 'Smallest files — for email, messages and screens', dpi: 150 },
  { id: 'good', label: 'Good', hint: 'Decent quality at a sensible size — home printing, drafts', dpi: 220 },
  { id: 'best', label: 'Best', hint: 'Highest quality — for the print shop', dpi: 300 },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const projectId = useEditor((s) => s.projectId)!;
  const issues = usePreflight();
  const counts = issueCounts(issues);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>('best');
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
      setResult(await api.exportPdf(projectId, doc, undefined, quality));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={poster ? 'Export print-ready poster' : 'Export print-ready PDFs'} onClose={onClose} wide>
      <div className="field export-quality">
        <span>Quality</span>
        <div className="seg seg-wide" role="radiogroup" aria-label="Export quality">
          {QUALITIES.map((q) => (
            <button key={q.id} role="radio" aria-checked={quality === q.id} className={quality === q.id ? 'on' : ''} title={q.hint} onClick={() => { setQuality(q.id); setResult(null); }}>{q.label}</button>
          ))}
        </div>
        <span className="muted small">{QUALITIES.find((q) => q.id === quality)!.hint}. Sets the PDF and the {poster ? 'image' : 'flipbook'} options below; you can still change those.</span>
      </div>
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

      {poster ? <ImageExport quality={quality} /> : <FlipbookExport quality={quality} />}

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
        <span className="muted small">Photos are embedded at up to {QUALITIES.find((q) => q.id === quality)!.dpi} DPI, sRGB{quality === 'share' ? ', compressed for a small file' : ''}. Files are saved in the app’s data folder on this computer.</span>
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

/** Poster as a PNG or JPEG: for sharing, or printing at home. */
function ImageExport({ quality }: { quality: Quality }) {
  const doc = useEditor((s) => s.doc)!;
  const projectId = useEditor((s) => s.projectId)!;
  const [format, setFormat] = useState<'png' | 'jpeg'>('jpeg');
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImageExportResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = doc.settings;
  const px = (mm: number, d: number) => Math.round((mm / 25.4) * d);
  // "Screen" = about 2400 px on the long edge, whatever the poster size.
  const screenDpi = Math.round(2400 / (Math.max(s.trimWidthMm, s.trimHeightMm) / 25.4));
  // The quality choice above sets a sensible format and size; both stay changeable here.
  useEffect(() => {
    setFormat(quality === 'best' ? 'png' : 'jpeg');
    setDpi(quality === 'share' ? screenDpi : quality === 'good' ? 150 : 300);
    setRes(null);
  }, [quality, screenDpi]);
  const sizes = [
    { label: 'Screen', dpi: screenDpi, hint: 'for sharing' },
    { label: '150 DPI', dpi: 150, hint: 'home printing' },
    { label: '300 DPI', dpi: 300, hint: 'best quality' },
  ];
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.exportImage(projectId, doc, format, dpi));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-export">
      <div className="row between">
        <strong>Image</strong>
        <span className="muted small">{px(s.trimWidthMm, dpi)} × {px(s.trimHeightMm, dpi)} px · trimmed, no bleed</span>
      </div>
      <div className="field-row">
        <div className="seg">
          {(['jpeg', 'png'] as const).map((f) => <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>{f === 'jpeg' ? 'JPEG' : 'PNG'}</button>)}
        </div>
        <div className="seg seg-wide">
          {sizes.map((z) => <button key={z.label} className={dpi === z.dpi ? 'on' : ''} title={z.hint} onClick={() => setDpi(z.dpi)}>{z.label}</button>)}
        </div>
        <button className="btn btn-small" onClick={() => void go()} disabled={busy}>{busy ? 'Rendering…' : 'Export image'}</button>
      </div>
      {err && <div className="notice notice-error small">{err}</div>}
      {res && (
        <div className="row">
          <Icon name="check" size={16} />
          <span className="small">{res.format.toUpperCase()} · {res.widthPx} × {res.heightPx} px · {res.dpi} DPI · {(res.bytes / 1e6).toFixed(1)} MB</span>
          <a className="btn btn-small" href={res.url} target="_blank" rel="noreferrer">Open</a>
          <a className="btn btn-small btn-primary" href={`${res.url}?download=1`}><Icon name="download" /> Download</a>
        </div>
      )}
      <p className="muted small">JPEG is smaller and fine for sharing; PNG is lossless. For a print shop, use the PDF.</p>
    </div>
  );
}

/** Book as a web flipbook: one HTML file to send or put online, with page turns. */
function FlipbookExport({ quality }: { quality: Quality }) {
  const doc = useEditor((s) => s.doc)!;
  const projectId = useEditor((s) => s.projectId)!;
  const [size, setSize] = useState<'standard' | 'sharp'>('standard');
  useEffect(() => setSize(quality === 'best' ? 'sharp' : 'standard'), [quality]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<FlipbookResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pages = printablePages(doc).length + (doc.cover ? 2 : 0);
  // Rough size per page image (WebP), to set expectations before exporting.
  const perPage = size === 'sharp' ? 0.55 : 0.28;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.exportFlipbook(projectId, doc, size));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-export">
      <div className="row between">
        <strong>Web flipbook</strong>
        <span className="muted small">{pages} pages · about {Math.max(1, Math.round(pages * perPage))} MB</span>
      </div>
      <div className="field-row">
        <div className="seg seg-wide">
          <button className={size === 'standard' ? 'on' : ''} title="Pages 1400 px tall: quick to send" onClick={() => setSize('standard')}>Standard</button>
          <button className={size === 'sharp' ? 'on' : ''} title="Pages 2200 px tall: crisp on big screens" onClick={() => setSize('sharp')}>Sharp</button>
        </div>
        <button className="btn btn-small" onClick={() => void go()} disabled={busy}>{busy ? `Rendering ${pages} pages…` : 'Make flipbook'}</button>
      </div>
      {err && <div className="notice notice-error small">{err}</div>}
      {res && (
        <div className="row">
          <Icon name="check" size={16} />
          <span className="small">{res.pages} pages{res.hasCover ? ' + cover' : ''} · {(res.bytes / 1e6).toFixed(1)} MB</span>
          <a className="btn btn-small" href={res.url} target="_blank" rel="noreferrer">Open</a>
          <a className="btn btn-small btn-primary" href={`${res.url}?download=1`}><Icon name="download" /> Download</a>
        </div>
      )}
      <p className="muted small">One web page with page turns that works offline in any browser, on a phone too. Send it by AirDrop, email or a shared drive, or put it on any web host for a link. Nothing is uploaded from here.</p>
    </div>
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
