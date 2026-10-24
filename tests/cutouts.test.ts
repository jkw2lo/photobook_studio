// Cutouts (photos with transparency) and sheet background images: detected at import, kept
// see-through in previews and in the PDF, laid out whole, and a background that Arrange never touches.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COLLAGE_STYLES, addPhotoAt, groupSimilar, backgroundFrame, createPoster, generatePoster, preflight, relayoutPoster, setBackgroundImage, setFramePhoto,
  swapFramePhotos, updateBackgroundImage, useAsBackground,
  type BookDocument, type ImageElement, type PhotoAsset,
} from '../src/core';
import { createApp } from '../src/server/app';
import { Store } from '../src/server/db';
import { hasTransparency, makeThumbnails } from '../src/server/media';
import { fakeAsset, resetFakeAssets } from './helpers';

const imgs = (doc: BookDocument) => doc.spreads[0].elements.filter((e): e is ImageElement => e.type === 'image');
const assetMap = (a: PhotoAsset[]) => new Map(a.map((x) => [x.id, x]));
const cutout = (over: Parameters<typeof fakeAsset>[0] = {}) => {
  const a = fakeAsset({ format: 'png', ...over });
  return { ...a, analysis: { ...a.analysis!, transparent: true } };
};
const base = { style: 'mosaic' as const, photoCount: 20, gapMm: 3, marginMm: 15, titlePosition: 'none' as const, seed: 1 };

// A red disc on a see-through square; an "RGBA" PNG that is fully opaque; a plain photo.
const disc = (w: number, h: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.4}" fill="#d22"/></svg>`);
async function writeFixtures(dir: string) {
  await sharp(disc(2400, 1800)).png().toFile(join(dir, 'sticker.png'));
  await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 1 } } }).png().toFile(join(dir, 'opaque-alpha.png'));
  await sharp({ create: { width: 6000, height: 4000, channels: 3, background: { r: 240, g: 220, b: 180 } } }).jpeg().toFile(join(dir, 'paper.jpg'));
}

beforeEach(() => resetFakeAssets());

describe('detecting transparency', () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cutout-'));
    await writeFixtures(dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds real see-through pixels, not just an alpha channel', async () => {
    expect(await hasTransparency(join(dir, 'sticker.png'))).toBe(true);
    expect(await hasTransparency(join(dir, 'opaque-alpha.png'))).toBe(false);
    expect(await hasTransparency(join(dir, 'paper.jpg'))).toBe(false);
  });

  it('cutout previews are WebP with transparency; photos stay JPEG', async () => {
    const data = mkdtempSync(join(tmpdir(), 'thumbs-'));
    mkdirSync(join(data, 'thumbs'));
    await makeThumbnails(join(dir, 'sticker.png'), data, 'c', true);
    await makeThumbnails(join(dir, 'paper.jpg'), data, 'p', false);
    const m = await sharp(join(data, 'thumbs', 'c_m.webp')).metadata();
    expect(m.hasAlpha).toBe(true);
    expect(existsSync(join(data, 'thumbs', 'c_m.jpg'))).toBe(false);
    expect(existsSync(join(data, 'thumbs', 'p_m.jpg'))).toBe(true);
    rmSync(data, { recursive: true, force: true });
  });
});

