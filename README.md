# Photobook Studio

A local-first photobook editor: import a folder of photos, get an automatic first draft of the whole book, refine it spread by spread, and export a print-ready PDF. Photos, thumbnails and projects never leave your computer.

## Run it

Requires macOS (HEIC import uses the built-in `sips`) and Node 22.13+ (uses built-in `node:sqlite`).

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173. The API runs on 127.0.0.1:5174, and data lives in `./data` (override with `PHOTOBOOK_DATA_DIR`; move ports with `PHOTOBOOK_WEB_PORT` / `PHOTOBOOK_PORT`).

For a single-process build: `npm run build && npm start`, then open http://127.0.0.1:5174.

### Try it without your own photos

```bash
npm run fixtures
```

This writes 21 synthetic trip photos to `fixtures/generated/trip`: mixed orientations, a panorama, a burst, an exact duplicate, a blurry frame, a low-res image, a HEIC file, an EXIF-rotated file and an undated PNG. Import that folder in the app.

## Using it

1. **New book** → choose a printer (Lulu, Blurb, or custom), binding, size and style.
2. **Import** a folder. Originals are referenced in place, never copied or modified. Thumbnails, quality analysis and near-duplicate fingerprints are computed in the background.
3. **Auto draft** → choose the page count and style. The generator picks the best frame of each burst, skips duplicates and hidden photos, always keeps favourites (★), sequences chronologically with day chapters, puts true panoramas across spreads (keeping the subject out of the fold), and gives low-resolution photos small frames.
4. **Edit:**
   - drag, resize (Shift keeps the ratio) and rotate (Shift snaps to 15°) photos, with snapping to margins, centre lines and other photos (hold Alt to turn snapping off);
   - double-click a photo to crop it (drag to pan, scroll to zoom), or double-click text to edit it;
   - drag a library photo onto a frame to replace it, or onto empty space to add it; "Swap with…" swaps photos between frames, even across spreads;
   - lay out a page or spread from a template, shuffle a spread's layout, lock spreads, add, duplicate, delete or reorder spreads (drag in the filmstrip), and assign chapters;
   - undo/redo with ⌘Z / ⇧⌘Z, nudge with the arrow keys, ⌘D duplicates, L locks.
5. **Cover** (first item in the filmstrip): back · spine · front, sized from the printer preset and page count. Three layouts (photo + title band, framed photo, wraparound photo); spine text appears only when the book is thick enough. The spine follows page-count changes automatically and the front cover stays aligned. Enter exact numbers from your printer's calculator in the Cover panel when the preset only has an estimate (Blurb).
6. **Preflight** tab: low DPI, photos stopping inside the bleed, text near the trim or binding, inside covers, missing originals. Click an issue to jump to it.
7. **Export PDFs:** an interior PDF (one page per book page, trim + bleed, bleed at the spine or not per printer) and a one-page cover PDF (back + spine + front + wrap), both with TrimBox/BleedBox, both re-opened and verified automatically.

Autosave runs about 0.6 s after every edit. Version history in the **Book** tab restores any of the last 50 saves.

## Printer presets

| | Lulu | Blurb (PDF to Book) | Custom |
| --- | --- | --- | --- |
| Interior bleed | 0.125 in, all four sides | 0.125 in, none at the spine | editable |
| Hardcover spine | Lulu's published casewrap page-count table | **estimate** — enter Blurb's value | estimate |
| Softcover spine | Lulu's formula: pages / 444 + 0.06 in | **estimate** | estimate |
| Cover wrap | 0.75 in casewrap, 0.125 in paperback | estimate | estimate |
| Page range | casewrap 24–800 | 24–480 | — |

Sources are cited in [src/core/printers.ts](src/core/printers.ts). The printer's own generated cover template is always authoritative; preflight warns whenever a value is an estimate.

## Fonts

