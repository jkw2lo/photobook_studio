import { useMemo, type ReactElement } from 'react';
import {
  MM_PER_PT, POSTER_TEMPLATES, applyPosterTemplate, curatePool, gradeColor, gradeFromPreset, photoArea, scalePath, shapeDef, templateElements,
  type BookDocument, type PhotoAsset, type PosterTemplate,
} from '../../core';
import { useEditor } from '../store';

// Poster templates: pick one to restyle the sheet (background, type, banners, icons) and fill its
// photo area with Auto collage. Previews show the poster's own title.

export function PosterTemplates() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const curated = useMemo(() => curatePool(assets), [assets]);
  const apply = (t: PosterTemplate) => {
    const ok = useEditor.getState().run(`Template: ${t.name}`, (d) => applyPosterTemplate(d, assets, t.id, curated).doc);
    if (ok) useEditor.getState().toast('success', `“${t.name}” applied — every word and shape is editable. ⌘Z to go back.`);
  };
  return (
    <div className="template-cards">
      {POSTER_TEMPLATES.map((t) => (
        <button key={t.id} className={`template-card ${doc.template === t.id ? 'on' : ''}`} onClick={() => apply(t)} title={t.description} disabled={!assets.length}>
          <TemplatePreview doc={doc} t={t} assets={assets} />
          <span className="small">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

/** A small drawing of the template on this sheet: grey photo blocks in its area, real text and shapes. */
function TemplatePreview({ doc, t, assets }: { doc: BookDocument; t: PosterTemplate; assets: PhotoAsset[] }) {
  const W = doc.settings.trimWidthMm;
  const H = doc.settings.trimHeightMm;
  const els = useMemo(() => templateElements(doc, t, assets), [doc.title, doc.subtitle, W, H, t, assets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = photoArea(doc, { style: 'mosaic', photoCount: 1, gapMm: 0, marginMm: 0, titlePosition: 'none', seed: 1, ...t.collage });
  // Placeholder photos: a mid grey that reads on light and dark backgrounds, in the template's grade.
  const [br, bgc, bb] = [1, 3, 5].map((i) => parseInt(t.background.slice(i, i + 2), 16));
  const light = 0.2126 * br + 0.7152 * bgc + 0.0722 * bb > 140;
  const grey = gradeColor(gradeFromPreset(t.grade ?? 'none'), light ? [176, 182, 192] : [112, 120, 134]);
  const blocks: ReactElement[] = [];
  const cols = t.collage.style === 'hero' ? 2 : 3;
  const rows = t.collage.style === 'hero' ? 3 : 4;
  const gap = Math.min(area.w, area.h) * 0.03;
  const cw = (area.w - gap * (cols - 1)) / cols;
  const ch = (area.h - gap * (rows - 1)) / rows;
  const shape = t.collage.frameShape ? shapeDef(t.collage.frameShape).d : null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (t.collage.style === 'hero' && r === 0 && c === 1) continue;
      const x = area.x + c * (cw + gap);
      const y = area.y + r * (ch + gap);
      const w = t.collage.style === 'hero' && r === 0 ? area.w : cw;
      const key = `${r}-${c}`;
      const tilt = t.collage.style === 'scatter' ? ((r * 3 + c) % 5 - 2) * 4 : 0;
      if (shape) {
        const s = Math.min(w, ch);
        blocks.push(<path key={key} d={scalePath(shape, s, s)} transform={`translate(${x + (w - s) / 2} ${y + (ch - s) / 2})`} fill={`rgb(${grey.join(',')})`} />);
      } else blocks.push(<rect key={key} x={x} y={y} width={w} height={ch} fill={`rgb(${grey.join(',')})`} stroke={t.collage.style === 'scatter' ? '#fff' : undefined} strokeWidth={t.collage.style === 'scatter' ? Math.min(w, ch) * 0.06 : 0} transform={tilt ? `rotate(${tilt} ${x + w / 2} ${y + ch / 2})` : undefined} />);
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="template-preview" preserveAspectRatio="xMidYMid meet">
      <rect width={W} height={H} fill={t.background} />
      {blocks}
      {els.map((e) => {
        if (e.type === 'shape') {
          const def = shapeDef(e.shape);
          return <path key={e.id} d={scalePath(def.d, e.widthMm, e.heightMm)} transform={`translate(${e.xMm} ${e.yMm})`} fill={e.gradient?.from ?? e.fill} fillRule={def.evenOdd ? 'evenodd' : 'nonzero'} opacity={e.opacity} />;
        }
        if (e.type !== 'text') return null;
        const size = e.fontSizePt * MM_PER_PT;
        const x = e.align === 'left' ? e.xMm : e.align === 'right' ? e.xMm + e.widthMm : e.xMm + e.widthMm / 2;
        const lines = (e.uppercase ? e.text.toUpperCase() : e.text).split('\n');
        return (
          <g key={e.id}>
            {e.backgroundColor && <rect x={e.xMm} y={e.yMm} width={e.widthMm} height={e.heightMm} rx={e.backgroundRadiusMm ?? 0} fill={e.backgroundColor} opacity={e.backgroundOpacity ?? 1} />}
            {lines.map((l, i) => (
              <text
                key={i} x={x} y={e.yMm + (e.paddingMm ?? 0) + size * (0.9 + i * e.lineHeight)} fontSize={size} fill={e.gradient?.from ?? e.color}
                fontFamily={`'${e.fontFamily}'`} fontWeight={e.fontWeight} fontStyle={e.italic ? 'italic' : undefined}
                letterSpacing={e.letterSpacingEm ? `${e.letterSpacingEm}em` : undefined} textAnchor={e.align === 'left' ? 'start' : e.align === 'right' ? 'end' : 'middle'}
              >
                {l}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
