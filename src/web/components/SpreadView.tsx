import { memo, useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  COVER_INDEX, archGeometry, backgroundFrame, elementPlacement, geometryFor, gradeChainSvg, gradeSvgMatrix, gradientLine, isNeutralGrade, maskPath, pageNumberRect,
  roleStyle, shapePath, type BookSettings, type BookStyle, type ColorGrade, type Element, type Gradient, type ImageElement, type PhotoAsset,
  type ShapeElement, type Spread, type TextElement, type CalendarElement, calendarLayout, calendarMark, mapPath, MM_PER_PT,
} from '../../core';
import { thumbUrl } from '../api';

// Renders a spread or the cover at a given scale (px per mm). Used by the editor canvas (the
// interactive layer is drawn on top by Canvas) and by filmstrip/overview thumbnails.
// Props are deliberately narrow and identity-stable (settings, style, the surface itself), so a
// drag on one spread re-renders only that spread — not every thumbnail in the book.

interface Props {
  settings: BookSettings;
  style: BookStyle;
  spreadCount: number;
  index: number;
  surface: Spread;
  scale: number;
  assets: Map<string, PhotoAsset>;
  thumbSize?: 's' | 'm';
  /** Overlay drawn inside the surface's coordinate box (guides, handles). */
  children?: ReactNode;
  hiddenElementId?: string | null;
  /** Colour grade for the photos (the document's). */
  grade?: ColorGrade;
}

export const SpreadView = memo(function SpreadView({ settings, style, spreadCount, index, surface, scale, assets, thumbSize = 'm', children, hiddenElementId, grade }: Props) {
  const filterId = `grade${useId().replace(/:/g, '')}`;
  const graded = !isNeutralGrade(grade);
  const g = useMemo(() => geometryFor(settings, spreadCount, index), [settings, spreadCount, index]);
  const b = g.bleed;
  const bg = surface.background ?? style.background;
  const px = (mm: number) => mm * scale;
  // Covers and posters are one continuous sheet; spreads are two pages (with inside covers).
  const isCover = index === COVER_INDEX || g.kind === 'poster';
  const bgFrame = backgroundFrame(surface, g);
  return (
    <div className="spread" style={{ width: px(g.width + 2 * b), height: px(g.height + 2 * b), background: isCover ? bg : undefined }}>
      {graded && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={gradeSvgMatrix(grade!)} />
          </filter>
        </svg>
      )}
      {!isCover &&
        g.panels.map((p, i) => (
          <div
            key={p.id}
            className={`page ${p.printable ? '' : 'page-cover'}`}
            style={{
              left: px(i === 0 ? 0 : p.x + b),
              width: px(p.w + b),
              top: 0,
              height: px(g.height + 2 * b),
              background: p.printable ? bg : undefined,
            }}
          />
        ))}
      {bgFrame && <ElementView el={bgFrame} scale={scale} offset={b} asset={assets.get(bgFrame.assetId!)} thumbSize={thumbSize} filter={graded ? `url(#${filterId})` : undefined} grade={grade} />}
      {surface.elements.map((el) =>
        el.id === hiddenElementId ? null : (
          <ElementView key={el.id} el={el} scale={scale} offset={b} asset={el.type === 'image' && el.assetId ? assets.get(el.assetId) : undefined} thumbSize={thumbSize} filter={graded ? `url(#${filterId})` : undefined} grade={grade} />
        ),
      )}
      {!isCover && settings.pageNumbers &&
        g.panels.map((p) => {
          const num = Number(p.label.replace('Page ', ''));
          if (!p.printable || !num || num === 1) return null;
          const r = pageNumberRect(p.id as 'left' | 'right', settings);
          return (
            <div
              key={p.id}
              className="page-number"
              style={{
                left: px(r.x + b), top: px(r.y + b), width: px(r.w), height: px(r.h),
                fontSize: px(8 * MM_PER_PT), textAlign: p.id === 'left' ? 'left' : 'right',
                color: style.textColor, fontFamily: `'${roleStyle(style, 'caption').family}'`,
              }}
            >
              {num}
            </div>
          );
        })}
      {children}
    </div>
  );
});

export const ElementView = memo(function ElementView({ el, scale, offset, asset, thumbSize, filter, grade }: { el: Element; scale: number; offset: number; asset?: PhotoAsset; thumbSize: 's' | 'm'; filter?: string; grade?: ColorGrade }) {
  const style: CSSProperties = {
    left: (el.xMm + offset) * scale,
    top: (el.yMm + offset) * scale,
    width: el.widthMm * scale,
    height: el.heightMm * scale,
    transform: el.rotationDeg ? `rotate(${el.rotationDeg}deg)` : undefined,
  };
  if (el.type === 'image') return <ImageView el={el} scale={scale} style={style} asset={asset} thumbSize={thumbSize} filter={filter} grade={grade} />;
  if (el.type === 'shape') return <ShapeView el={el} scale={scale} style={style} />;
  if (el.type === 'calendar') return <CalendarView el={el} scale={scale} style={style} />;
  return <TextView el={el} scale={scale} style={style} />;
});

