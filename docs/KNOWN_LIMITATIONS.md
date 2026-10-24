# Known limitations

Honest list of what this version does not do, or does only partly.

## Platform
- **macOS only for HEIC.** HEIC is converted with `/usr/bin/sips`; other platforms would need libheif with HEVC support.
- **Not a packaged desktop app yet.** It runs as a local server plus a browser tab. Tauri was deferred because Rust is not installed; core logic is shell-independent so this can be added.

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
