import type { BookDocument, PhotoAsset, PreflightIssue } from '../core';

// Thin client for the local API (same origin; Vite proxies /api to 127.0.0.1 in development).

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

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

export interface ProjectSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
  photoCount: number;
  pageCount: number;
  product: 'book' | 'poster';
  trimWidthMm: number;
  trimHeightMm: number;
}

export interface ImportJob {
  id: string;
  status: 'scanning' | 'running' | 'done' | 'failed';
  folder: string;
  total: number;
  processed: number;
  imported: number;
  alreadyInLibrary: number;
  exactDuplicates: number;
  failed: number;
  errors: { file: string; error: string }[];
}

export interface FolderListing {
  path: string;
  parent: string | null;
  folders: string[];
  photos: number;
}

export interface FileVerification {
  ok: boolean;
  pageCount: number;
  expectedPageCount: number;
  pageSizeMm: { width: number; height: number };
  trimSizeMm: { width: number; height: number };
  problems: string[];
}

export interface ExportResponse {
  file: string;
  url: string;
  bleedMode: 'all' | 'outer';
  cover: null | { file: string; url: string; bytes: number; spineMm: number; verification: FileVerification; textOverflow: PreflightIssue[] };
  bytes: number;
  durationMs: number;
  issues: PreflightIssue[];
  textOverflow: PreflightIssue[];
  verification: {
    ok: boolean;
    pageCount: number;
    expectedPageCount: number;
    pageSizeMm: { width: number; height: number };
    trimSizeMm: { width: number; height: number };
    problems: string[];
  };
}

export interface ImageExportResponse {
  file: string;
  url: string;
  bytes: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  format: 'png' | 'jpeg';
}

export const api = {
  deletedProjects: () => call<{ id: string; title: string; deletedAt: string; product: 'book' | 'poster' }[]>('GET', '/api/projects-deleted'),
  trashProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
  restoreProject: (id: string) => call<{ ok: true }>('POST', `/api/projects/${id}/restore`),
  purgeProject: (id: string) => call<{ removedPhotos: number }>('DELETE', `/api/projects/${id}?forever=1`),
  places: () => call<{ id: string; name: string }[]>('GET', '/api/places'),
  placeOutline: (id: string) => call<{ name: string; d: string; aspect: number }>('GET', `/api/places/${encodeURIComponent(id)}/outline`),
  suggestPlaces: (points: [number, number][]) => call<{ id: string; name: string; photos: number }[]>('POST', '/api/places/suggest', { points }),
  exportImage: (projectId: string, doc: BookDocument, format: 'png' | 'jpeg', dpi: number) =>
    call<ImageExportResponse>('POST', `/api/projects/${projectId}/export-image`, { doc, format, dpi }),
  textOutline: (body: { text: string; fontFamily: string; fontWeight: number; italic?: boolean; uppercase?: boolean; letterSpacingEm?: number }) =>
    call<{ d: string; aspect: number }>('POST', '/api/text-outline', body),
  listProjects: () => call<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (body: { title: string; sizeId: string; stylePresetId?: string; pages?: number; printerId?: string; bindingId?: string; product?: 'book' | 'poster'; landscape?: boolean }) =>
    call<{ doc: BookDocument; revision: number }>('POST', '/api/projects', body),
  getProject: (id: string) => call<{ doc: BookDocument; revision: number; updatedAt: string }>('GET', `/api/projects/${id}`),
  saveProject: (doc: BookDocument, baseRevision: number, keepalive = false) =>
    call<{ revision: number }>('PUT', `/api/projects/${doc.id}`, { doc, baseRevision }, { keepalive }),
  revisions: (id: string) => call<{ revision: number; savedAt: string; bytes: number }[]>('GET', `/api/projects/${id}/revisions`),
  revision: (id: string, rev: number) => call<{ doc: BookDocument }>('GET', `/api/projects/${id}/revisions/${rev}`),
  assets: (id: string) => call<PhotoAsset[]>('GET', `/api/projects/${id}/assets`),
  patchAsset: (projectId: string, assetId: string, patch: { rating?: number; favorite?: boolean; excluded?: boolean }) =>
    call<PhotoAsset>('PATCH', `/api/projects/${projectId}/assets/${assetId}`, patch),
  startImport: (projectId: string, folder: string) => call<ImportJob>('POST', `/api/projects/${projectId}/import`, { folder }),
  job: (id: string) => call<ImportJob>('GET', `/api/jobs/${id}`),
  listFolder: (path?: string) => call<FolderListing>('GET', `/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  relink: (projectId: string, folder: string) => call<{ relinked: number; stillMissing: number }>('POST', `/api/projects/${projectId}/relink`, { folder }),
  exportPdf: (projectId: string, doc: BookDocument, bleedMode?: 'all' | 'outer') =>
    call<ExportResponse>('POST', `/api/projects/${projectId}/export`, { doc, bleedMode }),
};

// v=2: thumbnails of cutouts became WebP with transparency; the version skips older cached JPEGs.
export const thumbUrl = (assetId: string, size: 's' | 'm' = 's') => `/api/assets/${assetId}/thumb?size=${size}&v=2`;
