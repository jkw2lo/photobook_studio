import type { BookDocument, Chapter, Element, GenerationSettings, PhotoAsset, Spread } from './model';
import { pageContentRect, pageNumberOf, spreadsForPageCount, type PageSide } from './book';
import { layoutCollage } from './collage';
import {
  aspectOf, chronological, dateRangeOf, dayKey, formatDay, groupSimilar, scorePhotos, segmentMoments, type PhotoScore,
} from './curation';
import { chooseTemplate, coverDpi, keepSubjectOutOfGutter, layoutPage, placeSubjectOffSpine, templateOrThrow } from './layout';
import { mulberry32, newId, type Rng } from './random';
import { stylePreset, styleFromPreset, type StylePreset } from './styles';
import { clamp } from './units';
import { chooseCoverPhotos, makeCover, reconcileCover } from './cover';

// Deterministic first-draft generator. Stages:
//  1. filter (excluded, missing, exact duplicates, photos already in locked spreads)
//  2. collapse near-duplicates to their best frame (favourites always survive)
//  3. plan page units (title page, spreads, closing page) around locked spreads
//  4. pick panoramic hero spreads, compute a photo budget from the style's density
//  5. select photos for coverage across moments, then sequence chronologically
//  6. distribute photos over pages, choose templates, crop, caption
// Same photos + settings + seed ⇒ identical book.

/** Layout id recorded for pages built by the mosaic engine. */
export const MOSAIC_LAYOUT = 'collage-mosaic';

export interface DraftReport {
  candidates: number;
  excluded: number;
  missing: number;
  exactDuplicates: number;
  nearDuplicatesSet: number;
  selected: number;
  pages: number;
  heroSpreads: number;
  dividerPages: number;
  lockedSpreadsKept: number;
  notes: string[];
}

export interface DraftResult {
  doc: BookDocument;
  report: DraftReport;
}

type Unit =
  | { kind: 'locked'; s: number; spread: Spread }
  | { kind: 'title'; s: number }
  | { kind: 'page'; s: number; side: PageSide }
  | { kind: 'pair'; s: number; hero?: PhotoAsset };

