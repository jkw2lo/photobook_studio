import { useMemo, useState } from 'react';
import {
  ADDON_CATEGORIES, BOOK_TEMPLATES, MM_PER_PT, PAGE_ADDONS, addonElements, applyBookTemplate, applyPageAddon, chapterDateRanges, insertAddonSpread,
  isPrintable, photoDays, scalePath, shapeDef, typePack,
  type AddonCategory, type BookDocument, type BookTemplate, type Element, type PageAddon,
} from '../../core';
import { useEditor } from '../store';

// Book templates (whole-book looks, in the Draft tab) and page add-ons (contents, text sections,
// quotes, openers… in the spread panel).

/** Elements drawn small and simplified: text as real type, shapes as paths, frames as grey boxes. */
function MiniElements({ elements, offsetX = 0 }: { elements: Element[]; offsetX?: number }) {
  return (
    <>
      {elements.map((e) => {
        const x0 = e.xMm - offsetX;
        if (e.type === 'image') return <rect key={e.id} x={x0} y={e.yMm} width={e.widthMm} height={e.heightMm} fill="#c9ccd3" />;
        if (e.type === 'calendar') {
          return (
            <g key={e.id} transform={`translate(${x0} ${e.yMm})`} fill={e.color}>
              {Array.from({ length: 21 }, (_, i) => <circle key={i} cx={(e.widthMm / 7) * ((i % 7) + 0.5)} cy={e.heightMm * 0.42 + (e.widthMm / 7) * Math.floor(i / 7)} r={e.widthMm / 40} fill={i % 7 > 1 && i % 7 < 5 && i < 14 ? e.accent : e.color} />)}
            </g>
          );
        }
        if (e.type === 'shape') {
          const def = shapeDef(e.shape);
          return <path key={e.id} d={scalePath(def.d, e.widthMm, e.heightMm)} transform={`translate(${x0} ${e.yMm})`} fill={e.fill} opacity={e.opacity} fillRule={def.evenOdd ? 'evenodd' : 'nonzero'} />;
        }
        const size = e.fontSizePt * MM_PER_PT;
        const tx = e.align === 'left' ? x0 : e.align === 'right' ? x0 + e.widthMm : x0 + e.widthMm / 2;
        const lines = (e.uppercase ? e.text.toUpperCase() : e.text).split('\n').slice(0, 14);
        return (
          <g key={e.id}>
            {lines.map((l, i) => (
              <text
                key={i} x={tx} y={e.yMm + size * (0.9 + i * e.lineHeight)} fontSize={size} fill={e.color} fontFamily={`'${e.fontFamily}'`} fontWeight={e.fontWeight}
                fontStyle={e.italic ? 'italic' : undefined} letterSpacing={e.letterSpacingEm ? `${e.letterSpacingEm}em` : undefined}
                textAnchor={e.align === 'left' ? 'start' : e.align === 'right' ? 'end' : 'middle'}
              >
                {l.length > 60 ? `${l.slice(0, 58)}…` : l}
              </text>
            ))}
          </g>
        );
      })}
    </>
  );
}

// ---- book templates --------------------------------------------------------------------------------

export function BookTemplatesSection() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const usable = assets.filter((a) => !a.excluded && !a.missing).length;
  const apply = (t: BookTemplate) => {
    const st = useEditor.getState();
    let pages = 0;
    const ok = st.run(`Book template: ${t.name}`, (d) => {
      const res = applyBookTemplate(d, assets, t.id);
      useEditor.setState({ draftReport: res.report });
      pages = res.report.pages;
      return res.doc;
    });
    if (ok) {
      st.goToSpread(1);
      st.toast('success', `“${t.name}” — ${pages} pages with contents, chapter openers and closing pages. Everything is editable; ⌘Z to go back.`);
    }
  };
  return (
    <div className="stack">
      <div className="book-templates">
        {BOOK_TEMPLATES.map((t) => (
          <button key={t.id} className={`book-template ${doc.template === t.id ? 'on' : ''}`} onClick={() => apply(t)} disabled={!usable} title={t.description}>
            <BookTemplatePreview t={t} title={doc.title} />
            <strong className="small">{t.name}</strong>
            <span className="muted small">{t.description}</span>
          </button>
        ))}
      </div>
      <p className="muted small">A template restyles and redrafts the whole book from your photos — type, colours, cover and grade — and adds a contents page, chapter openers and closing pages. Locked spreads are kept. Regenerating keeps the template pages and anything you typed on them.</p>
    </div>
  );
}

