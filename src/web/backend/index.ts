import { httpBackend } from './http';
import type { Backend } from './types';

// The build chooses the backend: the local server (default) or the in-browser one (`--mode pages`).
// The unused one is left out of the bundle.
export const backend: Backend = __BROWSER_BACKEND__ ? (await import('./browser')).browserBackend : httpBackend;
