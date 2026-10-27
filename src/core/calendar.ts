import type { BookDocument, CalendarElement, PhotoAsset } from './model';
import { addElement } from './commands';
import { newId } from './random';
import { roleStyle } from './typography';
import { MM_PER_PT } from './units';

// Calendar layer: a small calendar you can drop on a page or poster. "Trip" shows only the weeks
// a trip covers (a week and a half, not the whole month), "Month" shows a whole month; either way
// the days you took photos are marked. The layout is computed here once and drawn identically by
// the editor (SVG) and the PDF exporter.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** 'YYYY-MM-DD' ↔ a UTC date (calendar days, no time zones involved). */
export const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export interface CalendarCell {
  kind: 'title' | 'weekday' | 'day';
  text: string;
  /** Box in element-local mm. */
  x: number;
  y: number;
  w: number;
  h: number;
  day?: string;
  marked?: boolean;
  /** Outside the trip (range) or the month: shown faint, or not at all. */
  faint?: boolean;
}

export interface CalendarLayout {
  cells: CalendarCell[];
  /** Font sizes in mm for each kind of cell. */
  titleMm: number;
  dayMm: number;
  weekdayMm: number;
}

/** Days shown, in whole weeks: the trip's weeks, or the month's weeks. */
function shownWeeks(el: Pick<CalendarElement, 'mode' | 'start' | 'end' | 'weekStart'>): { first: Date; weeks: number; inside: (d: Date) => boolean } {
  const start = parseDay(el.start);
  const end = el.mode === 'month' ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)) : parseDay(el.end < el.start ? el.start : el.end);
  const from = el.mode === 'month' ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)) : start;
  const back = (from.getUTCDay() - el.weekStart + 7) % 7;
  const first = addDays(from, -back);
  const days = Math.round((end.getTime() - first.getTime()) / 86_400_000) + 1;
  const weeks = Math.max(1, Math.min(10, Math.ceil(days / 7)));
  return { first, weeks, inside: (d) => d >= from && d <= end };
}

