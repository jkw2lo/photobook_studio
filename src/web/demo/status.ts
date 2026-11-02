// Which projects are the web version's demo, and whether it is still being set up. Kept apart
// from sample.ts (photos, recipe, drafting) so the home page can mark the demo without loading it.

const KEY = 'photobook:demo';
const EVENT = 'photobook:demo';

export interface DemoIds {
  /** Amalfi Coast, the travel journal. */
  book?: string;
  /** Lemon grove, the auto-collage poster. */
  poster?: string;
  /** Japanese teas, the hand-made poster. */
  tea?: string;
}

export type DemoPiece = keyof DemoIds;
export const DEMO_PIECES: DemoPiece[] = ['book', 'poster', 'tea'];
/** For the home page's placeholders while a piece is set up. */
export const DEMO_TITLES: Record<DemoPiece, string> = { book: 'Amalfi Coast', poster: 'Lemon grove', tea: 'Japanese teas' };

export function demoIds(): DemoIds | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as DemoIds | null;
  } catch {
    return null;
  }
}

export function saveDemoIds(ids: DemoIds) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: the demo is set up again next time
  }
  changed();
}

export const isDemoProject = (id: string) => Object.values(demoIds() ?? {}).includes(id);

/** Which demo project this is, if any. */
export const demoPieceOf = (id: string) => DEMO_PIECES.find((k) => demoIds()?.[k] === id) ?? null;

export interface DemoBuilding {
  /** Still to come. */
  pieces: DemoPiece[];
  /** Projects already created by the setup but not finished: hidden until they are. */
  pending: string[];
  text: string;
}

/** What the demo setup is doing right now (null when idle), for the home page's placeholders. */
let building: DemoBuilding | null = null;

export const demoBuilding = () => building;

export function setDemoBuilding(next: DemoBuilding | null) {
  building = next;
  changed();
}

const changed = () => window.dispatchEvent(new Event(EVENT));

/** Call `fn` whenever the demo's projects or setup change; returns the unsubscribe. */
export function onDemoChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