describe('cutouts in layouts', () => {
  it.each(COLLAGE_STYLES.map((s) => s.id))('%s: cutouts are shown whole, with no border; photos still fill their frames', (style) => {
    const assets = [...Array.from({ length: 12 }, () => fakeAsset()), ...Array.from({ length: 6 }, () => cutout())];
    const { doc } = generatePoster(createPoster({ title: 'X', sizeId: 'p18x24' }), assets, { ...base, style, photoCount: 18 });
    const frames = imgs(doc);
    const isCut = (f: ImageElement) => assets.find((a) => a.id === f.assetId)!.analysis!.transparent;
    expect(frames.filter(isCut).length).toBeGreaterThan(0);
    for (const f of frames.filter(isCut)) {
      expect(f.fit).toBe('contain');
      expect(f.borderMm).toBe(0);
    }
    for (const f of frames.filter((x) => !isCut(x))) expect(f.fit).toBe('cover');
  });

  it('dropping or swapping a cutout into a frame shows it whole; a photo replacing it fills again', () => {
    const photo = fakeAsset();
    const sticker = cutout();
    let doc = createPoster({ title: 'X', sizeId: 'p16x20' });
    const sheet = doc.spreads[0].id;
    const a = addPhotoAt(doc, sheet, photo, 100, 100);
    const b = addPhotoAt(a.doc, sheet, photo, 250, 250);
    doc = setFramePhoto(b.doc, sheet, a.newId, sticker);
    expect(imgs(doc).find((e) => e.id === a.newId)!.fit).toBe('contain');
    doc = swapFramePhotos(doc, { spreadId: sheet, elementId: a.newId }, { spreadId: sheet, elementId: b.newId }, assetMap([photo, sticker]));
    expect(imgs(doc).find((e) => e.id === a.newId)!.fit).toBe('cover');
    expect(imgs(doc).find((e) => e.id === b.newId)!.fit).toBe('contain');
  });
});

describe('look-alike cutouts', () => {
  it('same shape in different colours is not a burst of near-duplicates', () => {
    const red = cutout({ hash: 'ffff0000ffff0000', capturedAt: null });
    const blue = cutout({ hash: 'ffff0000ffff0000', capturedAt: null });
    red.analysis = { ...red.analysis!, avgColor: [230, 57, 70] };
    blue.analysis = { ...blue.analysis!, avgColor: [38, 70, 83] };
    const g = groupSimilar([red, blue]);
    expect(g.get(red.id)).not.toBe(g.get(blue.id));
    // Same colours as well: still a re-take.
    const again = { ...blue, id: 'again', analysis: { ...blue.analysis!, avgColor: [40, 72, 80] as [number, number, number] } };
    const g2 = groupSimilar([blue, again]);
    expect(g2.get(blue.id)).toBe(g2.get('again'));
  });
});

describe('sheet background image', () => {
  it('covers the sheet and its bleed, sits behind the collage, and Arrange leaves it alone', () => {
    const assets = Array.from({ length: 30 }, () => fakeAsset({ widthPx: 6000, heightPx: 4000 }));
    const bgPhoto = assets[0];
    let doc = createPoster({ title: 'X', sizeId: 'p18x24' });
    doc = setBackgroundImage(doc, doc.spreads[0].id, bgPhoto);
    doc = updateBackgroundImage(doc, doc.spreads[0].id, { opacity: 0.4, fit: 'contain' });
    const g = { width: doc.settings.trimWidthMm, height: doc.settings.trimHeightMm, bleed: doc.settings.bleedMm };
    const frame = backgroundFrame(doc.spreads[0], g)!;
    expect(frame.xMm).toBeCloseTo(-g.bleed);
    expect(frame.widthMm).toBeCloseTo(g.width + 2 * g.bleed);
    expect(frame.opacity).toBe(0.4);

    for (const next of [
      generatePoster(doc, assets, base).doc,
      generatePoster(doc, assets, { ...base, seed: 4, source: 'all' }).doc,
      relayoutPoster(generatePoster(doc, assets, base).doc, assetMap(assets), { ...base, style: 'scatter' }, { shuffle: true }),
    ]) {
      expect(next.spreads[0].backgroundImage).toEqual(doc.spreads[0].backgroundImage);
      // The background photo isn't repeated in the collage.
      expect(imgs(next).some((e) => e.assetId === bgPhoto.id)).toBe(false);
    }
  });

  it('“Use as background” takes a photo out of the collage and puts it behind', () => {
    const assets = Array.from({ length: 20 }, () => fakeAsset());
    let doc = generatePoster(createPoster({ title: 'X', sizeId: 'p16x20' }), assets, base).doc;
    const target = imgs(doc)[2];
    doc = useAsBackground(doc, doc.spreads[0].id, target.id, assets.find((a) => a.id === target.assetId)!);
    expect(imgs(doc).some((e) => e.id === target.id)).toBe(false);
    expect(doc.spreads[0].backgroundImage?.assetId).toBe(target.assetId);
  });

  it('preflight flags a background photo too small for the sheet', () => {
    const small = fakeAsset({ widthPx: 800, heightPx: 600 });
    let doc = createPoster({ title: 'X', sizeId: 'p24x36' });
    doc = setBackgroundImage(doc, doc.spreads[0].id, small);
    const issues = preflight(doc, assetMap([small])).filter((i) => i.code === 'low-dpi');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('background');
  });
});

