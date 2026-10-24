# Photobook Studio — Architecture

## 1. Starting point

The repository was empty: no existing framework or structure to preserve. Environment audit (macOS 26, Apple Silicon):

| Tool | Status | Consequence |
| --- | --- | --- |
| Node 26 / npm 11 | present | Built-in `node:sqlite` (SQLite 3.53) — no native DB module needed |
| Rust / cargo | **absent** | Tauri 2 needs a Rust toolchain; deferred (see §2) |
| `sips` | present | Used to decode HEIC (libvips prebuilds cannot decode HEVC-HEIC) |
| Google Chrome | present | Playwright runs against the system Chrome — no browser download |
| sharp 0.35 / libvips 8.18 | installs cleanly | Thumbnails, EXIF orientation, crops for export |
| PDFKit + fontkit | works with `.woff`; **crashes subsetting `.woff2`** | Export embeds the `.woff` builds of the same fonts the UI uses |

## 2. Architecture

```
┌──────────────────────── src/web (React, Vite) ────────────────────────┐
│  Library sidebar · Spread canvas · Navigator · Inspector · Preflight   │
│  Zustand store: document + bounded snapshot history (undo/redo)        │
└───────────────▲───────────────────────────────────────────────────────┘
                │ imports pure functions          HTTP (127.0.0.1 only)
┌───────────────┴──────── src/core (pure TS) ─────┐   ┌──── src/server (Node) ─────┐
│ model · geometry (crop/placement/DPI) · units   │◄──│ SQLite catalog + projects  │
│ templates · styles · curation · generator       │   │ import jobs (background)   │
│ preflight · commands · schema/migrations        │   │ media: hash, EXIF, thumbs, │
└─────────────────────────────────────────────────┘   │   dHash, sharpness, HEIC   │
                                                      │ export: PDFKit + verify    │
                                                      └────────────────────────────┘
```

**Decision: local Node server + browser UI now, Tauri later.** The brief suggests Tauri 2, but Rust is not installed. A Node process bound to `127.0.0.1` gives the same guarantees that matter (real filesystem paths, persistent SQLite, background processing, nothing leaves the machine) with one language. All domain logic lives in `src/core`, which imports nothing from Node, React, or the server — enforced by a test — so a Tauri shell can later host the same UI and call the same core.

**Why the generator runs in the client:** core is pure, so "Generate draft" is just another document command. That makes it undoable like any edit, and the server never needs to know about layouts.

### Privacy boundary (architectural, not a promise)

- Server listens on `127.0.0.1` only; there is no outbound network code anywhere.
- Fonts are bundled from `@fontsource/*` packages; no CDN, no remote fonts.
- The web page ships a Content-Security-Policy restricting all fetches to `'self'`.
- Originals are never modified. Thumbnails, HEIC conversions, and exports go to the data directory (`./data` by default, `PHOTOBOOK_DATA_DIR` to override).
- A test scans the source tree for external URLs.

## 3. Data schema

### Storage split

| What | Where | Why |
| --- | --- | --- |
| Photo catalog (one row per photo) | SQLite `assets` | Thousands of rows, indexed, updated by background import |
| Project ↔ photo membership, exclusions | SQLite `project_assets` | Import can add photos while the editor autosaves — no write races on the document |
| Book document (spreads, elements, settings) | SQLite `projects.doc` (JSON, versioned) | Small, edited as a unit, saved atomically |
| Recovery history | SQLite `project_revisions` (last 50) | Restore after a bad edit or interrupted session |
| Thumbnails / HEIC conversions / exports | `data/thumbs`, `data/derived`, `data/exports` | Binary files stay out of the DB |

### Coordinate conventions (the most important rules)

- **Units:** millimetres everywhere in the document. Points (pt) only at the PDF boundary; pixels only at the screen boundary.
- **Spread space:** every spread is one canvas `2W × H` (W, H = trim size of one page). Origin = top-left of the *left page's trim box*. Bleed extends to negative coordinates and beyond `2W`/`H`.
- **Elements live on spreads, not pages.** A panorama crossing the spine is one element. Pages are derived at export by clipping each page's bleed box out of the spread.
- **Page numbering:** spread 0's left half is the inside front cover (not printed); its right half is page 1. The last spread's right half is the inside back cover. So `N` spreads → `2N − 2` printable pages (always even).
- **Rotation:** degrees clockwise about the element's centre.
- **Crop:** `{ cx, cy, zoom }`. `cx, cy ∈ [0,1]` are normalized coordinates *in the auto-oriented source image* of the point shown at the frame's centre. `zoom ≥ 1` multiplies the baseline scale (cover: smallest scale that fills the frame; contain: largest scale that fits). One function, `imagePlacement()`, turns this into a rectangle and is used by both the CSS preview and the PDF export.

### Document types (abridged — full definitions in `src/core/model.ts`)