export function generateDraft(doc: BookDocument, assets: PhotoAsset[], settings: GenerationSettings): DraftResult {
  const preset = stylePreset(settings.stylePresetId);
  const bookSettings = doc.settings;
  const style = doc.style.presetId === preset.id ? doc.style : styleFromPreset(preset.id);
  const base = { ...doc, style };
  const rng = mulberry32(settings.seed);
  const notes: string[] = [];

  // ---- 1. locked spreads and filtering
  let spreadCount = spreadsForPageCount(clamp(settings.targetPages, 2, 800));
  const locked = new Map<number, Spread>();
  doc.spreads.forEach((s, i) => s.locked && locked.set(i, s));
  if (locked.size) {
    const maxLocked = Math.max(...locked.keys());
    const wasLast = maxLocked === doc.spreads.length - 1;
    const needed = wasLast ? maxLocked + 1 : maxLocked + 2;
    if (needed > spreadCount) {
      notes.push(`Kept ${needed * 2 - 2} pages instead of ${spreadCount * 2 - 2} so locked spreads are not removed.`);
      spreadCount = needed;
    }
  }
  const lockedAssetIds = new Set<string>();
  for (const s of locked.values()) for (const el of s.elements) if (el.type === 'image' && el.assetId) lockedAssetIds.add(el.assetId);

  const { pool, reps, alternates, scores, excluded, missing, exactDuplicates } = curatePool(assets, lockedAssetIds);
  const score = (a: PhotoAsset) => scores.get(a.id)!.total;
  const nearDuplicatesSet = alternates.length;

  // ---- 3. page units
  const units: Unit[] = [];
  for (let s = 0; s < spreadCount; s++) {
    const l = locked.get(s);
    if (l) units.push({ kind: 'locked', s, spread: l });
    else if (s === 0) units.push({ kind: 'title', s });
    else if (s === spreadCount - 1) units.push({ kind: 'page', s, side: 'left' });
    else units.push({ kind: 'pair', s });
  }
  const pairs = units.filter((u): u is Extract<Unit, { kind: 'pair' }> => u.kind === 'pair');
  const pageSlotsTotal = pairs.length * 2 + units.filter((u) => u.kind === 'page').length;
  const hasTitle = units.some((u) => u.kind === 'title');

  // ---- 4. heroes and budget
  const qualities = reps.map((a) => scores.get(a.id)!.quality).sort((x, y) => x - y);
  const medianQuality = qualities[Math.floor(qualities.length / 2)] ?? 0;
  const heroEligible = chronological(
    // Very wide photos are intentional panoramas: they qualify whatever their quality score.
    reps.filter((a) => aspectOf(a) >= 1.35 && (scores.get(a.id)!.quality >= medianQuality || a.favorite || aspectOf(a) >= 2) && panoramaWorks(base, a)),
  );
  const panoramaAllowed = (preset.templateWeights['panorama'] ?? 0) > 0;
  let heroCount = panoramaAllowed ? Math.round(pairs.length * preset.heroSpreadShare) : 0;
  if (panoramaAllowed && reps.length < pageSlotsTotal + (hasTitle ? 1 : 0)) {
    // Too few photos for the pages: panoramas fill two pages with one photo.
    heroCount = Math.max(heroCount, pageSlotsTotal + (hasTitle ? 1 : 0) - reps.length);
  }
  heroCount = Math.min(heroCount, heroEligible.length, pairs.length);
  const heroes = pickSpread(heroEligible, heroCount, (a) => score(a) + (aspectOf(a) >= 2 ? 1 : 0));
  const heroIds = new Set(heroes.map((h) => h.id));

  const pageSlots = pageSlotsTotal - heroCount * 2;
  const desired = clamp(Math.round(pageSlots * preset.density), pageSlots, pageSlots * preset.maxPerPage);
  let candidates = reps.filter((a) => !heroIds.has(a.id));

  // Title photo only when there are photos to spare.
  let titleWanted = hasTitle && candidates.length > pageSlots;
  let budget = desired + (titleWanted ? 1 : 0);
  if (candidates.length < budget) {
    // Bring back the best alternates (near-duplicates) before resorting to text-only pages.
    const shortBy = Math.min(pageSlots + (titleWanted ? 1 : 0), budget) - candidates.length;
    if (shortBy > 0) {
      const extra = alternates.filter((a) => !heroIds.has(a.id)).slice(0, shortBy);
      if (extra.length) notes.push(`Used ${extra.length} similar shot${extra.length > 1 ? 's' : ''} to fill pages.`);
      candidates = [...candidates, ...extra];
    }
    titleWanted = hasTitle && candidates.length > pageSlots;
    budget = Math.min(budget, candidates.length);
  }
  const favorites = candidates.filter((a) => a.favorite);
  if (favorites.length > pageSlots * preset.maxPerPage) {
    notes.push(`${favorites.length} favourites exceed what ${pageSlotsTotal} pages can hold; some could not be placed.`);
  }
  budget = Math.max(budget, Math.min(favorites.length, pageSlots * preset.maxPerPage + (titleWanted ? 1 : 0)));
  const selected = selectWithCoverage(candidates, budget, scores);

  // ---- 5. sequence
  let titlePhoto: PhotoAsset | undefined;
  if (titleWanted) {
    // The title photo is the largest frame on page 1: it must hold up at print resolution.
    const titleSlot = layoutPage(base, templateOrThrow('title-photo'), 'right', [], {}).find((e) => e.type === 'image')!;
    const sharpEnough = selected.filter((a) => coverDpi({ w: titleSlot.widthMm, h: titleSlot.heightMm }, a) >= bookSettings.minDpiWarning);
    const landscapes = sharpEnough.filter((a) => aspectOf(a) >= 1.1);
    titlePhoto = [...(landscapes.length ? landscapes : sharpEnough)].sort((a, b) => score(b) - score(a))[0];
  }
  const flow = chronological(selected.filter((a) => a !== titlePhoto));
  placeHeroes(pairs, heroes, chronological([...flow, ...heroes]));

  // Chapters: one per day for multi-day collections (by month for long spans).
  const allPlaced = [...flow, ...heroes, ...(titlePhoto ? [titlePhoto] : [])];
  const { chapters, chapterOf } = buildChapters(allPlaced, doc.chapters);

  // ---- 6. pages
  const pageSides: { unit: Unit; side: PageSide }[] = [];
  for (const u of units) {
    if (u.kind === 'pair' && !u.hero) pageSides.push({ unit: u, side: 'left' }, { unit: u, side: 'right' });
    if (u.kind === 'page') pageSides.push({ unit: u, side: u.side });
  }
  // Seed 1 is the considered "best" draft; other seeds explore layouts much more widely.
  const explore = settings.seed !== 1;
  // With chapter openers, every chapter starts on its own opener page and its photos are spread
  // over pages of their own (shared out by photo count); otherwise photos simply flow.
  const runs = settings.chapterOpeners && chapters.length >= 2 ? chapterRuns(flow, chapterOf) : null;
  let counts: number[];
  let openerPages = 0;
  if (runs && pageSides.length >= runs.length * 2) {
    const shares = shareOut(pageSides.length - runs.length, runs);
    counts = runs.flatMap((n, j) => [0, ...distributeCounts(n, shares[j], preset.maxPerPage, rng, explore)]);
    openerPages = runs.length;
  } else counts = distributeCounts(flow.length, pageSides.length, preset.maxPerPage, rng, explore);
  const dividerPages = counts.filter((c) => c === 0).length;
  const fillerPages = dividerPages - openerPages;
  if (fillerPages) notes.push(`Not enough photos for every page: added ${fillerPages} chapter/title page${fillerPages > 1 ? 's' : ''}.`);

  const now = new Date().toISOString();
  const caption = (photos: PhotoAsset[]) =>
    settings.includeCaptions && style.captionMode === 'date' ? dateRangeOf(photos) || undefined : undefined;
  let cursor = 0;
  let slot = 0;
  let prevTemplate = '';
  let currentChapter: string | undefined = chapters[0]?.id;
  const spreads: Spread[] = [];

  for (const u of units) {
    if (u.kind === 'locked') {
      spreads.push(u.spread);
      prevTemplate = '';
      continue;
    }
    const used: PhotoAsset[] = [];
    const elements: Element[] = [];
    const layout: Spread['layout'] = {};
    if (u.kind === 'title') {
      const t = templateOrThrow(titlePhoto ? 'title-photo' : 'title-text');
      if (titlePhoto) used.push(titlePhoto);
      elements.push(...layoutPage(base, t, 'right', used, { title: doc.title, subtitle: doc.subtitle || dateRangeOf(allPlaced) }));
      layout.right = t.id;
    } else if (u.kind === 'pair' && u.hero) {
      const t = templateOrThrow('panorama');
      used.push(u.hero);
      const els = layoutPage(base, t, 'spread', used, {});
      elements.push(...els.map((el) => (el.type === 'image' ? keepSubjectOutOfGutter(el, u.hero!, base) : el)));
      layout.spread = t.id;
      prevTemplate = t.id;
    } else {
      const sides: PageSide[] = u.kind === 'pair' ? ['left', 'right'] : [u.side];
      for (const side of sides) {
        const c = counts[slot++];
        const photos = flow.slice(cursor, cursor + c);
        cursor += c;
        if (c === 0) {
          const next = flow[cursor];
          const ch = chapters.find((x) => x.id === (next ? chapterOf.get(next.id) : currentChapter));
          const t = templateOrThrow('chapter-divider');
          const day = next ? dayKey(next) : null;
          elements.push(...layoutPage(base, t, side, [], { heading: ch?.title ?? doc.title, subtitle: day ? formatDay(day) : '' }));
          layout[side] = t.id;
          prevTemplate = t.id;
          continue;
        }
        if (preset.layoutMode === 'mosaic' && photos.length >= 2) {
          elements.push(...layoutCollage(base, pageContentRect(side, bookSettings, style), photos, { style: 'mosaic', gapMm: style.gapMm, seed: settings.seed }).elements);
          used.push(...photos);
          layout[side] = MOSAIC_LAYOUT;
          prevTemplate = MOSAIC_LAYOUT;
          continue;
        }
        const t = chooseTemplate(preset, photos, [prevTemplate, layout.left ?? ''], rng, base, side, explore ? 1.4 : 0.5);
        elements.push(...layoutPage(base, t, side, photos, { caption: caption(photos) }));
        used.push(...photos);
        layout[side] = t.id;
        prevTemplate = t.id;
      }
    }
    const firstChapter = used.map((a) => chapterOf.get(a.id)).find(Boolean);
    if (firstChapter) currentChapter = firstChapter;
    spreads.push({
      id: newId(),
      locked: false,
      chapterId: u.kind === 'title' ? undefined : currentChapter,
      layout,
      provenance: { generatedAt: now, seed: settings.seed, assetIds: used.map((a) => a.id) },
      elements,
    });
  }

  // Keep chapters still referenced by locked spreads.
  const keptChapters = doc.chapters.filter((c) => [...locked.values()].some((s) => s.chapterId === c.id) && !chapters.some((n) => n.id === c.id));
  let result: BookDocument = {
    ...doc,
    style,
    chapters: [...keptChapters, ...chapters],
    spreads,
    generation: { settings, generatedAt: now },
  };
  // Cover: rebuilt unless locked; a locked cover only follows spine-width changes.
  if (doc.cover?.locked) result = reconcileCover(result);
  else {
    const templateId = doc.cover?.layout?.spread ?? 'cover-band';
    const coverPool = allPlaced.length ? allPlaced : pool;
    result = { ...result, cover: makeCover(result, templateId, chooseCoverPhotos(coverPool, score, titlePhoto), doc.cover?.id) };
  }
  return {
    doc: result,
    report: {
      candidates: pool.length,
      excluded,
      missing,
      exactDuplicates,
      nearDuplicatesSet,
      selected: allPlaced.length,
      pages: spreads.length * 2 - 2,
      heroSpreads: heroes.length,
      dividerPages,
      lockedSpreadsKept: locked.size,
      notes,
    },
  };
}