/** The calendar's title: "14 – 23 March 2026" for a trip, "March 2026" for a month. */
export function calendarTitle(el: Pick<CalendarElement, 'mode' | 'start' | 'end'>): string {
  const a = parseDay(el.start);
  if (el.mode === 'month') return `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  const b = parseDay(el.end < el.start ? el.start : el.end);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  if (el.start === el.end || b <= a) return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  if (sameYear && a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return `${a.getUTCDate()} ${MON[a.getUTCMonth()]}${sameYear ? '' : ` ${a.getUTCFullYear()}`} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

export function calendarLayout(el: CalendarElement): CalendarLayout {
  const { first, weeks, inside } = shownWeeks(el);
  const W = el.widthMm;
  const H = el.heightMm;
  const titleRows = el.showTitle ? 1.5 : 0;
  const rows = titleRows + (el.showWeekdays ? 0.9 : 0) + weeks;
  const rowH = H / rows;
  const colW = W / 7;
  const cell = Math.min(rowH, colW);
  const cells: CalendarCell[] = [];
  let y = 0;
  if (el.showTitle) {
    cells.push({ kind: 'title', text: el.title?.trim() || calendarTitle(el), x: 0, y, w: W, h: rowH * titleRows });
    y += rowH * titleRows;
  }
  if (el.showWeekdays) {
    for (let c = 0; c < 7; c++) cells.push({ kind: 'weekday', text: WEEKDAYS[(c + el.weekStart) % 7], x: c * colW, y, w: colW, h: rowH * 0.9 });
    y += rowH * 0.9;
  }
  const marked = new Set(el.highlights);
  for (let r = 0; r < weeks; r++) {
    for (let c = 0; c < 7; c++) {
      const d = addDays(first, r * 7 + c);
      const day = isoDay(d);
      const isIn = inside(d);
      if (!isIn && el.mode === 'month') continue; // months show only their own days
      // A trip that crosses into a new month labels the 1st with the month.
      const label = el.mode === 'range' && d.getUTCDate() === 1 ? `${MON[d.getUTCMonth()]} 1` : String(d.getUTCDate());
      cells.push({ kind: 'day', text: label, x: c * colW, y: y + r * rowH, w: colW, h: rowH, day, marked: isIn && marked.has(day), faint: !isIn });
    }
  }
  return {
    cells,
    titleMm: Math.min(rowH * titleRows * 0.5, W / Math.max(8, (el.title?.trim() || calendarTitle(el)).length * 0.62)),
    dayMm: cell * 0.42,
    weekdayMm: cell * 0.34,
  };
}

/** Distinct days the given photos were taken, sorted. */
export function photoDays(photos: PhotoAsset[]): string[] {
  return [...new Set(photos.map((a) => a.capturedAt?.slice(0, 10)).filter((d): d is string => !!d))].sort();
}

/** Photos on the pages of a document (falls back to every photo given when none are placed). */
export function photosOfDocument(doc: BookDocument, assets: PhotoAsset[]): PhotoAsset[] {
  const ids = new Set([...doc.spreads, ...(doc.cover ? [doc.cover] : [])].flatMap((s) => s.elements.flatMap((e) => (e.type === 'image' && e.assetId ? [e.assetId] : []))));
  const placed = assets.filter((a) => ids.has(a.id));
  return placed.length ? placed : assets.filter((a) => !a.excluded);
}

export interface CalendarOptions {
  mode: 'range' | 'month';
  start?: string;
  end?: string;
  highlights?: string[];
}

/**
 * A calendar element sized to its content: a trip of ~10 days is two weeks tall, a month is five
 * or six. Dates default to the photos' days.
 */
export function makeCalendar(doc: Pick<BookDocument, 'style' | 'settings'>, rect: { x: number; y: number; w: number }, days: string[], opts: CalendarOptions): CalendarElement {
  const today = isoDay(new Date());
  const start = opts.start ?? days[0] ?? today;
  const end = opts.end ?? days[days.length - 1] ?? start;
  const draft: CalendarElement = {
    id: newId(), type: 'calendar', xMm: rect.x, yMm: rect.y, widthMm: rect.w, heightMm: rect.w, rotationDeg: 0, locked: false,
    mode: opts.mode, start, end, highlights: opts.highlights ?? days, weekStart: 1, showTitle: true, showWeekdays: true,
    fontFamily: roleStyle(doc.style, 'label').family, fontWeight: 600, color: doc.style.textColor, accent: '#c0574f', markStyle: 'circle',
  };
  // Height for square-ish day cells.
  const { weeks } = shownWeeks(draft);
  const rowH = rect.w / 7;
  return { ...draft, heightMm: rowH * (1.5 + 0.9 + weeks) };
}

/** Add a calendar centred on a point; dates and marks come from `days` (photo days). */
export function addCalendarAt(doc: BookDocument, surfaceId: string, x: number, y: number, days: string[], opts: CalendarOptions): { doc: BookDocument; newId: string } {
  const short = Math.min(doc.settings.trimWidthMm, doc.settings.trimHeightMm);
  const w = short * (opts.mode === 'month' ? 0.42 : 0.5);
  const el = makeCalendar(doc, { x: x - w / 2, y: 0, w }, days, opts);
  const placed = { ...el, yMm: y - el.heightMm / 2 };
  return { doc: addElement(doc, surfaceId, placed), newId: placed.id };
}

/** Change a calendar's dates or mode and resize its height to fit the weeks shown. */
export function fitCalendarHeight(el: CalendarElement): number {
  const { weeks } = shownWeeks(el);
  const rows = (el.showTitle ? 1.5 : 0) + (el.showWeekdays ? 0.9 : 0) + weeks;
  return (el.widthMm / 7) * rows;
}

export const calendarFontMm = (pt: number) => pt * MM_PER_PT;
