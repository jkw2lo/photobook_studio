import { CALENDAR_MARKS, calendarMark, mapPath, calendarTitle, fitCalendarHeight, photoDays, updateElement, type BookDocument, type CalendarElement } from '../../core';
import { useEditor } from '../store';
import { ColorInput } from './ColorInput';
import { FontPicker } from './FontPicker';
import { OpacitySlider } from './DesignPanel';

// Settings for a calendar layer: trip weeks or a whole month, the dates, which days are marked,
// and its look.

export function CalendarControls({ el, spreadId }: { el: CalendarElement; spreadId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const assets = useEditor((s) => s.assets);
  const { run } = useEditor.getState();
  /** Apply a change and resize the calendar's height to the weeks it now shows. */
  const upd = (label: string, patch: Partial<CalendarElement>) =>
    run(label, (d: BookDocument) => {
      const next = { ...el, ...patch };
      return updateElement(d, spreadId, el.id, { ...patch, heightMm: fitCalendarHeight(next) });
    });
  const days = photoDays(assets.filter((a) => !a.excluded && !a.missing));
  const marked = new Set(el.highlights);
  return (
    <div className="stack">
      <div className="field">
        <span>Show</span>
        <div className="seg seg-wide">
          <button className={el.mode === 'range' ? 'on' : ''} onClick={() => upd('Calendar: trip dates', { mode: 'range' })} title="Only the weeks from the first to the last day">Trip weeks</button>
          <button className={el.mode === 'month' ? 'on' : ''} onClick={() => upd('Calendar: whole month', { mode: 'month' })}>Whole month</button>
        </div>
      </div>
      <div className="field-row">
        <label className="field">
          <span>{el.mode === 'month' ? 'Month of' : 'From'}</span>
          <input type="date" value={el.start} onChange={(e) => e.target.value && upd('Calendar dates', { start: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        {el.mode === 'range' && (
          <label className="field">
            <span>To</span>
            <input type="date" value={el.end} min={el.start} onChange={(e) => e.target.value && upd('Calendar dates', { end: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        )}
      </div>
      {days.length > 0 && (
        <button className="btn btn-small" onClick={() => upd('Calendar: photo dates', { start: days[0], end: days[days.length - 1], highlights: days })} title={`${days.length} day${days.length === 1 ? '' : 's'} with photos, ${days[0]} to ${days[days.length - 1]}`}>
          Use the photos’ dates ({days.length} day{days.length === 1 ? '' : 's'})
        </button>
      )}
      <div className="field">
        <span>Marked days — click to toggle</span>
        <div className="cal-days">
          {dayList(el).map((d) => (
            <button key={d} className={`cal-day ${marked.has(d) ? 'on' : ''}`} title={d} onClick={() => upd('Mark day', { highlights: marked.has(d) ? el.highlights.filter((x) => x !== d) : [...el.highlights, d].sort() })}>
              {Number(d.slice(8))}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Title</span>
        <input value={el.title ?? ''} placeholder={calendarTitle(el)} onChange={(e) => run('Calendar title', (d) => updateElement(d, spreadId, el.id, { title: e.target.value || undefined }))} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="field-row">
        <label className="field check">
          <input type="checkbox" checked={el.showTitle} onChange={(e) => upd('Calendar title', { showTitle: e.target.checked })} />
          <span>Title</span>
        </label>
        <label className="field check">
          <input type="checkbox" checked={el.showWeekdays} onChange={(e) => upd('Calendar weekdays', { showWeekdays: e.target.checked })} />
          <span>Weekdays</span>
        </label>
        <div className="seg">
          <button className={el.weekStart === 1 ? 'on' : ''} onClick={() => upd('Week starts Monday', { weekStart: 1 })} title="Weeks start on Monday">Mon</button>
          <button className={el.weekStart === 0 ? 'on' : ''} onClick={() => upd('Week starts Sunday', { weekStart: 0 })} title="Weeks start on Sunday">Sun</button>
        </div>
      </div>
      <div className="field">
        <span>Font</span>
        <FontPicker value={el.fontFamily} onChange={(family) => run('Calendar font', (d) => updateElement(d, spreadId, el.id, { fontFamily: family }))} />
      </div>
      <div className="field-row">
        <label className="field">
          <span>Text</span>
          <ColorInput value={el.color} label="Calendar text colour" apply={(d, c) => updateElement(d, spreadId, el.id, { color: c })} />
        </label>
        <label className="field">
          <span>Marks</span>
          <ColorInput value={el.accent} label="Calendar mark colour" apply={(d, c) => updateElement(d, spreadId, el.id, { accent: c })} />
        </label>
      </div>
      <div className="field">
        <span>Mark</span>
        <div className="mark-grid">
          {CALENDAR_MARKS.map((m) => (
            <button key={m.id} className={`mark-btn ${el.markStyle === m.id ? 'on' : ''}`} title={m.name} aria-label={`Mark: ${m.name}`} onClick={() => upd(`Mark: ${m.name}`, { markStyle: m.id })}>
              <MarkPreview mark={m.id} color={el.accent} />
            </button>
          ))}
        </div>
      </div>
      <OpacitySlider spreadId={spreadId} ids={[el.id]} value={el.opacity ?? 1} />
    </div>
  );
}

/** Every day the calendar shows as a real day (the trip, or the month). */
function dayList(el: CalendarElement): string[] {
  const start = new Date(`${el.start}T00:00:00Z`);
  const end = el.mode === 'month' ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)) : new Date(`${el.end < el.start ? el.start : el.end}T00:00:00Z`);
  const from = el.mode === 'month' ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)) : start;
  const out: string[] = [];
  for (let d = from; d <= end && out.length < 62; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/** A marked "14" in the given style, for the mark picker. */
function MarkPreview({ mark, color }: { mark: (typeof CALENDAR_MARKS)[number]['id']; color: string }) {
  const cell = { x: 0, y: 0, w: 10, h: 10 };
  const m = calendarMark(mark, cell, 4.2);
  const k = 2.6;
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden>
      <path d={mapPath(m.d, (x, y) => [x * k, y * k])} fill={m.fill ? color : 'none'} stroke={m.fill ? undefined : color} strokeWidth={m.strokeMm ? m.strokeMm * k : undefined} strokeLinecap="round" opacity={m.opacity} />
      <text x={13} y={13 + 4.2 * k * 0.35} fontSize={4.2 * k} textAnchor="middle" fill={m.knockout ? '#fff' : 'currentColor'} fontWeight={600}>14</text>
    </svg>
  );
}
