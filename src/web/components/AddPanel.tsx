import { COVER_INDEX, coverDims, isPrintable, type BookDocument } from '../../core';
import { useEditor } from '../store';
import { PageAddonsSection } from './BookTemplates';
import { ElementsPalette } from './DesignPanel';
import { TextChoices } from './TypePanel';

// Elements › Text, Shapes, Calendar, Map, Pages: everything you can put on a page or poster, in one place and always one click away
// — text, shapes / banners / lines / icons, calendars, map outlines and (books) whole page designs.
// New items land in the middle of the page you're on and are selected, ready to edit.

export type AddSection = 'text' | 'shapes' | 'calendar' | 'map' | 'pages';

/** Where new items go: the poster's centre, the front cover's centre, or the right page's centre. */
function addPoint(doc: BookDocument, index: number): { x: number; y: number } {
  const s = doc.settings;
  if (s.product === 'poster') return { x: s.trimWidthMm / 2, y: s.trimHeightMm / 2 };
  if (index === COVER_INDEX) {
    const { panelW, panelH, spine } = coverDims(doc);
    return { x: panelW + spine.mm + panelW / 2, y: panelH / 2 };
  }
  const right = isPrintable(index, 'right', doc.spreads.length);
  return { x: s.trimWidthMm * (right ? 1.5 : 0.5), y: s.trimHeightMm / 2 };
}

/** What can be added on the current page (books also get whole page designs). */
export function addSections(doc: BookDocument, index: number): { id: AddSection; label: string }[] {
  return [
    { id: 'text', label: 'Text' },
    { id: 'shapes', label: 'Shapes' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'map', label: 'Map' },
    ...(doc.settings.product !== 'poster' && index !== COVER_INDEX ? [{ id: 'pages' as const, label: 'Pages' }] : []),
  ];
}

export function AddPanel({ section }: { section: AddSection }) {
  const doc = useEditor((s) => s.doc)!;
  const index = useEditor((s) => s.currentSpread);
  const poster = doc.settings.product === 'poster';
  const surface = index === COVER_INDEX ? doc.cover : doc.spreads[index];
  const current = addSections(doc, index).some((x) => x.id === section) ? section : 'text';
  if (!surface) return <p className="muted small">Create the cover first (Layout › Cover), then add to it here.</p>;
  if (surface.locked && current !== 'pages') return <p className="muted small">This {index === COVER_INDEX ? 'cover' : 'spread'} is locked. Unlock it to add things.</p>;
  const at = addPoint(doc, index);
  return (
    <div className="stack add-panel">
      {/* Text lands low on the page, where captions and titles usually go, rather than over the photos. */}
      {current === 'text' && <TextChoices surfaceId={surface.id} at={{ x: at.x, y: doc.settings.trimHeightMm * (poster ? 0.9 : 0.85) }} />}
      {current === 'shapes' && <ElementsPalette surfaceId={surface.id} at={at} only="shapes" />}
      {current === 'calendar' && <ElementsPalette surfaceId={surface.id} at={at} only="calendar" />}
      {current === 'map' && <ElementsPalette surfaceId={surface.id} at={at} only="map" />}
      {current === 'pages' && <PageAddonsSection spreadIndex={index} />}
      <p className="muted small">{poster ? 'New items go on the sheet' : index === COVER_INDEX ? 'New items go on the front cover' : 'New items go on the right-hand page'} — text near the bottom, everything else in the middle — and are selected, ready to move and style.</p>
    </div>
  );
}
