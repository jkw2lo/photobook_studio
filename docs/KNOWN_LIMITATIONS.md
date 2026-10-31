# Known limitations

Honest list of what this version does not do, or does only partly.

## Platform
- **macOS only for HEIC.** HEIC is converted with `/usr/bin/sips`; other platforms would need libheif with HEVC support.
- **The Mac app is a launcher, not a packaged app.** `Photobook Studio.app` starts the local server from this project folder and opens the editor in your browser; it needs Node.js and this folder (rebuild it with `npm run launcher` if the folder moves). A self-contained Tauri app is still possible later; core logic is shell-independent.

## Print
- **Blurb cover numbers are estimates.** Blurb publishes no spine formula or ImageWrap dimensions; the preset starts from an estimate and preflight warns until you enter the values from Blurb's Specification Calculator.
- **Lulu specs are from Lulu's published guides (October 2026).** Lulu's generated cover template remains authoritative; Lulu paperback page limits are not encoded.
- **Covers:** no dust jackets or flaps, no barcode/ISBN area, no paper-type choice (spine assumes standard paper).
- **sRGB only.** No CMYK or ICC conversion. Fine for consumer photobook printers (Blurb, Lulu and similar); not for offset printing.
- **No italics.** Fonts are bundled in upright weights only.
- **Some fonts can't be offered.** A few fonts (e.g. IBM Plex Mono) crash PDFKit's font subsetter, so they are excluded; `tests/fonts.test.ts` checks every bundled weight.
- **Fonts cover Latin scripts only.** The bundled font files are the Latin subsets. Other scripts will show missing glyphs in the PDF.
- **Line breaks can differ.** Browser and PDF wrap text independently with the same font metrics; an occasional line may break differently. Overflow is detected at export.
- **Printer presets** cover Lulu and Blurb photo-book sizes only; other printers use Custom.
- **Rotated full-bleed photos** can leave white corners after trimming, and preflight does not detect this yet.

## Posters
- One sheet per poster; no multi-panel or tiled prints.
- No poster print-shop presets: bleed defaults to 0.125 in and is editable in the Print tab.
- Re-flowing a collage (style, spacing, border, size) replaces manual moves on the sheet; undo restores them.

## Curation
- **Chronological ordering only.** Thematic and mixed editorial sequencing are not implemented (the option isn't shown in the UI).
- **No face or subject detection.** Crops and panorama gutter-avoidance use an edge-energy "saliency" estimate. It works for clear subjects but can be fooled by busy backgrounds.
- **No reverse geocoding.** GPS is stored but captions show dates only; there's no offline place-name database.
- **Similarity grouping is O(n²)** in photo count: fine for a few thousand photos, not tens of thousands.
- **Regeneration scopes:** whole book (respects locks) and per-spread layout shuffle only. Chapter-only and photos-only regeneration are not built.

## Editor
- Single selection only (no multi-select or group alignment).
- Changing page size or margins does not reflow existing pages; regenerate or re-apply layouts.
- Undo history lives in memory and is cleared on reload. Saved versions remain in Version history.
- The library grid isn't virtualized; it stays smooth into the low thousands thanks to `content-visibility`, beyond that untested.

## Verification gaps
- Import speed was measured on synthetic 2 MP images; real 12–48 MP camera files will be slower.
- The "works offline" criterion is met by design (no outbound code, CSP, a source scan for URLs) but has not been run with networking actually switched off.

## Web version

The browser build (GitHub Pages) has everything above, plus these limits:

- **Storage lives in the browser.** Books, thumbnails and copied-in photos are in the browser's site data for this site, on this device, in this browser profile. Another browser or device doesn't see them. Browsers may clear site data under storage pressure or when you clear browsing data; the app asks for persistent storage, but Safari and Firefox may not grant it. Use per-book backups (one `.photobook` file).
- **Folders (Chrome/Edge):** photos are read in place through a folder you choose. After a browser restart, the browser asks for permission again ("Allow access" in the library); until then thumbnails and editing work, but export, linked-folder sync and missing-photo checks wait for permission. Moving or renaming the chosen folder itself breaks the link; relink by choosing it again.
- **Safari and Firefox:** no folder access API, so imported photos are copied into browser storage (more disk use), and linked folders, the Shelf and relink-in-place aren't available. Relink copies the found files in.
- **HEIC** imports only in Safari (which decodes it). Chrome, Edge and Firefox report "convert to JPEG first". The local app converts HEIC with macOS `sips`.
- **Photo analysis** uses the same formulas as the local app on the browser's own decode and resize, so sharpness and near-duplicate fingerprints are close but not bit-identical to the local app's. Curation compares photos within a book (percentiles, Hamming distance), so drafts behave the same; a library imported in both versions will not match hash for hash.
- **Exports run in the browser** and are held in memory until downloaded: very large books need a lot of RAM (each photo is decoded at full size once while its pages are drawn). Export results are links valid until the page is closed. JPEGs inside the PDF are encoded by the browser (chroma subsampling may differ from the local app's 4:4:4).
- **Poster images** are capped at about 16 megapixels (Safari's canvas limit), so large posters at 300 DPI come out at a lower DPI, and the PNG/JPEG has no DPI tag. The flipbook uses JPEG page images where the browser can't encode WebP (Safari).
- **Phones:** the editor stacks (pages, then library, then side panel) below 700 px wide so everything can be reached, but it is built for a desktop: dragging and cropping are fiddly on a small touch screen.
- **Not in the web version:** the Mac launcher, the "server is out of date / restart" banner, typing folder paths, and creating the Shelf folder for you (create it in Finder or Explorer, then choose it).
- **Backups** contain the originals that could be read when the backup was made. Photos in a folder without permission at that moment are included as thumbnails only, and come back as missing.

