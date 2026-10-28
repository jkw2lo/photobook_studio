// Deleting projects (Recently deleted → restore or delete for good), element opacity, and every
// calendar mark style — in the API, the model and the PDF.
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CALENDAR_MARKS, addCalendarAt, addTextAt, calendarMark, createPoster, elementOpacity, makeShapeElement, updateElement, type CalendarElement,
} from '../src/core';
import { createApp } from '../src/server/app';
import { exportPosterPdf } from '../src/server/pdf';

const FIXTURES = join(process.cwd(), 'fixtures', 'generated', 'trip');

describe('deleting projects (API)', () => {
  let dataDir: string;
  let server: Server;
  let base: string;
  let closeStore: () => void;
  const api = async <T = any>(method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as T };
  };
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'delete-'));
    const { app, store } = createApp(dataDir);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeStore = () => store.close();
  });
  afterAll(() => {
    server?.close();
    closeStore?.();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.runIf(existsSync(FIXTURES))('moves to Recently deleted, restores, and deletes for good (cleaning up unused photos only)', async () => {
    const a = (await api('POST', '/api/projects', { title: 'Keep me', product: 'poster', sizeId: 'p11x14' })).body.doc.id;
    const b = (await api('POST', '/api/projects', { title: 'Delete me', product: 'poster', sizeId: 'p11x14' })).body.doc.id;
    // Both projects use the trip photos.
    for (const id of [a, b]) {
      const job = (await api('POST', `/api/projects/${id}/import`, { folder: FIXTURES })).body;
      let st = job;
      while (st.status !== 'done' && st.status !== 'failed') st = (await api('GET', `/api/jobs/${job.id}`)).body;
    }
    const thumbsBefore = readdirSync(join(dataDir, 'thumbs')).length;

    expect((await api('DELETE', `/api/projects/${b}`)).status).toBe(200);
    expect((await api('GET', '/api/projects')).body.map((p: { id: string }) => p.id)).toEqual([a]);
    expect((await api('GET', '/api/projects-deleted')).body.map((p: { title: string }) => p.title)).toEqual(['Delete me']);
    expect((await api('GET', `/api/projects/${b}`)).status).toBe(404);

    expect((await api('POST', `/api/projects/${b}/restore`)).status).toBe(200);
    expect((await api('GET', '/api/projects')).body).toHaveLength(2);

    // "For good" only from Recently deleted.
    expect((await api('DELETE', `/api/projects/${b}?forever=1`)).status).toBe(409);
    await api('DELETE', `/api/projects/${b}`);
    const purged = await api('DELETE', `/api/projects/${b}?forever=1`);
    expect(purged.status).toBe(200);
    expect(purged.body.removedPhotos).toBe(0); // project A still uses every photo
    expect(readdirSync(join(dataDir, 'thumbs')).length).toBe(thumbsBefore);
    expect((await api('GET', '/api/projects-deleted')).body).toEqual([]);

    // Deleting the last project that uses the photos removes them from the catalogue and their thumbnails.
    await api('DELETE', `/api/projects/${a}`);
    expect((await api('DELETE', `/api/projects/${a}?forever=1`)).body.removedPhotos).toBe(21);
    expect(readdirSync(join(dataDir, 'thumbs'))).toEqual([]);
    expect(existsSync(join(FIXTURES, 'day1-01-arrival.jpg'))).toBe(true); // originals untouched
  }, 120_000);
});

describe('opacity and calendar marks', () => {
  it('every element kind has an opacity (1 when unset)', () => {
    const doc = createPoster({ title: 'X', sizeId: 'p11x14' });
    const t = addTextAt(doc, doc.spreads[0].id, 100, 100, 'Hi', 'body');
    const text = t.doc.spreads[0].elements[0];
    expect(elementOpacity(text)).toBe(1);
    const faded = updateElement(t.doc, doc.spreads[0].id, t.newId, { opacity: 0.4 }).spreads[0].elements[0];
    expect(elementOpacity(faded)).toBe(0.4);
    expect(elementOpacity(makeShapeElement({ x: 0, y: 0, w: 1, h: 1 }, '#000', 0.25))).toBe(0.25);
  });

  it('every mark style draws inside its day cell; solid marks knock the number out in white', () => {
    const cell = { x: 10, y: 10, w: 20, h: 20 };
    for (const m of CALENDAR_MARKS) {
      const d = calendarMark(m.id, cell, 8);
      expect(d.d.length, m.id).toBeGreaterThan(5);
      const nums = (d.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      expect(Math.min(...xs), m.id).toBeGreaterThanOrEqual(cell.x - 1);
      expect(Math.max(...xs), m.id).toBeLessThanOrEqual(cell.x + cell.w + 1);
    }
    expect(calendarMark('circle', cell, 8).knockout).toBe(true);
    expect(calendarMark('ring', cell, 8).knockout).toBe(false);
    expect(calendarMark('highlight', cell, 8).opacity).toBeLessThan(1);
  });

  it('prints faded text, calendars with every mark style, and a faded shape', async () => {
    let doc = createPoster({ title: 'X', sizeId: 'p16x20' });
    const sheet = doc.spreads[0].id;
    const t = addTextAt(doc, sheet, 200, 40, 'Faded words', 'title');
    doc = updateElement(t.doc, sheet, t.newId, { opacity: 0.5, backgroundColor: '#ff0000', backgroundOpacity: 0.5, shadow: { color: '#000000', dxMm: 1, dyMm: 1, opacity: 0.5 } });
    CALENDAR_MARKS.forEach((m, i) => {
      const r = addCalendarAt(doc, sheet, 80 + (i % 3) * 120, 120 + Math.floor(i / 3) * 110, ['2026-03-14', '2026-03-16'], { mode: 'range', start: '2026-03-13', end: '2026-03-17' });
      doc = updateElement(r.doc, sheet, r.newId, { markStyle: m.id, opacity: 0.8 } as Partial<CalendarElement>);
    });
    const out = join(mkdtempSync(join(tmpdir(), 'marks-')), 'p.pdf');
    const res = await exportPosterPdf(doc, new Map(), out);
    expect(res.verification.ok).toBe(true);
  });
});
