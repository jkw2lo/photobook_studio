import type { PhotoAsset } from './model';
import { chronological, groupSimilar, scorePhotos } from './curation';

// Library clean-up: suggestions for which photos to hide — the weaker frames of each burst of
// near-identical shots, photos that are clearly blurry, badly exposed ones, and exact duplicates.
// Nothing is decided for you: the review screen shows them side by side and you pick.

export interface SimilarGroup {
  /** In time order. */
  ids: string[];
  /** The suggested keeper: the best-scoring shot (favourites always win). */
  keeperId: string;
}

export interface PhotoFlags {
  blurry: boolean;
  dark: boolean;
  bright: boolean;
  lowRes: boolean;
}

export interface CleanupSuggestions {
  groups: SimilarGroup[];
  /** Not in a group, but blurry or badly exposed. */
  weak: string[];
  exactDuplicates: string[];
  flags: Map<string, PhotoFlags>;
  quality: Map<string, number>;
}

export function cleanupSuggestions(assets: PhotoAsset[]): CleanupSuggestions {
  const live = assets.filter((a) => !a.missing && a.analysis);
  const scores = scorePhotos(live);
  const sharp = live.map((a) => a.analysis!.sharpness).sort((x, y) => x - y);
  // Blurry: in the softest tenth of this collection and well below its median sharpness.
  const p10 = sharp[Math.floor(sharp.length * 0.1)] ?? 0;
  const median = sharp[Math.floor(sharp.length / 2)] ?? 0;
  const flags = new Map<string, PhotoFlags>();
  for (const a of live) {
    const an = a.analysis!;
    flags.set(a.id, {
      blurry: sharp.length >= 5 && an.sharpness <= p10 && an.sharpness < median * 0.5,
      dark: an.meanLuma < 0.16 || an.clippedShadows > 0.35,
      bright: an.meanLuma > 0.86 || an.clippedHighlights > 0.3,
      lowRes: a.widthPx * a.heightPx < 1.5e6,
    });
  }
  const exactDuplicates = live.filter((a) => a.exactDuplicateOf).map((a) => a.id);
  const dupSet = new Set(exactDuplicates);
  const candidates = live.filter((a) => !dupSet.has(a.id));
  const groupOf = groupSimilar(candidates);
  const members = new Map<string, PhotoAsset[]>();
  for (const a of candidates) {
    const g = groupOf.get(a.id)!;
    members.set(g, [...(members.get(g) ?? []), a]);
  }
  const score = (a: PhotoAsset) => scores.get(a.id)?.total ?? 0;
  const groups: SimilarGroup[] = [...members.values()]
    .filter((m) => m.length > 1)
    .map((m) => {
      const ordered = chronological(m);
      const keeper = [...m].sort((a, b) => Number(b.favorite) - Number(a.favorite) || score(b) - score(a))[0];
      return { ids: ordered.map((a) => a.id), keeperId: keeper.id };
    })
    .sort((a, b) => b.ids.length - a.ids.length);
  const grouped = new Set(groups.flatMap((g) => g.ids));
  const weak = chronological(candidates.filter((a) => !grouped.has(a.id) && !a.favorite && (flags.get(a.id)!.blurry || flags.get(a.id)!.dark || flags.get(a.id)!.bright))).map((a) => a.id);
  return { groups, weak, exactDuplicates, flags, quality: new Map([...scores].map(([id, s]) => [id, s.quality])) };
}