```ts
interface BookDocument {
  schemaVersion: 1;
  id: string; title: string;
  settings: BookSettings;      // trimWidthMm, trimHeightMm, bleedMm, safeMarginMm, bindingZoneMm, pageNumbers
  style: BookStyle;            // presetId, margins, gap, colours, fonts, imageBorder, caption mode
  chapters: Chapter[];         // { id, title } — order derived from spreads
  spreads: Spread[];
  generation?: GenerationRecord;  // settings + seed used for the last draft
}
interface Spread {
  id: string; locked: boolean; chapterId?: string;
  background?: string;
  layout?: { left?: string; right?: string; spread?: string };   // template ids
  provenance?: { generatedAt: string; seed: number; assetIds: string[] };
  elements: Element[];
}
type Element = ImageElement | TextElement;   // discriminated on `type`
interface ElementBase { id; xMm; yMm; widthMm; heightMm; rotationDeg; locked: boolean }
interface ImageElement extends ElementBase { type: 'image'; assetId: string | null; crop: Crop; fit: 'cover' | 'contain'; borderMm?: number; borderColor?: string }
interface TextElement  extends ElementBase { type: 'text'; text; role; fontFamily; fontSizePt; fontWeight; align; color; lineHeight }
```

Z-order = array order. Element ids, asset ids, and spread ids are stable UUIDs.

### Covers, surfaces and printers (schema v2)

- `src/core/printers.ts` — data-only presets (sizes, bleed, bleed at spine, spine rule, cover wrap, page limits), with sources cited. `spineWidth(doc)` returns the width *and* where it came from (`table`, `formula`, `manual`, `estimate`).
- `doc.cover` is a `Spread` plus `spineMm`. Cover coordinates: x = 0 at the back cover's left trim; back | spine | front. `reconcileCover()` runs after every edit and shifts front-cover elements when the spine width changes, so adding pages never misaligns the cover.
- `src/core/surface.ts` — a *surface* is a spread or the cover. Canvas, snapping, guides, preflight and PDF export all read `SurfaceGeometry` (trim size, bleed/wrap, panels, folds, fold zone, safe areas) instead of assuming two pages.
- Elements gained a third type, `shape` (filled rectangle), used for title panels.
- Schema v1 → v2 migration: books become `custom`-printer books without a cover.

### SQLite (`src/server/db.ts`)

```sql
meta(key PRIMARY KEY, value)                              -- schema_version
assets(id PK, original_path, file_name, format, file_size, mtime_ms,
       content_hash, width, height, captured_at, gps_lat, gps_lon,
       rating, favorite, tags JSON, analysis JSON, derived_path,
       exact_duplicate_of, imported_at)
project_assets(project_id, asset_id, excluded, added_at, PK(project_id, asset_id))
projects(id PK, title, doc JSON, schema_version, revision, created_at, updated_at)
project_revisions(project_id, revision, doc JSON, saved_at, PK(project_id, revision))
```

Saves use optimistic concurrency (`baseRevision`); a stale tab cannot silently overwrite a newer save.

## 4. Milestones and acceptance tests

| # | Milestone | Done when (automated unless noted) |
| --- | --- | --- |
| **M1** | **End-to-end spine** (this build) | Import 20 fixture photos (JPEG/PNG/HEIC, duplicates, blurry, low-res) → generate a 10–20 page draft → edit spreads → restart server, reopen, edits intact → export PDF whose page count, MediaBox and TrimBox match the book; pages inspected visually |
| M2 | Editor depth | Move/resize/rotate/crop/replace/swap persist; undo/redo restores exact prior state; snapping; text editing; chapter tools |
| M3 | Print hardening ✅ | Printer presets (Lulu, Blurb, custom); cover with spine and wrap; verified cover PDF |
| M4 | Curation depth | Regenerate spread/chapter/photos-only; thematic ordering; preference learning from manual swaps |
| M5 | Scale | 500-image import without UI stalls (measured); 2,000-image library; virtualized grid |
| M6 | Desktop shell | Tauri wrapper once Rust is installed |

Acceptance criteria from the brief map to tests in `tests/` — see `README.md` for what passes today.

## 5. Major technical risks

1. **Crop geometry drift between preview and PDF.** Mitigation: one placement function in core; EXIF orientation applied once (sharp `.rotate()`) for thumbnails, previews and export alike; a unit test asserts preview and export compute the same visible rectangle; exported pages are rendered and compared visually.
2. **Local photo storage.** Originals are referenced by path, so files can move. Mitigation: content hash + file name stored; missing files detected on every library load; relink scans a folder and matches by name+size, then hash.
3. **HEIC.** libvips prebuilds cannot decode HEVC. Mitigation: convert once with macOS `sips` into `data/derived`. Not portable to Windows/Linux — documented.
4. **Automatic layout quality.** Without face detection, crops can cut subjects. Mitigation: a cheap edge-energy "saliency centre" computed at import biases crops and keeps the subject out of the gutter on spread-spanning photos. Deterministic seeded generator so results are reproducible and testable.
5. **Text fidelity.** Browser and PDFKit wrap lines independently. Mitigation: identical font files and metrics; export measures overflow and reports it. Residual risk: an occasional different line break.
6. **PDF correctness.** File creation proves nothing. Mitigation: every export is re-parsed (pdf-lib) to check page count, MediaBox, TrimBox, BleedBox; tests render pages and check them visually.
7. **Colour.** Export is sRGB JPEG inside PDF; no CMYK/ICC conversion. Fine for Blurb/Lulu-type consumer printers; not for offset printing.
