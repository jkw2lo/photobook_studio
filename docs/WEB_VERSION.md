# Photobook Studio in the browser

The same editor runs two ways:

| | Local app (`npm start`, the Mac launcher) | Web version (GitHub Pages) |
| --- | --- | --- |
| Backend | Node server on 127.0.0.1 (`src/server`) | Runs in the page (`src/web/backend/browser`) |
| Storage | SQLite + `data/` folder | IndexedDB in the browser profile |
| Photos | Referenced by path | Chrome/Edge: referenced through a folder you grant access to. Safari/Firefox: copied into browser storage |
| Build | `npm run build` | `npm run build:pages` (`VITE_BACKEND=browser`, base `/photobook_studio/`) |

Nothing is uploaded in either version: there is no server behind the web version, only static files.

## The backend interface

`src/web/api.ts` exports `api`, which is whichever `Backend` (`src/web/backend/types.ts`) the build
selected. Both implementations have the same methods and return the same shapes:

- `src/web/backend/http.ts` — the original thin `fetch` client for the local server, unchanged in behaviour.
- `src/web/backend/browser/` — the in-browser implementation:
  - `db.ts` — IndexedDB stores mirroring the SQLite tables: `projects`, `revisions` (last 50 per
    project), `assets`, `projectAssets`, `thumbs`, `originals` (copied-in photos), `dirs` (saved
    folder handles), `links`, `settings`. Saves keep optimistic `baseRevision` checks inside one
    transaction, so a stale tab cannot overwrite a newer save.
  - `importer.ts` + `media.worker.ts` — import jobs with the same progress object the UI already
    polls. A small pool of Web Workers hashes (SHA-256), reads EXIF (exifr), decodes with
    `createImageBitmap` (EXIF orientation applied), makes thumbnails and runs the same analysis as
    `src/server/media.ts` (`analysis.ts` holds the pure maths, tested against sharp's output).
  - `exporter.ts` + `export.worker.ts` — print PDFs in a worker with PDFKit's browser build. The
    drawing code is shared with the server (`src/shared/pdfWriter.ts`); only image preparation
    (OffscreenCanvas instead of sharp) and font loading differ. Every file is re-verified with
    pdf-lib (page count, MediaBox, TrimBox, BleedBox) exactly as on the server.
  - `raster.ts` — poster PNG/JPEG and the flipbook, rendered from the verified PDF with pdf.js
    (the server uses macOS `sips` for the same step).
  - `folders.ts` — folder access: `showDirectoryPicker` handles saved in IndexedDB (relink, linked
    folders, the Shelf), or a `<input webkitdirectory>` copy-in where that API does not exist.
  - `backup.ts` — one-file backup/restore of a project (document, photos, thumbnails).

Code that both sides run (PDF drawing and verification, text and place outlines, the flipbook
viewer) lives in `src/shared`, which — like `src/core` — imports nothing from Node.

Thumbnails are served to `<img>` tags as `blob:` URLs created when the library is loaded, so the
components keep calling `thumbUrl()` synchronously.

## What ships in the web build

| Feature | Chrome / Edge | Safari | Firefox |
| --- | --- | --- | --- |
| Books, posters, editing, auto-draft, undo, version history | ✅ | ✅ | ✅ |
| Import a folder | ✅ referenced in place (needs permission again after a restart) | ✅ copied into browser storage | ✅ copied into browser storage |
| HEIC photos | ❌ "convert to JPEG first" | ✅ decoded by Safari | ❌ "convert to JPEG first" |
| Linked folders, the Shelf, relink | ✅ | ❌ (explained in the app) | ❌ (explained in the app) |
| Print PDFs (interior + cover), verified | ✅ | ✅ | ✅ |
| Poster PNG/JPEG, web flipbook | ✅ | ✅ (JPEG pages where WebP can't be encoded) | ✅ |
| Backup / restore a project | ✅ | ✅ | ✅ |

Left out of the web build: the "server is out of date" banner and restart, the `/api/fs` folder
browser (replaced by the browser's own folder picker), creating the Shelf folder for you, and the
Mac launcher.