export interface CuratedPool {
  /** Usable photos: not hidden, not missing, not an exact duplicate, not in `skip`. */
  pool: PhotoAsset[];
  /** Best frame of each near-duplicate group, plus any favourites. */
  reps: PhotoAsset[];
  /** The other frames of each group, best first. */
  alternates: PhotoAsset[];
  scores: Map<string, PhotoScore>;
  excluded: number;
  missing: number;
  exactDuplicates: number;
}

/** Shared curation for books and posters: filter, score, and collapse bursts to their best frame. */
export function curatePool(assets: PhotoAsset[], skip: Set<string> = new Set()): CuratedPool {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const excluded = assets.filter((a) => a.excluded).length;
  const missing = assets.filter((a) => a.missing && !a.excluded).length;
  let exactDuplicates = 0;
  const pool = assets.filter((a) => {
    if (a.excluded || a.missing || skip.has(a.id)) return false;
    const original = a.exactDuplicateOf ? byId.get(a.exactDuplicateOf) : undefined;
    if (original && !original.excluded) {
      exactDuplicates++;
      return false;
    }
    return true;
  });
  const scores = scorePhotos(pool);
  const score = (a: PhotoAsset) => scores.get(a.id)!.total;
  const groups = new Map<string, PhotoAsset[]>();
  const groupOf = groupSimilar(pool);
  for (const a of pool) {
    const g = groupOf.get(a.id)!;
    groups.set(g, [...(groups.get(g) ?? []), a]);
  }
  const reps: PhotoAsset[] = [];
  const alternates: PhotoAsset[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => score(b) - score(a));
    members.forEach((m, i) => (i === 0 || m.favorite ? reps : alternates).push(m));
  }
  alternates.sort((a, b) => score(b) - score(a));
  return { pool, reps, alternates, scores, excluded, missing, exactDuplicates };
}

