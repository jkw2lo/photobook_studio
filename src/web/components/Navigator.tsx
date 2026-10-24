import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { COVER_INDEX, geometryFor, insertSpreadAfter, moveSpread, spreadPagesLabel, type BookSettings, type BookStyle, type PhotoAsset, type Spread } from '../../core';
import { useEditor } from '../store';
import { Icon } from './Icon';
import { SpreadView } from './SpreadView';

const THUMB_H = 64;

/** Filmstrip: the cover, then every spread. Drag an inner spread onto another position to reorder. */
export function Navigator() {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assetMap);
  const current = useEditor((s) => s.currentSpread);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const n = doc.spreads.length;
  const chapterTitle = (id?: string) => doc.chapters.find((c) => c.id === id)?.title;

  useEffect(() => {
    stripRef.current?.querySelector('.nav-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [current]);

  // Stable handlers (refs, not closures over state) so memoized items don't re-render on every edit.
  const dragRef = useRef<number | null>(null);
  const handlers = useMemo<DragHandlers>(() => ({
    start: (i) => {
      dragRef.current = i;
      setDragFrom(i);
    },
    over: (i) => {
      const count = useEditor.getState().doc?.spreads.length ?? 0;
      if (dragRef.current !== null && i > 0 && i < count - 1) setDropAt(i);
    },
    end: () => {
      dragRef.current = null;
      setDragFrom(null);
      setDropAt(null);
    },
    drop: (i) => {
      const from = dragRef.current;
      const count = useEditor.getState().doc?.spreads.length ?? 0;
      if (from !== null && from !== i && i > 0 && i < count - 1) {
        if (useEditor.getState().run('Move spread', (d) => moveSpread(d, from, i))) useEditor.getState().goToSpread(i);
      }
      dragRef.current = null;
      setDragFrom(null);
      setDropAt(null);
    },
  }), []);

  return (
    <div className="navigator" ref={stripRef}>
      {doc.cover ? (
        <NavItem
          index={COVER_INDEX} surface={doc.cover} settings={doc.settings} style={doc.style} spreadCount={n} assets={assets}
          on={current === COVER_INDEX} label="Cover" chapter={' '} movable={false} drop={false}
        />
      ) : (
        <button className={`nav-item nav-add-cover ${current === COVER_INDEX ? 'on' : ''}`} onClick={() => useEditor.getState().goToSpread(COVER_INDEX)}>
          <div className="nav-chapter">{' '}</div>
          <div className="nav-placeholder" style={{ height: THUMB_H }}><Icon name="plus" /> Cover</div>
          <div className="nav-label">Cover</div>
        </button>
      )}
      <div className="nav-sep" />
      {doc.spreads.map((spread, i) => {
        const prevChapter = i > 0 ? doc.spreads[i - 1].chapterId : undefined;
        const movable = i > 0 && i < n - 1 && !spread.locked;
        return (
          <NavItem
            key={spread.id}
            index={i} surface={spread} settings={doc.settings} style={doc.style} spreadCount={n} assets={assets}
            on={i === current}
            label={spreadPagesLabel(i, n).replace(/^pages? /, '')}
            chapter={spread.chapterId !== prevChapter ? chapterTitle(spread.chapterId) ?? ' ' : ' '}
            movable={movable}
            drop={dropAt === i && dragFrom !== i}
            handlers={handlers}
          />
        );
      })}
      <button
        className="nav-add"
        title="Add a spread before the last page"
        onClick={() => {
          if (useEditor.getState().run('Insert spread', (d) => insertSpreadAfter(d, n - 2))) useEditor.getState().goToSpread(n - 1);
        }}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

interface NavItemProps {
  index: number;
  surface: Spread;
  settings: BookSettings;
  style: BookStyle;
  spreadCount: number;
  assets: Map<string, PhotoAsset>;
  on: boolean;
  label: string;
  chapter: string;
  movable: boolean;
  drop: boolean;
  handlers?: DragHandlers;
}

interface DragHandlers {
  start: (i: number) => void;
  over: (i: number) => void;
  end: () => void;
  drop: (i: number) => void;
}

const NavItem = memo(function NavItem(p: NavItemProps) {
  return (
    <div
      className={`nav-item ${p.on ? 'on' : ''} ${p.drop ? 'drop' : ''}`}
      onClick={() => useEditor.getState().goToSpread(p.index)}
      draggable={p.movable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/x-photobook-spread', String(p.index));
        p.handlers?.start(p.index);
      }}
      onDragOver={(e) => {
        if (!p.handlers) return;
        e.preventDefault();
        p.handlers.over(p.index);
      }}
      onDragEnd={() => p.handlers?.end()}
      onDrop={(e) => {
        e.preventDefault();
        p.handlers?.drop(p.index);
      }}
    >
      <div className="nav-chapter">{p.chapter}</div>
      <div className="nav-thumb">
        <ThumbScale {...p} height={THUMB_H} />
        {p.surface.locked && (
          <span className="nav-lock" title="Locked">
            <Icon name="lock" size={12} />
          </span>
        )}
      </div>
      <div className="nav-label">{p.label}</div>
    </div>
  );
});

/** Picks the scale so every thumbnail has the same height, whatever the surface's proportions. */
function ThumbScale({ index, surface, settings, style, spreadCount, assets, height }: NavItemProps & { height: number }) {
  const g = useMemo(() => geometryFor(settings, spreadCount, index), [settings, spreadCount, index]);
  const scale = height / (g.height + 2 * g.bleed);
  return <SpreadView settings={settings} style={style} spreadCount={spreadCount} index={index} surface={surface} scale={scale} assets={assets} thumbSize="s" />;
}
