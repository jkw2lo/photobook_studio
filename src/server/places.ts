import { createRequire } from 'node:module';
import * as shared from '../shared/places';

// Place outlines (logic in src/shared/places.ts), from the bundled world-atlas topology.

const require = createRequire(import.meta.url);

let places: shared.Place[] | null = null;

/** Detailed outlines (for drawing). */
const detailed = () => (places ??= shared.placesFromTopology(require('world-atlas/countries-10m.json') as shared.PlacesTopology));

export const listPlaces = () => shared.listPlaces(detailed());
export const placeOutline = (id: string) => shared.placeOutline(detailed(), id);
export const suggestPlaces = (points: [number, number][]) => shared.suggestPlaces(detailed(), points);