/** A calendar: same layout as the PDF (core/calendar), drawn in SVG. */
function CalendarView({ el, scale, style }: { el: CalendarElement; scale: number; style: CSSProperties }) {
  const lay = calendarLayout(el);
  const k = scale;
  return (
    <div className="el el-calendar" style={{ ...style, opacity: el.opacity }}>
      <svg width={el.widthMm * k} height={el.heightMm * k} style={{ overflow: 'visible', display: 'block' }} fontFamily={`'${el.fontFamily}'`} fontWeight={el.fontWeight}>
        {lay.cells.map((c, i) => {
          const cx = (c.x + c.w / 2) * k;
          const cy = (c.y + c.h / 2) * k;
          const size = (c.kind === 'title' ? lay.titleMm : c.kind === 'weekday' ? lay.weekdayMm : lay.dayMm) * k;
          const mark = c.marked ? calendarMark(el.markStyle, c, lay.dayMm) : null;
          const markOn = !!mark?.knockout;
          return (
            <g key={i} opacity={c.faint ? 0.32 : c.kind === 'weekday' ? 0.6 : 1}>
              {mark && (
                <path
                  d={mapPath(mark.d, (x, y) => [x * k, y * k])} opacity={mark.opacity}
                  fill={mark.fill ? el.accent : 'none'} stroke={mark.fill ? undefined : el.accent} strokeWidth={mark.strokeMm ? mark.strokeMm * k : undefined} strokeLinecap="round"
                />
              )}
              <text x={cx} y={cy + size * 0.35} fontSize={c.text.length > 3 && c.kind === 'day' ? size * 0.72 : size} textAnchor="middle" fill={markOn ? '#ffffff' : el.color}>{c.text}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ImageView({ el, scale, style, asset, thumbSize, filter, grade }: { el: ImageElement; scale: number; style: CSSProperties; asset?: PhotoAsset; thumbSize: 's' | 'm'; filter?: string; grade?: ColorGrade }) {
  // A photo with its own adjustments gets its own filter: its adjustment, then the document's grade.
  const ownId = `adj${useId().replace(/:/g, '')}`;
  const own = !isNeutralGrade(el.adjust);
  if (own) filter = `url(#${ownId})`;
  // A photo cut to a shape or to text: clip the frame to that outline (borders don't apply).
  const clip = el.mask ? maskPath(el.mask, el.widthMm * scale, el.heightMm * scale) : null;
  const border = clip ? 0 : el.borderMm;
  const frameStyle: CSSProperties = {
    ...style,
    background: border > 0 ? el.borderColor : undefined,
    opacity: el.opacity,
    clipPath: clip ? `path(${clip.evenOdd ? 'evenodd, ' : ''}'${clip.d}')` : undefined,
  };
  if (!el.assetId || !asset) {
    return (
      <div className={`el el-image el-empty ${border > 0 ? 'el-print' : ''}`} style={frameStyle}>
        {el.assetId && !asset ? <span>Photo not in library</span> : <span>Drop a photo here</span>}
      </div>
    );
  }
  const { box, placement } = elementPlacement(clip ? { ...el, borderMm: 0 } : el, asset);
  return (
    <div className={`el el-image ${border > 0 ? 'el-print' : ''}`} style={frameStyle}>
      {own && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <filter id={ownId} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={gradeChainSvg([el.adjust, grade])} />
          </filter>
        </svg>
      )}
      <div className="el-image-inner" style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}>
        <img
          src={thumbUrl(asset.id, thumbSize)}
          alt={asset.fileName}
          draggable={false}
          decoding="async"
          loading={thumbSize === 's' ? 'lazy' : 'eager'}
          style={{ left: placement.x * scale, top: placement.y * scale, width: placement.w * scale, height: placement.h * scale, filter }}
        />
      </div>
      {asset.missing && <div className="el-badge el-badge-error">Missing original</div>}
    </div>
  );
}

/** SVG <linearGradient> across a w × h box, matching the PDF's gradient line. */
function GradientDef({ id, gradient, w, h }: { id: string; gradient: Gradient; w: number; h: number }) {
  const l = gradientLine(gradient.angleDeg, w, h);
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}>
      <stop offset="0" stopColor={gradient.from} />
      <stop offset="1" stopColor={gradient.to} />
    </linearGradient>
  );
}

function ShapeView({ el, scale, style }: { el: ShapeElement; scale: number; style: CSSProperties }) {
  const gid = `sg${useId().replace(/:/g, '')}`;
  const w = el.widthMm * scale;
  const h = el.heightMm * scale;
  if (!el.shape && !el.outline && !el.gradient && !el.strokeWidthMm && el.fill !== 'none') return <div className="el el-shape" style={{ ...style, background: el.fill, opacity: el.opacity }} />;
  const path = shapePath(el, w, h);
  return (
    <div className="el el-shape" style={{ ...style, opacity: el.opacity }}>
      <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
        {el.gradient && <defs><GradientDef id={gid} gradient={el.gradient} w={w} h={h} /></defs>}
        <path
          d={path.d} fillRule={path.evenOdd ? 'evenodd' : 'nonzero'} fill={el.gradient ? `url(#${gid})` : el.fill}
          stroke={el.strokeWidthMm ? el.strokeColor ?? '#000000' : undefined} strokeWidth={el.strokeWidthMm ? el.strokeWidthMm * scale : undefined} strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Typography and box styling of a text element, shared by the page view and the inline editor. */
export function textCss(el: TextElement, scale: number): CSSProperties {
  return {
    fontFamily: `'${el.fontFamily}'`,
    fontWeight: el.fontWeight,
    fontStyle: el.italic ? 'italic' : undefined,
    fontSize: el.fontSizePt * MM_PER_PT * scale,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacingEm ? `${el.letterSpacingEm}em` : undefined,
    textTransform: el.uppercase ? 'uppercase' : undefined,
    textAlign: el.align,
    color: el.color,
    background: el.backgroundColor ? hexToRgba(el.backgroundColor, el.backgroundOpacity ?? 1) : undefined,
    borderRadius: el.backgroundColor && el.backgroundRadiusMm ? el.backgroundRadiusMm * scale : undefined,
    padding: el.paddingMm ? el.paddingMm * scale : undefined,
    boxSizing: 'border-box',
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const x = hex.replace('#', '');
  const full = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.padEnd(6, '0');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Letter effects (gradient fill, outline, shadow) for straight text, on an inner span so the box
 * background stays separate. Outlines are drawn under the fill, as in the PDF. */
function letterCss(el: TextElement, scale: number): CSSProperties {
  const css: CSSProperties = { display: 'block', minHeight: '100%' };
  if (el.gradient) {
    css.backgroundImage = `linear-gradient(${el.gradient.angleDeg}deg, ${el.gradient.from}, ${el.gradient.to})`;
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
  }
  if (el.strokeWidthMm) {
    css.WebkitTextStroke = `${el.strokeWidthMm * scale}px ${el.strokeColor ?? '#000000'}`;
    css.paintOrder = 'stroke fill';
  }
  if (el.shadow) css.filter = `drop-shadow(${el.shadow.dxMm * scale}px ${el.shadow.dyMm * scale}px 0 ${hexToRgba(el.shadow.color, el.shadow.opacity)})`;
  return css;
}

function TextView({ el, scale, style }: { el: TextElement; scale: number; style: CSSProperties }) {
  const css = textCss(el, scale);
  const arch = archGeometry(el.widthMm, el.heightMm, el.arch ?? 0, el.fontSizePt * MM_PER_PT);
  if (arch) return <ArchedText el={el} scale={scale} style={{ ...style, ...css, padding: 0 }} />;
  return (
    <div className="el el-text" style={{ ...style, ...css, opacity: el.opacity }}>
      <span style={letterCss(el, scale)}>{el.text}</span>
    </div>
  );
}

/** Text on an arc: SVG textPath on the same circle the PDF uses. */
function ArchedText({ el, scale, style }: { el: TextElement; scale: number; style: CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const w = el.widthMm * scale;
  const h = el.heightMm * scale;
  const arch = archGeometry(w, h, el.arch ?? 0, el.fontSizePt * MM_PER_PT * scale)!;
  const text = (el.uppercase ? el.text.toUpperCase() : el.text).replace(/\n/g, ' ');
  const common = {
    fontFamily: `'${el.fontFamily}'`, fontWeight: el.fontWeight, fontStyle: el.italic ? 'italic' : undefined,
    fontSize: el.fontSizePt * MM_PER_PT * scale, letterSpacing: el.letterSpacingEm ? `${el.letterSpacingEm}em` : undefined,
  };
  const path = <textPath href={`#p${uid}`} startOffset="50%" textAnchor="middle">{text}</textPath>;
  return (
    <div className="el el-text" style={{ ...style, color: undefined, opacity: el.opacity }}>
      <svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
        <defs>
          <path id={`p${uid}`} d={arch.path} />
          {el.gradient && <GradientDef id={`g${uid}`} gradient={el.gradient} w={w} h={h} />}
        </defs>
        {el.shadow && (
          <text style={common} fill={el.shadow.color} fillOpacity={el.shadow.opacity} transform={`translate(${el.shadow.dxMm * scale} ${el.shadow.dyMm * scale})`}
            stroke={el.strokeWidthMm ? el.shadow.color : undefined} strokeWidth={el.strokeWidthMm ? el.strokeWidthMm * scale : undefined} strokeOpacity={el.shadow.opacity}>
            {path}
          </text>
        )}
        <text style={common} fill={el.gradient ? `url(#g${uid})` : el.color} stroke={el.strokeWidthMm ? el.strokeColor ?? '#000000' : undefined}
          strokeWidth={el.strokeWidthMm ? el.strokeWidthMm * scale : undefined} paintOrder="stroke fill" strokeLinejoin="round">
          {path}
        </text>
      </svg>
    </div>
  );
}
