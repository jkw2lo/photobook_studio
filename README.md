# Photobook Studio

A local-first photobook editor: import a folder of photos, get an automatic first draft of the whole book, refine it spread by spread, and export a print-ready PDF. Photos, thumbnails and projects never leave your computer.

## Use it in your browser

**https://jkw2lo.github.io/photobook_studio/** — nothing to install. The web version runs entirely in your browser: photos, thumbnails and books are stored in the browser on your device, and nothing is uploaded (there is no server behind it, only static files).

- **Chrome or Edge** (recommended): import a folder and the photos stay in it; link folders and use the Shelf to keep them in sync. After a browser restart, the app asks for permission to read your folders again.
- **Safari and Firefox:** imported photos are copied into the browser's storage. Linked folders and the Shelf need Chrome or Edge. Safari opens HEIC photos; other browsers need them converted to JPEG first.
- **Back up your books.** Browsers can clear site data (low disk space, "clear browsing data"). The download button on each book saves one `.photobook` file with its pages and photos; **Restore from backup…** on the home page brings it back, in any browser.
- Print PDFs (interior + cover, verified), poster images and the web flipbook are all made in the browser.
- **Demo:** visitors arriving from the portfolio (`?from=portfolio`, with nothing saved yet) can open a sample trip with a short walk-through, or start fresh. The sample photos are made-up illustrations (`npm run demo-photos` regenerates them).