/** An open book: title page on the right in the template's type and colours, photos on the left. */
function BookTemplatePreview({ t, title }: { t: BookTemplate; title: string }) {
  const pack = typePack(t.typePack);
  const W = 120;
  const H = 60;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="book-template-preview" aria-hidden>
      <rect width={W} height={H} rx="2" fill={t.background} />
      <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="rgba(0,0,0,0.12)" strokeWidth="0.6" />
      {t.stylePresetId === 'scrapbook' ? (
        <>
          <rect x="8" y="8" width="26" height="19" fill="#c9ccd3" stroke="#fff" strokeWidth="1.2" transform="rotate(-4 21 17)" />
          <rect x="24" y="28" width="26" height="20" fill="#b9bdc6" stroke="#fff" strokeWidth="1.2" transform="rotate(3 37 38)" />
        </>
      ) : t.stylePresetId === 'collage' ? (
        <>
          <rect x="5" y="6" width="30" height="22" fill="#9aa0ab" />
          <rect x="36" y="6" width="19" height="22" fill="#b5bac3" />
          <rect x="5" y="29" width="19" height="25" fill="#b5bac3" />
          <rect x="25" y="29" width="30" height="25" fill="#9aa0ab" />
        </>
      ) : t.stylePresetId === 'editorial' ? (
        <rect x="0" y="0" width={W / 2} height={H} fill="#b5bac3" />
      ) : (
        <rect x="12" y="12" width="36" height="28" fill="#c9ccd3" />
      )}
      <text x={W * 0.75} y={H * 0.48} textAnchor="middle" fontSize="8" fill={t.textColor} fontFamily={`'${pack.roles.title.family}'`} fontWeight={pack.roles.title.weight}
        letterSpacing={pack.roles.title.letterSpacingEm ? `${pack.roles.title.letterSpacingEm}em` : undefined}>
        {(pack.roles.title.uppercase ? title.toUpperCase() : title).slice(0, 14)}
      </text>
      <line x1={W * 0.7} y1={H * 0.56} x2={W * 0.8} y2={H * 0.56} stroke={t.accent} strokeWidth="0.8" />
      <text x={W * 0.75} y={H * 0.66} textAnchor="middle" fontSize="3.2" fill={t.textColor} opacity="0.7" fontFamily={`'${pack.roles.subtitle.family}'`}
        letterSpacing={pack.roles.subtitle.letterSpacingEm ? `${pack.roles.subtitle.letterSpacingEm}em` : undefined}>
        {pack.roles.subtitle.uppercase ? 'CONTENTS · CHAPTERS' : 'contents · chapters'}
      </text>
    </svg>
  );
}

// ---- page add-ons ----------------------------------------------------------------------------------

type Target = 'left' | 'right' | 'new';

export function PageAddonsSection({ spreadIndex }: { spreadIndex: number }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const n = doc.spreads.length;
  const spread = doc.spreads[spreadIndex];
  const canLeft = isPrintable(spreadIndex, 'left', n);
  const canRight = isPrintable(spreadIndex, 'right', n);
  const [cat, setCat] = useState<AddonCategory>('front');
  const [target, setTarget] = useState<Target>('new');
  const effective: Target = (target === 'left' && !canLeft) || (target === 'right' && !canRight) ? 'new' : target;
  const dates = useMemo(() => chapterDateRanges(doc, assets), [doc, assets]);
  const allAssets = useEditor((s) => s.assets);
  const days = useMemo(() => photoDays(allAssets.filter((a) => !a.excluded && !a.missing)), [doc, allAssets]);

  const add = (a: PageAddon) => {
    const st = useEditor.getState();
    if (effective === 'new') {
      // Front matter reads best on the left of a new spread; most others on the right.
      const side = a.category === 'front' || a.id === 'notes' ? 'left' : 'right';
      if (st.run(`Add page: ${a.name}`, (d) => insertAddonSpread(d, spreadIndex, { [side]: a.id }, { chapterDates: dates, photoDays: days }))) st.goToSpread(Math.min(spreadIndex + 1, n - 1));
    } else st.run(`Page: ${a.name}`, (d) => applyPageAddon(d, spreadIndex, effective, a.id, { chapterDates: dates, photoDays: days }));
  };

  return (
    <div className="stack">
      <div className="field">
        <span>Put it on</span>
        <div className="seg seg-wide">
          <button className={effective === 'new' ? 'on' : ''} onClick={() => setTarget('new')} title="Insert a new spread after this one">New spread</button>
          <button className={effective === 'left' ? 'on' : ''} disabled={!canLeft || spread.locked} onClick={() => setTarget('left')} title="Replace what is on the left page">Left page</button>
          <button className={effective === 'right' ? 'on' : ''} disabled={!canRight || spread.locked} onClick={() => setTarget('right')} title="Replace what is on the right page">Right page</button>
        </div>
      </div>
      <div className="seg seg-wide">
        {ADDON_CATEGORIES.map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="addon-cards">
        {PAGE_ADDONS.filter((a) => a.category === cat).map((a) => (
          <button key={a.id} className="addon-card" onClick={() => add(a)} title={a.description}>
            <AddonPreview doc={doc} addon={a} />
            <span className="small">{a.name}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        {effective === 'new' ? 'Adds two pages after this spread.' : `Replaces what is on the ${effective} page (locked items stay; the caption band goes on top).`} The contents page keeps its chapters and page numbers up to date. Regenerating the draft replaces unlocked pages — lock a spread to keep it.
      </p>
    </div>
  );
}

function AddonPreview({ doc, addon }: { doc: BookDocument; addon: PageAddon }) {
  const els = useMemo(() => addonElements(doc, addon, 'right'), [doc.style, doc.settings, doc.title, doc.subtitle, doc.chapters, addon]); // eslint-disable-line react-hooks/exhaustive-deps
  const W = doc.settings.trimWidthMm;
  const H = doc.settings.trimHeightMm;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="addon-preview" aria-hidden>
      <rect width={W} height={H} fill={doc.style.background} />
      <MiniElements elements={els.map((e) => (e.type === 'text' && e.auto ? { ...e, text: e.auto === 'toc' ? (doc.chapters.map((c) => c.title).join('\n') || 'Chapter one\nChapter two\nChapter three') : (doc.chapters.map((_, i) => String(3 + i * 6)).join('\n') || '3\n9\n15') } : e))} offsetX={W} />
    </svg>
  );
}
