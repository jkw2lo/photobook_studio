// Calendars (trip weeks, months, the 12-month poster, page designs), smart spacing, library
// clean-up, and map outlines — in the model and in the exported PDF.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCalendarAt, applyPageAddon, applyPosterTemplate, calendarLayout, calendarTitle, cleanupSuggestions, createBook, createPoster, generateDraft,
  makeCalendar, maskPath, photoDays, shapePath, sizeSnap, spacingSnap, makeShapeElement, addElement,
  type CalendarElement, type ImageElement,
} from '../src/core';
import { exportPosterPdf } from '../src/server/pdf';
import { listPlaces, placeOutline, suggestPlaces } from '../src/server/places';
import { fakeAsset, resetFakeAssets } from './helpers';

beforeEach(() => resetFakeAssets());
const poster = () => createPoster({ title: 'X', sizeId: 'p16x20' });
const days = (cal: CalendarElement) => calendarLayout(cal).cells.filter((c) => c.kind === 'day');

describe('calendar layer', () => {
  it('a 10-day trip shows only its weeks, with photo days marked and the rest faint', () => {
    const cal = makeCalendar(poster(), { x: 0, y: 0, w: 140 }, ['2026-03-14', '2026-03-16', '2026-03-23'], { mode: 'range', start: '2026-03-14', end: '2026-03-23' });
    const d = days(cal);
    // Sat 14 Mar → Mon 23 Mar, weeks starting Monday: 9 Mar … 29 Mar = 3 weeks.
    expect(d).toHaveLength(21);
    expect(d.filter((c) => !c.faint)).toHaveLength(10);
    expect(d.filter((c) => c.marked).map((c) => c.day)).toEqual(['2026-03-14', '2026-03-16', '2026-03-23']);
    expect(calendarTitle(cal)).toBe('14 – 23 March 2026');
    expect(cal.heightMm).toBeCloseTo((140 / 7) * (1.5 + 0.9 + 3), 6);
  });

  it('a trip across two months labels the 1st of the new month', () => {
    const cal = makeCalendar(poster(), { x: 0, y: 0, w: 140 }, [], { mode: 'range', start: '2026-03-27', end: '2026-04-05' });
    expect(days(cal).some((c) => c.text === 'Apr 1')).toBe(true);
    expect(calendarTitle(cal)).toBe('27 Mar – 5 Apr 2026');
  });

  it('a month shows only its own days, starting on the right weekday', () => {
    const cal = makeCalendar(poster(), { x: 0, y: 0, w: 140 }, ['2026-02-14'], { mode: 'month', start: '2026-02-01' });
    const d = days(cal);
    expect(d).toHaveLength(28);
    // 1 Feb 2026 is a Sunday: last column when weeks start on Monday.
    expect(d[0].x).toBeCloseTo((140 / 7) * 6, 6);
    expect(d.find((c) => c.day === '2026-02-14')?.marked).toBe(true);
    expect(calendarTitle(cal)).toBe('February 2026');
  });

  it('dates and marks default to the photo days, and the calendar sits where asked', () => {
    const assets = [fakeAsset({ capturedAt: '2026-07-02T10:00:00' }), fakeAsset({ capturedAt: '2026-07-04T10:00:00' }), fakeAsset({ capturedAt: '2026-07-04T18:00:00' })];
    const ds = photoDays(assets);
    expect(ds).toEqual(['2026-07-02', '2026-07-04']);
    const doc = poster();
    const { doc: next, newId } = addCalendarAt(doc, doc.spreads[0].id, 200, 250, ds, { mode: 'range' });
    const cal = next.spreads[0].elements.find((e) => e.id === newId) as CalendarElement;
    expect(cal.start).toBe('2026-07-02');
    expect(cal.end).toBe('2026-07-04');
    expect(cal.yMm + cal.heightMm / 2).toBeCloseTo(250, 6);
  });

  it('page designs: Trip calendar and Year at a glance', () => {
    const assets = Array.from({ length: 30 }, (_, i) => fakeAsset({ day: 1 + Math.floor(i / 10), widthPx: 6000, heightPx: 4000 }));
    const book = generateDraft(createBook({ title: 'Lisbon', pages: 24 }), assets, { targetPages: 24, stylePresetId: 'editorial', ordering: 'chronological', includeCaptions: true, seed: 1 }).doc;
    const ds = photoDays(assets);
    const trip = applyPageAddon(book, 2, 'right', 'trip-calendar', { photoDays: ds });
    const cals = trip.spreads[2].elements.filter((e): e is CalendarElement => e.type === 'calendar');
    expect(cals).toHaveLength(1);
    expect(cals[0].highlights).toEqual(ds);
    const year = applyPageAddon(book, 3, 'left', 'year-glance', { photoDays: ds });
    const months = year.spreads[3].elements.filter((e): e is CalendarElement => e.type === 'calendar');
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.title)).toContain('March');
    for (const m of months) expect(m.xMm + m.widthMm).toBeLessThanOrEqual(book.settings.trimWidthMm + 0.01);
  });

  it('the 12-month poster: each month’s best photo (pinned) over its calendar', () => {
    const assets = Array.from({ length: 36 }, (_, i) => fakeAsset({ capturedAt: `2025-${String((i % 12) + 1).padStart(2, '0')}-${String(10 + Math.floor(i / 12)).padStart(2, '0')}T12:00:00`, widthPx: 6000, heightPx: 4000 }));
    const { doc } = applyPosterTemplate(poster(), assets, 'months');
    const els = doc.spreads[0].elements;
    const photos = els.filter((e): e is ImageElement => e.type === 'image');
    const cals = els.filter((e): e is CalendarElement => e.type === 'calendar');
    expect(photos).toHaveLength(12);
    expect(photos.every((p) => p.pinned && p.assetId)).toBe(true);
    expect(cals).toHaveLength(12);
    expect(cals[0].start).toBe('2025-01-01');
    expect(cals[0].highlights).toHaveLength(3);
    expect(els.some((e) => e.type === 'text' && e.text === '2025')).toBe(true);
  });
});