20 bundled families: **sans** Inter, Montserrat, Josefin Sans, Raleway, Work Sans; **serif** Source Serif 4, Lora, EB Garamond, Cormorant Garamond, Libre Baskerville; **display** Playfair Display, Bodoni Moda, DM Serif Display, Abril Fatface, Fraunces; **handwriting** Caveat, Dancing Script, Amatic SC, Permanent Marker; **typewriter** Courier Prime. The editor and the PDF use the same font files, and every weight is tested to embed. To add one: install `@fontsource/<name>`, add it to `src/core/fonts.ts`, run `npx tsx scripts/gen-fonts-css.ts`, then `npm test`.

## Smooth editing

Measured with `tests/e2e/perf.spec.ts`: a 500-photo library and a 60-page book, CPU slowed 4× to stand in for a slower laptop. Before this work, each drag step cost **15.3 ms** of main-thread work — nearly the whole 16.7 ms frame. Now it's **2.6–3.6 ms** (varies run to run). What changed: pointer moves are coalesced to one update per animation frame; filmstrip thumbnails and library tiles are memoized and only re-render when their own content changes; preflight runs on committed edits at low priority, not mid-drag; the editor shell subscribes to narrow slices of state.

Also new: hover outlines, a swap handle (drag it onto another photo to swap), pinch / ⌘-scroll zoom, previous/next arrows beside the page, an add-spread button in the filmstrip, neighbouring spreads preloaded, one undo step per colour pick and per crop-zoom scroll.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

| Suite | What it proves |
| --- | --- |
| `tests/core.test.ts` | Crop geometry, templates stay in bounds, draft page counts for every style and photo count, determinism, favourites kept, duplicates collapsed, locked spreads untouched, generated layouts pass preflight, undo safety, schema round-trip, core has no Node/React imports, no remote URLs anywhere in `src/` |
| `tests/milestone.test.ts` | Real HTTP API + SQLite + image pipeline: import 21 fixtures (HEIC, EXIF rotation, dates, GPS, blur), re-import is idempotent, draft → edits → stale save refused → server restart → identical document → verified PDF (both bleed modes) → move a file → missing detected → relinked |
| `tests/covers.test.ts` | Lulu spine table and paperback formula, Blurb estimate → manual override, casewrap cover dimensions, generated covers, spine text only above 80 pages, all three cover layouts pass preflight, front cover stays aligned when the spine grows, page-limit errors, v1 → v2 migration |
| `tests/scale.test.ts` | 500-photo import with API latency sampled throughout; 60-page draft from 500 photos (needs `npm run fixtures -- 500`) |
| `tests/e2e/milestone.spec.ts` | The milestone in the real UI, in your installed Chrome — including verified interior + cover PDFs |
| `tests/e2e/perf.spec.ts` | Drag smoothness under load (needs the 500-photo fixtures) |

To inspect an export visually (no extra installs):

```bash
swift scripts/render-pdf.swift data/exports/<file>.pdf test-results/render 72 --spreads
```

## Status against the acceptance criteria

| | Criterion | Status |
| --- | --- | --- |
| 1 | Import 500 images without freezing | ✅ 500 synthetic 2 MP images in 9 s; API p95 latency 8 ms during import. Real 12–48 MP photos will be slower (not yet measured). |
| 2 | Close, reopen, recover | ✅ Server restart returns a byte-identical document; 50-revision history |
| 3 | Editable draft honouring page count | ✅ Exact page count across all styles and photo counts tested |
| 4 | Move/resize/crop/rotate/replace persist | ✅ (API test + UI test for move; replace/swap via commands) |
| 5 | Undo/redo exact | ✅ Snapshot history; commands proven non-mutating |
| 6 | Regenerate keeping locked spreads | ✅ Whole-book regeneration and per-spread layout shuffle. Chapter-only and photos-only regeneration not built yet. |
| 7 | PDF dimensions, page count, placement, text | ✅ Verified on every export; placement and text checked visually from rendered pages |
| 8 | Low-res and gutter/trim warnings | ✅ |
| 9 | Missing files + relink | ✅ |
| 10 | Works offline | ⚠️ By design (no outbound code, CSP, URL-scan test). Not yet run with the network actually disabled. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).