/** A panorama is only used when it prints sharp enough and its subject can be kept out of the fold. */
function panoramaWorks(doc: BookDocument, asset: PhotoAsset): boolean {
  const [el] = layoutPage(doc, templateOrThrow('panorama'), 'spread', [asset], {});
  if (el.type !== 'image' || coverDpi({ w: el.widthMm, h: el.heightMm }, asset) < doc.settings.minDpiWarning) return false;
  return placeSubjectOffSpine(el, asset, doc).ok;
}

/** Pick `n` items spread evenly across a chronological list, best-scored within each stretch. */
function pickSpread(seq: PhotoAsset[], n: number, score: (a: PhotoAsset) => number): PhotoAsset[] {
  const out: PhotoAsset[] = [];
  for (let k = 0; k < n; k++) {
    const bucket = seq.slice(Math.floor((k * seq.length) / n), Math.floor(((k + 1) * seq.length) / n));
    const best = bucket.sort((a, b) => score(b) - score(a))[0];
    if (best) out.push(best);
  }
  return out;
}

/** Choose `budget` photos: favourites first, then per-moment quotas (∝ √size) so no single event dominates. */
export function selectWithCoverage(cands: PhotoAsset[], budget: number, scores: Map<string, PhotoScore>): PhotoAsset[] {
  const score = (a: PhotoAsset) => scores.get(a.id)?.total ?? 0;
  if (cands.length <= budget) return [...cands];
  const chosen = new Set<PhotoAsset>(cands.filter((a) => a.favorite).sort((a, b) => score(b) - score(a)).slice(0, budget));
  const remaining = budget - chosen.size;
  if (remaining > 0) {
    const moments = segmentMoments(chronological(cands)).map((m) => m.filter((a) => !chosen.has(a)).sort((a, b) => score(b) - score(a)));
    const weights = moments.map((m) => Math.sqrt(m.length));
    const total = weights.reduce((x, y) => x + y, 0) || 1;
    const exact = weights.map((w) => (remaining * w) / total);
    const quotas = exact.map((q, i) => Math.min(Math.floor(q), moments[i].length));
    // Largest remainder for the leftovers.
    let left = remaining - quotas.reduce((x, y) => x + y, 0);
    const order = exact.map((q, i) => ({ i, r: q - Math.floor(q) })).sort((a, b) => b.r - a.r);
    for (const { i } of order) {
      if (left <= 0) break;
      if (quotas[i] < moments[i].length) {
        quotas[i]++;
        left--;
      }
    }
    moments.forEach((m, i) => m.slice(0, quotas[i]).forEach((a) => chosen.add(a)));
    if (chosen.size < budget) {
      for (const a of [...cands].sort((x, y) => score(y) - score(x))) {
        if (chosen.size >= budget) break;
        chosen.add(a);
      }
    }
  }
  return [...chosen];
}