describe('smart spacing', () => {
  const row = [{ x: 0, y: 0, w: 40, h: 30 }, { x: 50, y: 0, w: 40, h: 30 }]; // gap 10
  it('snaps to the same gap as an existing pair', () => {
    const moving = { x: 101.5, y: 0, w: 40, h: 30 };
    const s = spacingSnap(moving, row, 3);
    expect(s.x?.d).toBeCloseTo(-1.5, 6); // 90 + 10 = 100
    expect(s.x?.marks).toHaveLength(2);
  });
  it('snaps midway between two neighbours', () => {
    const others = [{ x: 0, y: 0, w: 40, h: 30 }, { x: 140, y: 0, w: 40, h: 30 }];
    const s = spacingSnap({ x: 71, y: 0, w: 40, h: 30 }, others, 3);
    expect(s.x?.d).toBeCloseTo(-1, 6); // midway: 40 + (100 - 40) / 2 = 70
  });
  it('ignores items in other rows and far-off positions', () => {
    expect(spacingSnap({ x: 120, y: 100, w: 40, h: 30 }, row, 3).x).toBeNull();
    expect(spacingSnap({ x: 120, y: 0, w: 40, h: 30 }, row, 3).x).toBeNull();
  });
  it('matches sizes while resizing', () => {
    const m = sizeSnap(41.2, 22, row, 2);
    expect(m.w).toBe(40);
    expect(m.matchW).toBe(row[0]);
    expect(m.h).toBe(22);
  });
});

describe('library clean-up', () => {
  it('groups near-identical shots with the best one as keeper, flags blurry and duplicate photos', () => {
    const burst = Array.from({ length: 3 }, (_, i) => fakeAsset({ hash: 'ffff0000ffff0000', minute: 100 + i }));
    burst[1].analysis = { ...burst[1].analysis!, sharpness: 900 };
    const others = Array.from({ length: 12 }, () => fakeAsset());
    const blurry = fakeAsset();
    blurry.analysis = { ...blurry.analysis!, sharpness: 2 };
    const dup = { ...fakeAsset(), exactDuplicateOf: others[0].id };
    const s = cleanupSuggestions([...burst, ...others, blurry, dup]);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].ids.sort()).toEqual(burst.map((a) => a.id).sort());
    expect(s.groups[0].keeperId).toBe(burst[1].id);
    expect(s.weak).toContain(blurry.id);
    expect(s.exactDuplicates).toEqual([dup.id]);
  });
  it('favourites are always the keeper', () => {
    const burst = Array.from({ length: 2 }, (_, i) => fakeAsset({ hash: 'ffff0000ffff0000', minute: 100 + i }));
    burst[0].analysis = { ...burst[0].analysis!, sharpness: 900 };
    burst[1] = { ...burst[1], favorite: true };
    expect(cleanupSuggestions([...burst, fakeAsset(), fakeAsset()]).groups[0].keeperId).toBe(burst[1].id);
  });
});

describe('map outlines', () => {
  it('has Hong Kong, keeps the main area, and fits it without distortion', () => {
    expect(listPlaces().some((p) => p.name === 'Hong Kong')).toBe(true);
    const hk = placeOutline('Hong Kong');
    expect(hk.aspect).toBeGreaterThan(1);
    expect(hk.d.startsWith('M')).toBe(true);
    const pt = placeOutline('Portugal');
    expect(pt.aspect).toBeLessThan(0.7); // mainland only: tall and narrow, no Azores
    const m = maskPath({ kind: 'outline', d: 'M0 0L200 0L200 100L0 100Z', aspect: 2 }, 100, 100);
    expect(m.d).toBe('M0 25L100 25L100 75L0 75Z');
  });
  it('suggests places from photo GPS', () => {
    expect(suggestPlaces([[114.172, 22.297], [114.158, 22.282], [-9.14, 38.72]])[0]).toMatchObject({ name: 'Hong Kong', photos: 2 });
  });
  it('prints a map sticker (outline only) and a calendar in the PDF', async () => {
    const hk = placeOutline('Hong Kong');
    let doc = poster();
    const sheet = doc.spreads[0].id;
    doc = addElement(doc, sheet, { ...makeShapeElement({ x: 50, y: 50, w: 200, h: 200 / hk.aspect }, 'none'), outline: hk, strokeColor: '#000000', strokeWidthMm: 1 });
    expect(shapePath(doc.spreads[0].elements[0] as never, 200, 200 / hk.aspect).d.length).toBeGreaterThan(100);
    doc = addCalendarAt(doc, sheet, 200, 380, ['2026-03-14', '2026-03-15'], { mode: 'range' }).doc;
    const out = join(mkdtempSync(join(tmpdir(), 'extras-')), 'p.pdf');
    const res = await exportPosterPdf(doc, new Map(), out);
    expect(res.verification.ok).toBe(true);
    expect(readFileSync(out).length).toBeGreaterThan(5000);
  });
});
