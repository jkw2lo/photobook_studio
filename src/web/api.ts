import { backend } from './backend';

// The editor's backend: the local server, or (in the web version) the in-browser implementation.
// Components import `api` and the URL helpers from here and never care which one it is.

export * from './backend/types';

export const api = backend;

export const isBrowserBackend = backend.kind === 'browser';

export const shelfPreviewUrl = (path: string) => backend.shelfPreviewUrl(path);

export const thumbUrl = (assetId: string, size: 's' | 'm' = 's') => backend.thumbUrl(assetId, size);

export const downloadUrl = (url: string) => backend.downloadUrl(url);
