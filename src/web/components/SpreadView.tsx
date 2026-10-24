import { memo, useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  COVER_INDEX, elementPlacement, geometryFor, pageNumberRect, type BookSettings, type BookStyle, type Element,
  type ImageElement, type PhotoAsset, type ShapeElement, type Spread, type TextElement, MM_PER_PT,
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
}

export const SpreadView = memo(function SpreadView({ settings, style, spreadCount, index, surface, scale, assets, thumbSize = 'm', children, hiddenElementId }: Props) {
  const g = useMemo(() => geometryFor(settings, spreadCount, index), [settings, spreadCount, index]);
  const b = g.bleed;
  const bg = surface.background ?? style.background;
  const px = (mm: number) => mm * scale;
  const isCover = index === COVER_INDEX;
  return (
    <div className="spread" style={{ width: px(g.width + 2 * b), height: px(g.height + 2 * b), background: isCover ? bg : undefined }}>
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
      {surface.elements.map((el) =>
        el.id === hiddenElementId ? null : (
          <ElementView key={el.id} el={el} scale={scale} offset={b} asset={el.type === 'image' && el.assetId ? assets.get(el.assetId) : undefined} thumbSize={thumbSize} />
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
                color: style.textColor, fontFamily: style.bodyFont.family,
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

export const ElementView = memo(function ElementView({ el, scale, offset, asset, thumbSize }: { el: Element; scale: number; offset: number; asset?: PhotoAsset; thumbSize: 's' | 'm' }) {
  const style: CSSProperties = {
    left: (el.xMm + offset) * scale,
    top: (el.yMm + offset) * scale,
    width: el.widthMm * scale,
    height: el.heightMm * scale,
    transform: el.rotationDeg ? `rotate(${el.rotationDeg}deg)` : undefined,
  };
  if (el.type === 'image') return <ImageView el={el} scale={scale} style={style} asset={asset} thumbSize={thumbSize} />;
  if (el.type === 'shape') return <ShapeView el={el} style={style} />;
  return <TextView el={el} scale={scale} style={style} />;
});

function ImageView({ el, scale, style, asset, thumbSize }: { el: ImageElement; scale: number; style: CSSProperties; asset?: PhotoAsset; thumbSize: 's' | 'm' }) {
  const frameStyle: CSSProperties = { ...style, background: el.borderMm > 0 ? el.borderColor : undefined };
  if (!el.assetId || !asset) {
    return (
      <div className={`el el-image el-empty ${el.borderMm > 0 ? 'el-print' : ''}`} style={frameStyle}>
        {el.assetId && !asset ? <span>Photo not in library</span> : <span>Drop a photo here</span>}
      </div>
    );
  }
  const { box, placement } = elementPlacement(el, asset);
  return (
    <div className={`el el-image ${el.borderMm > 0 ? 'el-print' : ''}`} style={frameStyle}>
      <div className="el-image-inner" style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}>
        <img
          src={thumbUrl(asset.id, thumbSize)}
          alt={asset.fileName}
          draggable={false}
          decoding="async"
          loading={thumbSize === 's' ? 'lazy' : 'eager'}
          style={{ left: placement.x * scale, top: placement.y * scale, width: placement.w * scale, height: placement.h * scale }}
        />
      </div>
      {asset.missing && <div className="el-badge el-badge-error">Missing original</div>}
    </div>
  );
}

function ShapeView({ el, style }: { el: ShapeElement; style: CSSProperties }) {
  return <div className="el el-shape" style={{ ...style, background: el.fill, opacity: el.opacity }} />;
}

function TextView({ el, scale, style }: { el: TextElement; scale: number; style: CSSProperties }) {
  return (
    <div
      className="el el-text"
      style={{
        ...style,
        fontFamily: `'${el.fontFamily}'`,
        fontWeight: el.fontWeight,
        fontSize: el.fontSizePt * MM_PER_PT * scale,
        lineHeight: el.lineHeight,
        textAlign: el.align,
        color: el.color,
      }}
    >
      {el.text}
    </div>
  );
}