describe('import, backfill and export (API)', () => {
  let dataDir: string;
  let photoDir: string;
  let server: Server;
  let storeClose: () => void;
  let baseUrl: string;
  const api = async <T = any>(method: string, path: string, body?: unknown) => {
    const res = await fetch(baseUrl + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as T, type: res.headers.get('content-type') };
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cutout-data-'));
    photoDir = mkdtempSync(join(tmpdir(), 'cutout-photos-'));
    await writeFixtures(photoDir);
    const { app, store } = createApp(dataDir);
    await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', () => r())));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storeClose = () => store.close();
  });
  afterAll(() => {
    server?.close();
    storeClose?.();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(photoDir, { recursive: true, force: true });
  });

  it('imports a cutout, serves a see-through preview, re-detects older imports, and prints it over a background', async () => {
    const created = await api('POST', '/api/projects', { title: 'Stickers', product: 'poster', sizeId: 'p11x14' });
    const projectId = created.body.doc.id;
    const job = await api('POST', `/api/projects/${projectId}/import`, { folder: photoDir });
    let status = job.body;
    while (status.status !== 'done' && status.status !== 'failed') status = (await api('GET', `/api/jobs/${job.body.id}`)).body;
    let assets = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body;
    const sticker = assets.find((a) => a.fileName === 'sticker.png')!;
    const paper = assets.find((a) => a.fileName === 'paper.jpg')!;
    expect(sticker.analysis?.transparent).toBe(true);
    expect(assets.find((a) => a.fileName === 'opaque-alpha.png')!.analysis?.transparent).toBe(false);
    const thumb = await fetch(`${baseUrl}/api/assets/${sticker.id}/thumb?size=m`);
    expect(thumb.headers.get('content-type')).toContain('image/webp');

    // A cutout imported before transparency detection: flattened JPEG previews, no flag.
    const db = new Store(dataDir);
    const { transparent: _t, ...older } = sticker.analysis!;
    db.updateAnalysis(sticker.id, older);
    db.close();
    for (const s of ['s', 'm']) {
      unlinkSync(join(dataDir, 'thumbs', `${sticker.id}_${s}.webp`));
      writeFileSync(join(dataDir, 'thumbs', `${sticker.id}_${s}.jpg`), await sharp(join(photoDir, 'sticker.png')).flatten({ background: '#fff' }).jpeg().toBuffer());
    }
    assets = (await api<PhotoAsset[]>('GET', `/api/projects/${projectId}/assets`)).body;
    expect(assets.find((a) => a.id === sticker.id)!.analysis?.transparent).toBe(true);
    expect((await fetch(`${baseUrl}/api/assets/${sticker.id}/thumb?size=s`)).headers.get('content-type')).toContain('image/webp');

    // Poster: paper texture behind at 50 %, the sticker on top.
    let doc: BookDocument = created.body.doc;
    const sheet = doc.spreads[0].id;
    doc = setBackgroundImage(doc, sheet, paper);
    doc = updateBackgroundImage(doc, sheet, { opacity: 0.5 });
    doc = addPhotoAt(doc, sheet, assets.find((a) => a.id === sticker.id)!, 140, 180).doc;
    const res = await api('POST', `/api/projects/${projectId}/export`, { doc });
    expect(res.status).toBe(200);
    expect(res.body.verification.ok).toBe(true);
    const raw = readFileSync(res.body.path).toString('latin1');
    expect(raw).toContain('/SMask'); // the cutout keeps its transparency
    expect(raw).toMatch(/\/ca 0\.5\b/); // the faded background
    expect((raw.match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