The home page lists what differs from the local app, and [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md#web-version) has the details. To build it yourself: `npm run build:pages` (output in `dist/pages`); `npm run preview:pages` serves it at http://localhost:5190/photobook_studio/. Pushes to `main` deploy it with GitHub Actions (`.github/workflows/pages.yml`). How it works: [docs/WEB_VERSION.md](docs/WEB_VERSION.md).

## Run it locally

**The easy way:** open **Photobook Studio** from your Applications folder (`~/Applications`), Launchpad or Spotlight.

- It starts the app, clears out any leftover Photobook server, rebuilds the editor if the code changed, and opens the editor in your browser.
- Click its Dock icon to reopen the editor; **quit it** (⌘Q or Dock → Quit) to stop the server.
- If something goes wrong it says what, and the details are in `data/launcher.log`.

Build or update the app with `npm run launcher` (it points at this folder, so run it again if you move the project). Use either the app or `npm run dev`, not both at once: they share the same port.

### From the terminal

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
3. **Auto draft** (the Draft tab in the side panel, beside the pages) → choose the page count and style, then **Regenerate** or **Another variation** while you look at the result; you stay on the spread you're viewing, and every regenerate is one undo step. Variations explore layouts widely, so each one changes most spreads even with few photos. The generator picks the best frame of each burst, skips duplicates and hidden photos, always keeps favourites (★), sequences chronologically with day chapters, puts true panoramas across spreads (keeping the subject out of the fold), and gives low-resolution photos small frames.
4. **Edit:**
   - drag, resize (Shift keeps the ratio) and rotate (Shift snaps to 15°) photos, with snapping to margins, centre lines and other photos (hold Alt to turn snapping off);
   - double-click a photo to crop it: drag to reposition, scroll or pinch to zoom around the pointer, drag the photo's corner handles to resize it, arrow keys to nudge, Enter (or double-click) when done. A floating toolbar has the zoom slider, Fill/Fit, Reset and the live print DPI; a rule-of-thirds grid helps framing. Double-click text to edit it;
   - drag a library photo onto a frame to replace it, or onto empty space to add it; "Swap with…" swaps photos between frames, even across spreads;
   - lay out a page or spread from a template, shuffle a spread's layout, lock spreads, add, duplicate, delete or reorder spreads (drag in the filmstrip), and assign chapters;
   - undo/redo with ⌘Z / ⇧⌘Z, nudge with the arrow keys, ⌘D duplicates, L locks.
5. **Cover** (first item in the filmstrip): back · spine · front, sized from the printer preset and page count. Three layouts (photo + title band, framed photo, wraparound photo); spine text appears only when the book is thick enough. The spine follows page-count changes automatically and the front cover stays aligned. Enter exact numbers from your printer's calculator in the Cover panel when the preset only has an estimate (Blurb).
6. **Preflight** tab: low DPI, photos stopping inside the bleed, text near the trim or binding, inside covers, missing originals. Click an issue to jump to it.
7. **Export PDFs:** an interior PDF (one page per book page, trim + bleed, bleed at the spine or not per printer) and a one-page cover PDF (back + spine + front + wrap), both with TrimBox/BleedBox, both re-opened and verified automatically.

The **Preview** pane at the bottom of the library shows the photo you click (or select on a page) larger, with its date, size, favourite/hide buttons and a link to where it's used.

Autosave runs about 0.6 s after every edit. Version history in the **Book** tab restores any of the last 50 saves.

## Book templates and page designs

**Book templates** (Draft tab): Travel journal, Wedding album, First year, Family yearbook, Year in review, Field notes and Portfolio. Each one sets the whole book's layout style, type pack, paper and ink colours, cover and colour grade, and drafts the book from your photos. It also adds:

- a front spread after the title page (contents plus an introduction or dedication);
- a chapter opener page at the start of every chapter (day);
- a closing spread (notes or a quote, then "The end" or a colophon).

Locked spreads are kept. Regenerating the draft keeps the template's pages and whatever you typed on them. Plain drafts can also start each chapter on its own page: tick **Chapter pages** in Auto draft.

**Page designs** (spread panel) add ready-made pages, on a new spread after the current one or on its left or right page:

- **Front:** Contents, Title page, Dedication, Introduction.
- **Text:** Text section, Two columns, Story + photo (with an empty frame), Quote, Caption band (goes on top of a photo page).
- **Chapters:** Chapter opener, Opener with icon, Itinerary (chapters with their dates).
- **Back:** Notes (ruled lines), The end, Colophon.

Pages use the book's text styles, so changing the type pack restyles them too. The **Contents** page fills itself in from the chapters and keeps its page numbers right as spreads are added, moved or removed. Regenerating replaces unlocked pages, so lock a spread to keep a page design you placed by hand.

## Posters and collages

Choose **Poster / collage** in New book: 11 × 14 up to 24 × 36 in, A3–A1 and 50 × 70 cm, portrait or landscape. **Auto collage** curates the photos the same way as book drafts do (best frame of each burst, no duplicates, favourites kept, spread across the whole collection), then lays them out in one of four styles:

| Style | What it does |
| --- | --- |
| Mosaic | Rows that fill the sheet edge to edge, each photo kept close to its own shape — works for any number of photos |
| Grid | Identical cells in even rows and columns |
| Hero + mosaic | One standout photo — chosen to be sharp enough at that size — with the rest as a mosaic |
| Pinboard | Tilted, overlapping prints with white borders |

Auto collage lives in the Poster side panel, next to the sheet, so every change is visible as you make it. First choose the **photos to use**: **Best** (the strongest photos, as many as the slider says; the collage updates live while you drag), **All** (every usable photo) or **On sheet** (only what is already on the poster, after you delete or add some). Then **Arrange** gives the best layout of those photos in time order, and **Shuffle** gives a new variation (for Best, a different strong selection too). Each is one undo step. The **Arrange** setting orders photos by **Time**, **Similar look** (similar colours and composition side by side) or **Colour** (a rainbow). Hero shuffles step through every photo that is sharp enough to feature, without repeats, instead of circling a few favourites.

**Cutouts and background images.** PNG and WebP photos with transparency (cutouts, stickers, logos) are detected at import and marked **Cutout** in the library, shown on a checkerboard. Photos imported earlier are checked the next time the library loads. The see-through areas stay see-through everywhere: in the editor, in thumbnails, and in the PDF, where they are embedded as PNG with transparency rather than flattened onto white. Layouts show cutouts whole (Fit, never cropped) with no border, and Pinboard overlaps them like stickers. Same-shaped cutouts in different colours are no longer mistaken for near-duplicate shots. In the Poster panel's Sheet section, **Background image** puts a photo behind everything, out to the bleed. Drop a library photo on it, or use the photo in the library preview, or right-click a photo on the sheet and choose **Use as sheet background**. Choose **Fill** or **Fit** and fade it with **Opacity**. Arrange and Shuffle never move it or repeat it in the collage, and preflight warns if it is too small for the sheet.

**Templates.** The Poster panel's **Templates** offer finished designs: Greetings from, Gallery, Magazine cover, Pinboard party, Night circles, Year in review, Minimal hero and Film strip. The previews use your poster's title. Each sets the background, type, banners and icons, a photo area (and sometimes photo shapes and a colour grade), then Auto collage fills the area. Everything stays editable, and Arrange and Shuffle keep the photos inside the area and leave the text and decorations alone.

**Design elements.** **Design elements** (Poster panel, and the spread panel in books) adds shapes (rounded, circle, arch, heart, star, hexagon, blob, scallop, speech bubble, frame…), banners (ribbon, flag, tag, pill, ticket, arrow, seal, starburst; banners come with a text box), lines (line, double, dotted, wavy, corners) and icons (heart, sparkle, sun, moon, cloud, flower, leaf, pin, plane, camera, music, mountains, wave, home, coffee, gift, tick, arrow, palm). Default colours contrast with the sheet. In the shape panel you can switch the shape, use a solid or gradient fill, add an outline, and set opacity. Shapes are vectors, so they print sharp at any size.

**Photo cut-outs.** In the photo panel, **Cut-out → Shape** cuts a photo to a circle, arch, heart, star, hexagon, blob, scallop, seal…, and **Cut-out → Text** fills a word with the photo (any bundled font and weight). In collages, **Photo shape** (under Layout) cuts every photo at once. A hand-picked cut-out on a poster is kept when you Arrange.

**Text effects.** Gradient letters (two colours, any direction), **Curve** (arch or smile, one line), an outline, a hard drop shadow, and rounded corners on the text background. All of them print exactly as shown.

**Colour grade.** Under **Colour grade**: Original, Warm, Cool, Vivid, Bright, Matte, Film, Vintage, Black & white and Sepia, plus Brightness, Contrast, Saturation, Warmth and Fade sliders. The grade applies to every photo and the background image (not to text or shapes), in the editor and in the PDF, using the same colour maths in both.

**Pin** a photo (right-click it, press **P**, or use the photo panel) to keep it exactly where it is, at the size and crop you gave it: Arrange and Shuffle fill in around it. **Keep crop** lets the layout move a photo but keeps its crop, zoom, fit, border and cut-out, and keeps it on the sheet. **Keep rotation** does the same for its tilt. Locked photos behave like pinned ones. Text you add to a poster, and wording you type into the title, is kept through every re-flow and regenerate. Spacing, border (edge-to-edge into the bleed, or a margin), title position and background re-flow the photos already on the sheet. Posters warn below 150 DPI (they're seen from further away than book pages). Export is one verified PDF with bleed.

For books, the **Collage** style builds every multi-photo page as a mosaic, and any page can be switched to **Mosaic** from the layout picker.

## Editing tools

- **Several items at once.** Shift-click to add or remove items, drag a box from empty space to select everything it touches, or press ⌘A. Drag any selected item to move them all; arrow keys nudge them; ⌫ and ⌘D delete or duplicate them all. The **Selection** panel and the right-click menu offer Group, Ungroup, To front and To back.
- **Groups.** **Group** (⌘G) makes items select, move and align as one. Banners from the palette and templates come grouped with their text. **Ungroup** is ⇧⌘G. Clicking a grouped item again selects just that item, to edit it.
- **Align and distribute.** Line items up by left, centre, right, top, middle or bottom edge, either to each other or to the page (a single item aligns to its page). With three or more items, space them evenly across or down.
- **Layers.** At the foot of the side panel: everything on the page, top first. Click to select (Shift adds), move items up or down a layer, and lock or unlock them.
- **Per-photo adjustments.** In the photo panel, **Adjust** has Auto-enhance (fixes exposure, adds a little contrast and colour, neutralises a colour cast), Black & white, and brightness, contrast, saturation, warmth and fade sliders. These apply before the poster's colour grade, the same way in the editor and the PDF. On posters they follow the photo through Arrange, and through swaps everywhere.
- **Back cover and spine.** In the cover panel, **Add back-cover text** puts a blurb on the back, on a paper panel over a wraparound photo. **Spine** adds or updates a title reading top to bottom, sized to the spine. It is only offered when the printer allows spine text for this page count.
- **Image export for posters.** The export dialog adds **Image**: JPEG or PNG at screen size (about 2400 px), 150 DPI or 300 DPI. The image is cropped to the trim and rendered from the verified print PDF by macOS.
- **Out-of-date server.** When the app was updated but the server is still running old code, the banner now offers **Restart server now** (for servers started by the launcher or `npm start`). The server rebuilds if needed, restarts itself and the page reloads.

## Opacity and deleting projects

- **Opacity for everything.** Photos (Photo tab), text (Effects tab, covering the whole box: letters, background, outline and shadow), shapes, maps and calendars all have an Opacity slider. Select several items to fade them all at once. It prints the same way in the PDF.
- **Deleting a book or poster.** Hover a card on the home page and click its bin icon. It moves to **Recently deleted**, and the Undo bar can bring it straight back. From Recently deleted you can **Restore** it, or **Delete for good**, which removes its pages and history and drops photos no other book uses from the library. Anything still there after 30 days is removed automatically. Your original photo files are never touched.

## Sharing a web flipbook

In the export dialog, **Web flipbook** turns a book into one web page you can send to people:

- It opens in any browser, offline, with nothing to install. The front cover starts closed, spreads turn like the Preview, and the back cover comes last. Use the arrow keys, swipe, click a page or drag the slider. On a phone held upright it shows one page at a time.
- Every page and both cover boards are cut from the same verified print PDF (rendered by macOS, like poster images), so the flipbook looks exactly like the printed book, trimmed and without bleed.
- **Standard** makes pages 1400 px on the long edge; **Sharp** makes them 2200 px. Expect roughly 0.3 MB (Standard) or 0.5 MB (Sharp) per page with real photos.
- Send the file by AirDrop, email or a shared drive, or put it on any static web host for a link. Nothing is uploaded from the app.

## The Shelf and linked folders

The **Shelf** is one folder shared with your other tools, offered in every book's library. By default it is `~/Pictures/Studio Shelf`. Point Background Studio's **Save results to** and **Sorted copies go to** at it, and cutouts and sorted pictures land somewhere every book can reach. Folders by trip or by kind work well (`Receipts/`, `Stamps/`, `Okinawa/Tickets/`).

- **Shelf** (top of the library) lists the shelf's folders, each with its newest photos, how many it holds, and its subfolders. Click a folder with subfolders to open it. **Create it** makes the shelf folder if it isn't there yet. The folder button chooses a different shelf.
- **Link** adds a folder's photos to this book and keeps the folder in sync. Each time you open the book, come back to the window from another app, or click the refresh button, new photos in linked folders join the library. Renamed or moved photos are followed, so they keep their place on the pages. Photos deleted from the folder leave the library, unless they're on a page (then they stay and show as **Missing**).
- If a linked folder can't be found (renamed, deleted, or on a drive that isn't plugged in), nothing is removed. Its chip shows a dashed outline until it's back.
- **From** chips under the library filters show just one linked folder's photos.
- The ✕ beside **Linked** stops syncing. The photos stay in the library.
- Any folder can be linked, not just ones on the shelf: tick **Keep linked** when you import. Folders linked from elsewhere are listed under the shelf as **Also linked**.

Photobook Studio only reads the shelf. Apart from **Create it**, it never writes, moves or deletes anything there.

## The side panel

- **Edit tab** (named after what is selected: Poster, Spread, Cover, Photo, Text, Shape, Calendar or Selection) changes things already on the page. Each kind of item has small sub-tabs:
  - **Photo:** Photo (pin, fit, crop, swap), Adjust, Cut-out (shape, text or map, plus border), Position.
  - **Text:** Text (words, quick styles, font and size), Effects (background, gradient, curve, outline, shadow), Position.
  - **Shapes and calendars:** their settings, and Position.
  - **Poster:** Collage (Auto collage and layout), Templates, and Sheet (size, background, background image, colour grade).
- **Add tab** puts new things on the page you're on: Text (your text styles and quick styles), Shapes (shapes, banners, lines, icons), Calendar, Map, and, in books, Pages (contents, quotes, openers…). Text lands near the bottom of the page; everything else lands in the middle. The new item is selected so you can style it straight away.
- **Map outlines as a background:** in Add → Map, choose **Background** to place a large, faint outline behind the photos. It stays behind them when you Arrange. **Sticker** puts a smaller outline on top. Any shape can be moved behind or in front of the photos with **Behind the photos** in its panel.

## Preview, clean-up, calendars and maps

- **Preview** (top bar) opens a full-screen flip-through. The front cover is closed, each spread turns with a real page-turn animation, and the back cover comes last. There are no guides, handles or bleed. Use the arrow keys, click a page, or drag the slider. Esc closes it. Posters show the trimmed sheet.
- **Clean up** (library) shows near-identical shots side by side, with the sharpest, best-exposed one starred as the keeper (favourites always win). It also lists blurry or badly exposed photos, and exact duplicates. Click a photo to keep or hide it, then apply. Hidden photos are left out of drafts, but stay in the library (Hidden filter) and on any page they're on.
- **Spacing guides.** While dragging, items snap to the same gap as their neighbours, or exactly midway between two of them. Pink markers show the matching gaps in mm. While resizing, items snap to another item's width or height. Hold Alt to drag freely.
- **Calendars.** Under Design elements → Calendar, **Trip weeks** shows only the weeks a trip covers (a week and a half, not the whole month); **Whole month** shows the full month. The days you took photos are marked. In the calendar panel you can change the dates, toggle marked days, set the title, weekdays and week start, and pick the font, colours and mark style: circle, ring, square, heart, star, highlighter, dot, underline, or crossed off. Page designs add **Trip calendar** and **Year at a glance** (twelve small months). The **12 months** poster template puts each month's best photo, pinned, above that month's calendar.
- **Map outlines.** Under Design elements → Map, pick a country or territory (Hong Kong, Macao, Singapore, Portugal…), suggested from your photos' GPS. You get its outline as a sticker, either outlined or filled, to lay over photos from there. In the photo panel, **Cut-out → Map** fills that outline with a photo. Outlines come from bundled Natural Earth data (public domain, via the `world-atlas` package), so nothing is fetched online. Far-off islands are left out so the main area fills the frame. Cities aren't included.

## Printer presets

| | Lulu | Blurb (PDF to Book) | Custom |
| --- | --- | --- | --- |
| Interior bleed | 0.125 in, all four sides | 0.125 in, none at the spine | editable |
| Hardcover spine | Lulu's published casewrap page-count table | **estimate** — enter Blurb's value | estimate |
| Softcover spine | Lulu's formula: pages / 444 + 0.06 in | **estimate** | estimate |
| Cover wrap | 0.75 in casewrap, 0.125 in paperback | estimate | estimate |
| Page range | casewrap 24–800 | 24–480 | — |

Sources are cited in [src/core/printers.ts](src/core/printers.ts). The printer's own generated cover template is always authoritative; preflight warns whenever a value is an estimate.

## Type packs

Instead of picking fonts one at a time, choose a **type pack** in the Book tab: Classic, Modern minimal, Editorial, Bold magazine, Gallery, Documentary, Romantic, Retro, Journal or Scrapbook. Each pack styles seven text roles — **Title, Subtitle, Heading, Body, Caption, Quote, Label** — with font, weight, size, letter spacing, all-caps and tone (normal or muted).

- Text follows its role's style, so switching packs restyles the whole book (pages, cover and posters) in one step. Sizes keep their proportion, so a big poster title stays big.
- **Customize text styles…** edits a role for the whole book.
- In the text panel, **Style** changes a box's role. Editing a box's font or size by hand makes it a custom look; **Reset** returns it to its role, and **Use for all …** makes it the role's new style.
- **Add text** offers every role, each previewed in its own style, plus **quick styles**: Big headline, Elegant, Magazine, Modern bold, Script, Marker, Tracked caps, Handwritten, Typewriter, Soft caption, Label band and Frosted box. The same quick styles restyle a selected box in one click.
- The text panel updates the page as you type a size, letter spacing or line height. **B**, **I** and **AA** toggle bold, italic and capitals, with every bundled weight from Light to Black. **A− / A+** and the size slider step through sizes, and the box grows to fit bigger text. **Background** adds a fill behind the text, with opacity and padding; it prints the same way in the PDF.

## Fonts

20 bundled families: **sans** Inter, Montserrat, Josefin Sans, Raleway, Work Sans; **serif** Source Serif 4, Lora, EB Garamond, Cormorant Garamond, Libre Baskerville; **display** Playfair Display, Bodoni Moda, DM Serif Display, Abril Fatface, Fraunces; **handwriting** Caveat, Dancing Script, Amatic SC, Permanent Marker; **typewriter** Courier Prime. Most families come in weights from Light to Black, and 15 of them have italics. The editor and the PDF use the same font files, and every weight and italic is tested to embed. To add one: install `@fontsource/<name>`, add it to `src/core/fonts.ts`, run `npx tsx scripts/gen-fonts-css.ts`, then `npm test`.

## Smooth editing

Measured with `tests/e2e/perf.spec.ts`: a 500-photo library and a 60-page book, CPU slowed 4× to stand in for a slower laptop. Before this work, each drag step cost **15.3 ms** of main-thread work — nearly the whole 16.7 ms frame. Now it's **2.6–3.6 ms** (varies run to run). What changed: pointer moves are coalesced to one update per animation frame; filmstrip thumbnails and library tiles are memoized and only re-render when their own content changes; preflight runs on committed edits at low priority, not mid-drag; the editor shell subscribes to narrow slices of state.

Also new: hover outlines, a swap handle on every photo (drag it onto another photo to swap), a right-click menu on any element (pin, keep crop, crop, swap, order, duplicate, lock, delete), pinch / ⌘-scroll zoom, previous/next arrows beside the page, an add-spread button in the filmstrip, neighbouring spreads preloaded, one undo step per colour pick and per crop-zoom scroll.

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
| `tests/collage.test.ts` | Mosaic fills its box exactly with minimal cropping, grid cells identical, hero dominant and sharp enough, pinboard tilted and in bounds; every poster style curates correctly and passes preflight; edge-to-edge posters reach the bleed; style changes keep the same photos; Collage book style |
| `tests/fonts.test.ts` | Every bundled font weight and italic embeds in a PDF; editor stylesheet matches the exporter; every type pack uses bundled fonts |
| `tests/arrange.test.ts` | Pinned photos stay exactly put through Arrange, Shuffle and re-flow in every style, with nothing overlapping them; Keep crop survives shuffles; All / On sheet photo sources; hero shuffles cycle through many sharp photos |
| `tests/cutouts.test.ts` | Transparency detected (not just an alpha channel), WebP previews keep it, older imports re-detected; cutouts laid out whole with no border in every style; colour-aware near-duplicates; background image covers the bleed, survives Arrange/Shuffle and isn't repeated; PDF keeps the cutout's transparency over a faded background |
| `tests/shelf.test.ts` | Shelf listing and creation, previews only served from inside the shelf; linking imports a folder; syncs add new photos, follow renamed ones (same photo, same id), drop deleted unused ones and keep ones on a page; a missing linked folder removes nothing; unlinking keeps the photos |
| `tests/projects.test.ts` | Recently deleted → restore → delete for good, with unused photos (and only those) removed and originals untouched; element opacity; every calendar mark style in its cell and in the PDF |
| `tests/extras.test.ts` | Trip calendars show only their weeks (across months too), months only their days, photo days marked; calendar page designs and the 12-month poster; equal-gap, midway and size snapping; clean-up keepers, blurry and duplicate photos; map outlines (main area only, undistorted), GPS place suggestions, and calendars and map stickers in the PDF |
| `tests/editing.test.ts` | Grouping, aligning (to each other, to the page, groups as one unit), distributing, moving, duplicating and reordering several items; box selection; banners grouped with text; per-photo adjustments chained with the grade, auto-enhance, adjustments following photos through Arrange and swaps; back-cover blurb and spine text; restart endpoint guards; poster JPEG/PNG export size, format and DPI |
| `tests/book-templates.test.ts` | Every page design lands inside the page on either side, replaces only its page and follows the book's styles; contents list chapters with correct page numbers through inserts and removals; every book template makes a complete printable book with front matter, themed openers, closing pages, contents, cover and colours; undated photos get no opener; locked spreads kept |
| `tests/design.test.ts` | Keep rotation; shape library paths stay in their box and scale; banners come with text; shape and text cut-outs (server text outlines); arched text geometry; grade presets; every template places text, decorations and photos inside its area and survives Arrange; PDF draws gradients, cut-outs, curved and outlined text, and graded photos |
| `tests/text-style.test.ts` | Quick styles use bundled fonts, scale with the sheet and grow the box; reset clears italics; PDFs embed italic fonts and semi-transparent text backgrounds |
| `tests/typography.test.ts` | Packs restyle linked text (cover included), keep custom text, carry caps/tracking, keep scaled sizes in proportion; role edits, reset, "use for all"; muted colours follow the book; v2 → v3 migration moves nothing |
| `tests/scale.test.ts` | 500-photo import with API latency sampled throughout; 60-page draft from 500 photos (needs `npm run fixtures -- 500`) |
| `tests/e2e/milestone.spec.ts` | The milestone in the real UI, in your installed Chrome — including verified interior + cover PDFs — and a full poster flow (create, import, auto collage, switch to pinboard, export) |
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
