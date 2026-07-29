# md2pdf

Markdown in, deeply themeable PDF out — entirely in the browser. No server, no
serverless functions, no headless browser. Static-hosted on GitHub Pages,
installable as a PWA.

The implementation specification is [DESIGN.md](DESIGN.md); this README covers
running it.

## Quick start

```bash
npm install
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Static build into `build/` |
| `npm run preview` | Serve the production build |
| `npm run check` | `svelte-check` in strict mode |
| `npm test` | Unit + golden-file suites (Vitest) |
| `npm run test:e2e` | Playwright, against the production build |
| `python scripts/build_fonts.py` | Rebuild the bundled fonts — one-time, see below |

## How it works

```
Editor ──┐
         ├─► debounce 400 ms ─► resolveFonts() ─► pdf.worker ─► ArrayBuffer ─┬─► pdf.js canvas preview
ThemePanel┘                     (IndexedDB)                                  └─► Download button
```

**The preview and the download are the same bytes.** There is no second render
path, so there is nothing for the two to disagree about.

Generation runs in a Web Worker. If the worker cannot start, the app falls back
to main-thread generation and says so in a banner — the worker is a performance
optimisation, not a correctness requirement.

## Fonts

Twelve families are bundled, subsetted, as **static** instances — four real
faces each, 3.4 MB in total. They are fetched lazily and cached in IndexedDB, so
a second visit fetches zero font bytes.

Building them is a one-time manual step whose outputs are committed; CI has no
Python dependency. The procedure, and why each step exists, is in
[scripts/subset-fonts.md](scripts/subset-fonts.md). Two details worth knowing
before you touch it:

- Upstream ships most of these as variable fonts. pdfkit ignores variation axes,
  so a variable file renders "Bold" as Regular. The build instantiates every axis
  and asserts the `fvar` table is gone.
- Ten of the twelve have no ballot-box glyphs at all, so task-list checkboxes
  would render as blank squares. The build grafts the missing symbols in from
  Source Sans 3, scaled to the host family's units-per-em. Both sides are
  OFL-1.1; every licence is committed beside its family and listed at
  `/licenses`.

Users can also upload their own TTF/OTF (validated by magic bytes, not
extension) or pull from Google Fonts (online first, cached for offline use
afterwards, labelled experimental).

## Themes

Everything visual is a theme field: page geometry, three font slots, per-element
typography and margins, background colour and image, watermark, cover page,
running header and footer, and page-break behaviour. See §5 of DESIGN.md for the
schema.

Themes are portable JSON. A partial or hand-edited file is deep-merged over the
defaults, so it always yields a complete theme; a malformed one degrades to the
defaults with readable warnings rather than throwing into the render path.
Themes carrying binaries — an uploaded font, or an image over 256 KB — export as
a `.mdtheme` ZIP instead.

## Deployment

Live at **https://blackdragonbe.github.io/md2pdf/**.

`.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>` and publishes to
GitHub Pages; Pages must be set to **Source: GitHub Actions** or the deploy step
404s. Every runtime asset URL goes through `base` from `$app/paths`; without
that, fonts and presets 404 on a project site. `static/.nojekyll` is committed
and `appDir` is `internal`, because Jekyll ignores `_app`.

### The service worker on a project site

Two things had to be corrected before the PWA worked under `/<repo>/`, both in
`build-config/precacheTransform.ts`:

- **@vite-pwa/sveltekit derives its precache prefix from Vite's `base`**, which
  SvelteKit leaves at `/` while serving the app from `paths.base`. The app shell
  was precached as the root-absolute `/`, and since `navigateFallback` binds to
  that URL, the worker answered *every* in-scope navigation with whatever lives
  at the domain root. Verified live: the app loaded once and was then replaced by
  the server's directory index. Precache URLs are now scope-relative, so one
  build is correct at `/` and at `/<repo>/`.
- **The webmanifest was contributed twice** with different revisions, which
  workbox rejects — the worker registered and its precache silently never
  populated, so the app looked installed but had nothing cached.

Both are covered by `tests/unit/precacheTransform.test.ts` and two E2E tests.
Offline operation was confirmed by killing the static server and reloading: the
app comes up from the service worker, fonts from IndexedDB, and generates a
37-page PDF with no network at all.

## Using it

- **Preview** opens at a zoom that fits the page to the pane; **Fit** returns to
  it after manual zooming. The preview is a focusable scroll region, so arrow
  keys, Page Up/Down, Home and End work once it has focus.
- **Scroll position survives re-renders**, including zoom changes — editing does
  not throw you back to page one.
- **Paste an image** into the editor to embed it as a data URI. Relative image
  paths cannot be resolved in a static app, so this is the way to include local
  images. Pasted images are capped at 2 MB because the document is persisted to
  localStorage.
- **Tab / Shift+Tab** indent and outdent without leaving the editor, and without
  discarding the browser's undo history.
- **Ctrl/Cmd+S** downloads, **Ctrl/Cmd+Shift+B** toggles the theme panel.
- Below 1100px the theme panel becomes an overlay; below 720px the editor and
  preview stack.

## Verified unknowns

DESIGN.md §16 lists five things it declined to guess at. All five were settled by
running them — worker support, Google Fonts response shapes, `wawoff2` output,
pdfmake's `opacity`/`angle` support, and the large-document ceiling. Results,
with the commands to re-check them, are in
[docs/verification.md](docs/verification.md).

## Deviations from DESIGN.md

Five places where the spec did not survive contact with the implementation. Each
is commented at the site.

1. **The worker receives tokens, not a finished document definition.** §8 posts a
   `TDocumentDefinitions` across the worker boundary, but §12.1 requires
   `background`, `header` and `footer` to be *functions*, which cannot be
   structured-cloned. The token stream, theme and pre-resolved images cross
   instead, and `buildDocDefinition` — synchronous exactly so it can — runs
   worker-side. See `src/lib/workers/protocol.ts`.

2. **pdf.js gets a worker port, not a `workerSrc` URL.** The `?url` form in §9
   works in dev and fails in the production build: the emitted asset is an ES
   module, pdf.js loads `workerSrc` as a classic worker, and the "fake worker"
   fallback then fails to import it. `?worker` plus `PDFWorker({ port })` works
   in both. See `src/lib/preview/renderer.ts`.

3. **The watermark uses pdfmake's built-in one, not a text node.** §12.2
   prescribes a text node carrying `angle`, but pdfmake only ever calls
   `rotate` for `docDefinition.watermark` — `angle` on an ordinary text node is
   silently ignored, so that shape renders horizontally while every
   text-content assertion still passes. Side effect: pdfmake stamps every page,
   so an enabled watermark also appears on the cover. See
   `src/lib/pdf/watermark.ts`.

4. **`wawoff2` is loaded as a classic script, not imported.** §7.4's
   `await import('wawoff2')` never settles in a bundled browser app — the
   Emscripten binding only assigns `module.exports` under Node, and its own
   wrapper races its readiness hook. Symptom: font resolution hangs and the
   render sits on "generating…" forever, with no error to catch. See
   `loadWoff2Binding()` in `src/lib/fonts/google.ts`.

5. **Subsetting alone could not keep the bullet and checkbox glyphs.** §7.2
   assumes the codepoints are present upstream and only need retaining. For ten
   of the twelve families they are absent entirely, so the build grafts them in.
   See `scripts/subset-fonts.md`.

## Testing

- **Unit** — the pure functions that carry the risk: theme migration and import,
  the page-break block rule, header/footer templating and cover-page numbering,
  nested inline composition, font face aliasing, scroll anchoring.
- **Golden** — renders fixtures through the real pipeline with a Node-side
  pdfmake printer and asserts *structure* (page count, text content, break
  positions) with pdf.js. Never pixels: those are flaky across pdfkit versions.
- **E2E** — Playwright against the production build, because the worker and
  base-path behaviour only differ there. Downloads are parsed with pdf.js and
  checked against what the preview is showing. Layout is covered too: several of
  the worst bugs found so far were CSS, not logic, and were invisible to every
  other kind of test.

### Layout bugs are silent

Nothing about a wrong `min-height` shows up in a type check, a unit test, or a
PDF byte comparison. The suite therefore asserts on measured geometry —
`scrollHeight` versus `clientHeight` per pane, page position relative to the
viewport at high zoom, focus after a keystroke — because that is the only level
at which these failures are visible:

| Symptom | Cause |
|---|---|
| Nothing scrolled anywhere | panes defaulted to `min-height: auto` and overflowed their track |
| Left of the page unreachable when zoomed | `align-items: center` on the scroll container |
| Every keystroke after the first ignored | `<details open={prop}>` re-applied on re-render, collapsing the panel and dropping focus |
| `12` typed into a field became `42` | clamping on every keystroke |

## Licence

Application code: MIT. Bundled fonts keep their own licences — see `/licenses`.
