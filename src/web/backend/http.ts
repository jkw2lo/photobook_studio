import { ApiError, type Backend, type ExportResponse, type FlipbookResponse, type FolderListing, type ImageExportResponse, type ImportJob, type LinkedFolder, type ProjectSummary, type ShelfListing } from './types';
import type { BookDocument, PhotoAsset } from '../../core';

// Thin client for the local API (same origin; Vite proxies /api to 127.0.0.1 in development).

async function call<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const httpBackend: Backend = {
  kind: 'http',
  deletedProjects: () => call<{ id: string; title: string; deletedAt: string; product: 'book' | 'poster' }[]>('GET', '/api/projects-deleted'),
  trashProject: (id) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
  restoreProject: (id) => call<{ ok: true }>('POST', `/api/projects/${id}/restore`),
  purgeProject: (id) => call<{ removedPhotos: number }>('DELETE', `/api/projects/${id}?forever=1`),
  places: () => call<{ id: string; name: string }[]>('GET', '/api/places'),
  placeOutline: (id) => call<{ name: string; d: string; aspect: number }>('GET', `/api/places/${encodeURIComponent(id)}/outline`),
  suggestPlaces: (points) => call<{ id: string; name: string; photos: number }[]>('POST', '/api/places/suggest', { points }),
  exportImage: (projectId, doc, format, dpi) =>
    call<ImageExportResponse>('POST', `/api/projects/${projectId}/export-image`, { doc, format, dpi }),
  exportFlipbook: (projectId, doc, size) =>
    call<FlipbookResponse>('POST', `/api/projects/${projectId}/export-flipbook`, { doc, size }),
  textOutline: (body) => call<{ d: string; aspect: number }>('POST', '/api/text-outline', body),
  listProjects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (body) => call<{ doc: BookDocument; revision: number }>('POST', '/api/projects', body),
  getProject: (id) => call<{ doc: BookDocument; revision: number; updatedAt: string }>('GET', `/api/projects/${id}`),
  saveProject: (doc, baseRevision, keepalive = false) =>
    call<{ revision: number }>('PUT', `/api/projects/${doc.id}`, { doc, baseRevision }, { keepalive }),
  revisions: (id) => call<{ revision: number; savedAt: string; bytes: number }[]>('GET', `/api/projects/${id}/revisions`),
  revision: (id, rev) => call<{ doc: BookDocument }>('GET', `/api/projects/${id}/revisions/${rev}`),
  assets: (id) => call<PhotoAsset[]>('GET', `/api/projects/${id}/assets`),
  patchAsset: (projectId, assetId, patch) => call<PhotoAsset>('PATCH', `/api/projects/${projectId}/assets/${assetId}`, patch),
  startImport: (projectId, folder) => call<ImportJob>('POST', `/api/projects/${projectId}/import`, { folder }),
  job: (id) => call<ImportJob>('GET', `/api/jobs/${id}`),
  listFolder: (path) => call<FolderListing>('GET', `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  links: (projectId) => call<LinkedFolder[]>('GET', `/api/projects/${projectId}/links`),
  linkFolder: (projectId, folder) => call<ImportJob>('POST', `/api/projects/${projectId}/links`, { folder }),
  unlinkFolder: (projectId, folder) => call<LinkedFolder[]>('DELETE', `/api/projects/${projectId}/links?folder=${encodeURIComponent(folder)}`),
  syncLinks: (projectId, inUse) => call<{ job: ImportJob | null }>('POST', `/api/projects/${projectId}/links/sync`, { inUse }),
  shelf: (path) => call<ShelfListing>('GET', `/api/shelf${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  setShelfRoot: (root) => call<ShelfListing>('PUT', '/api/shelf', { root }),
  createShelf: () => call<ShelfListing>('POST', '/api/shelf/create'),
  relink: (projectId, folder) => call<{ relinked: number; stillMissing: number }>('POST', `/api/projects/${projectId}/relink`, { folder }),
  exportPdf: (projectId, doc, bleedMode) => call<ExportResponse>('POST', `/api/projects/${projectId}/export`, { doc, bleedMode }),
  // v=2: thumbnails of cutouts became WebP with transparency; the version skips older cached JPEGs.
  thumbUrl: (assetId, size = 's') => `/api/assets/${assetId}/thumb?size=${size}&v=2`,
  shelfPreviewUrl: (path) => `/api/shelf/preview?path=${encodeURIComponent(path)}`,
  downloadUrl: (url) => `${url}?download=1`,
};