/** Put each hero on the spread matching its place in the story; collisions move to the nearest free spread. */
function placeHeroes(pairs: Extract<Unit, { kind: 'pair' }>[], heroes: PhotoAsset[], seq: PhotoAsset[]) {
  for (const hero of heroes) {
    const f = seq.length > 1 ? seq.indexOf(hero) / (seq.length - 1) : 0.5;
    const target = Math.round(f * (pairs.length - 1));
    for (let d = 0; d < pairs.length; d++) {
      const cand = [target - d, target + d].find((i) => i >= 0 && i < pairs.length && !pairs[i].hero);
      if (cand !== undefined) {
        pairs[cand].hero = hero;
        break;
      }
    }
  }
}

export function distributeCounts(total: number, n: number, maxPer: number, rng: Rng, explore = false): number[] {
  if (n <= 0) return [];
  if (total <= n) {
    const counts = Array<number>(n).fill(1);
    const zeros = n - total;
    for (let k = 0; k < zeros; k++) {
      // Variations move the text-only pages around instead of always spacing them evenly.
      const jitter = explore ? (rng() - 0.5) * 0.9 : 0;
      const i = Math.min(n - 1, Math.max(0, Math.floor(((k + 0.5 + jitter) * n) / zeros)));
      counts[counts[i] === 0 ? (i + 1) % n : i] = 0;
    }
    return counts;
  }
  const baseCount = Math.floor(total / n);
  const extra = total % n;
  const counts = Array.from({ length: n }, (_, i) => baseCount + (Math.floor(((i + 1) * extra) / n) - Math.floor((i * extra) / n)));
  // Variety: break up runs of identical density without changing the total.
  for (let i = 0; i < n - 1; i++) {
    if (counts[i] !== counts[i + 1] || rng() > (explore ? 0.8 : 0.55)) continue;
    const [lo, hi] = rng() < 0.5 ? [i, i + 1] : [i + 1, i];
    if (counts[lo] > 1 && counts[hi] < maxPer) {
      counts[lo]--;
      counts[hi]++;
      i++;
    }
  }
  return counts;
}

/** Lengths of consecutive runs of photos in the same chapter (photos in time order). */
function chapterRuns(flow: PhotoAsset[], chapterOf: Map<string, string>): number[] {
  // Photos without a chapter (undated) stay with the chapter around them — no opener of their own.
  const runs: number[] = [];
  let prev: string | undefined;
  for (const a of flow) {
    const c = chapterOf.get(a.id);
    if (runs.length && (c === prev || c === undefined)) runs[runs.length - 1]++;
    else if (!runs.length && c === undefined) runs.push(1);
    else if (runs.length === 1 && prev === undefined) {
      runs[0]++;
      prev = c;
    } else {
      runs.push(1);
      prev = c;
    }
  }
  return runs;
}

/** Split `total` pages over runs in proportion to their size, at least one page each. */
function shareOut(total: number, runs: number[]): number[] {
  const sum = runs.reduce((a, b) => a + b, 0) || 1;
  const exact = runs.map((n) => Math.max(1, (total * n) / sum));
  const out = exact.map((x) => Math.max(1, Math.floor(x)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length].i]++;
  for (let k = 0; left < 0; k++) {
    const i = out.indexOf(Math.max(...out));
    if (out[i] <= 1) break;
    out[i]--;
    left++;
  }
  return out;
}

/** Chapters by day (or month). Existing chapter ids are reused by title so locked spreads keep matching. */
function buildChapters(photos: PhotoAsset[], existing: Chapter[] = []): { chapters: Chapter[]; chapterOf: Map<string, string> } {
  const days = [...new Set(photos.map(dayKey).filter((d): d is string => !!d))].sort();
  const chapterOf = new Map<string, string>();
  if (days.length < 2) return { chapters: [], chapterOf };
  const byMonth = days.length > 14;
  const keyOf = (d: string) => (byMonth ? d.slice(0, 7) : d);
  const keys = [...new Set(days.map(keyOf))];
  const chapters = keys.map((k, i) => {
    const title = byMonth ? monthTitle(k) : `Day ${i + 1}`;
    return { id: existing.find((c) => c.title === title)?.id ?? newId(), title };
  });
  const idOfKey = new Map(keys.map((k, i) => [k, chapters[i].id]));
  for (const p of photos) {
    const d = dayKey(p);
    if (d) chapterOf.set(p.id, idOfKey.get(keyOf(d))!);
  }
  return { chapters, chapterOf };
}

function monthTitle(key: string): string {
  return formatDay(`${key}-01`).replace(/^1 /, '');
}

/** Page numbers of a spread, for messages: "pages 4–5", "page 1". */
export function spreadPagesLabel(index: number, count: number): string {
  const l = pageNumberOf(index, 'left', count);
  const r = pageNumberOf(index, 'right', count);
  if (l && r) return `pages ${l}–${r}`;
  return `page ${l ?? r}`;
}

export function defaultGenerationSettings(doc: BookDocument, photoCount: number): GenerationSettings {
  const pages = doc.spreads.length * 2 - 2;
  return {
    targetPages: pages > 2 ? pages : clamp(Math.round(photoCount / 2 / 2) * 2, 10, 40),
    stylePresetId: doc.style.presetId,
    ordering: 'chronological',
    includeCaptions: true,
    seed: 1,
  };
}

export type { StylePreset };
