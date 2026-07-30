# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Always do this

- Ask if changes should commited once verified

## What this is

A browser-only Markdown → themeable PDF generator. SvelteKit 5 (runes) + `adapter-static`,
no server, deployed to GitHub Pages as a PWA. `DESIGN.md` is the implementation
specification — code comments cite it by section (`§7.4`, `§12.1`), so when a comment
looks arbitrary, that section explains it. `README.md` is user-facing;
`docs/verification.md` records the experiments that settled the spec's open questions.

## Commands

```bash
npm run dev                 # dev server
npm run build               # static build into build/
npm run check               # svelte-check, strict — CI runs this first
npm test                    # unit + golden (Vitest, node env)
npm run test:e2e            # Playwright against the production build
```

Single test:

```bash
npx vitest run --config vitest.config.ts tests/unit/inline.test.ts -t "nested emphasis"
```

```bash
npx playwright test -g "generation runs in a worker"
```

Fonts are rebuilt by `python scripts/build_fonts.py` (needs `fonttools brotli`). It is a
one-time manual step whose outputs are committed — CI has no Python dependency, and there
is deliberately no npm script for it. See `scripts/subset-fonts.md`.

`vitest.config.ts` deliberately does *not* use the SvelteKit plugin: the suites exercise
pure modules plus a Node-side `pdfmake` printer, so `$app/*` virtual modules would only
add failure surface. Anything importing `$app/paths` or `$app/environment` is therefore
untestable there by construction — keep that logic out of the pure modules.

## Architecture

```
Editor / ThemePanel ─► $effect in +page.svelte ─► pdfStore.schedule()
  └─ debounce 400ms ─► parse() ─► resolveImages() ─► resolveFonts() (IndexedDB)
       └─► postMessage ─► pdf.worker ─► buildDocDefinition ─► pdfmake ─► ArrayBuffer
             ├─► pdf.js canvas preview
             └─► Download button (same bytes, never regenerated)
```

**One render path.** The preview and the download are the same `ArrayBuffer`. Never add a
second path — there would be nothing to keep the two in agreement.

**The worker receives tokens, not a document definition.** `header`/`footer`/`background`
must be functions (pdfmake requirement) and functions cannot be structured-cloned, so
`RenderRequest` (`src/lib/workers/protocol.ts`) carries the markdown-it token stream, the
theme, pre-resolved images and the font VFS. `buildDocDefinition` is **synchronous by
construction** so it can run worker-side — do not make it async.

**The worker is optional.** `pdf.svelte.ts#dispatch` falls back permanently to
main-thread `engine.generate()` on any worker failure and sets `usingMainThread`.
`engine.generate()` takes everything from its request — no module state, no globals — so
the two paths cannot diverge and consecutive renders cannot bleed fonts.

**Stale renders are discarded by id.** Every render gets a monotonic id; responses whose
id is not `#latestId` are dropped, and `completedId` is surfaced in the DOM so E2E tests
wait for a specific render instead of guessing at the debounce.

**`SOFT_PAGE_LIMIT` (300) is advisory.** Generation is linear at ~3 ms/page
(`scripts/measure-ceiling.mjs`); what degrades first is preview rasterisation and memory,
so past the limit the app warns rather than refusing.

### Layers

| Path | Role |
|---|---|
| `src/lib/markdown/` | markdown-it setup, front matter, `<!-- pagebreak -->` plugin. `html: false` is non-negotiable — raw HTML must never reach the PDF. |
| `src/lib/pdf/` | Token stream → pdfmake document definition. `buildDocDefinition` orchestrates; `blocks`/`inline`/`tables`/`cover`/`headerFooter`/`watermark`/`styles` each own one concern. |
| `src/lib/fonts/` | `resolve.ts` per-slot resolution with fallback, `builtin`/`google`/`upload` loaders, `cache.ts` IndexedDB, `register.ts` → pdfmake VFS. |
| `src/lib/theme/` | Zod schema, defaults, `migrate.ts` (version-keyed, must never throw), `io.ts` import/export, JSON presets. |
| `src/lib/preview/` | pdf.js rendering, `scrollSync`/`lineMetrics`/`scrollAnchor`. |
| `src/lib/stores/*.svelte.ts` | Svelte 5 rune classes, single instances exported at the bottom. `persist.ts` wraps localStorage; binaries go to IndexedDB. |

### Scroll sync

Anchor-based, not scroll-fraction. Each block is tagged with its source line; pdfmake's
`pageBreakBefore` callback is the only hook that reports a node's final position, so
`anchors` (line → page + offset) is filled **during layout** — read it only after
generation. The editor side needs the inverse mapping in a soft-wrapped `<textarea>`,
which has no per-line geometry API (`scrollTop / lineHeight` is wrong the moment anything
wraps), so `lineMetrics.ts` measures a hidden mirror element with one child per line,
built only when sync asks for a mapping. Proportional sync drifts badly on a document with
a long code block or a forced page break; a test covers exactly that case.

## Invariants worth knowing before editing

- **Every runtime asset URL goes through `base` from `$app/paths`** (see `assetUrl()` in
  `fonts/builtin.ts`), or it 404s under the `/<repo>/` project-site path.
- **Font cache keys and URLs carry a content version** from `static/fonts/manifest.json`.
  Files keep their names across rebuilds, so without the version a rebuilt font never
  reaches an existing visitor — IndexedDB and the CacheFirst service worker both serve
  the old bytes. `tests/unit/fontVersioning.test.ts` guards this.
- **Never mutate `pdfMake.vfs` / `pdfMake.fonts`.** Both are passed per-call; the worker
  is long-lived and globals bleed fonts across theme switches.
- **Theme import never throws.** A malformed or partial theme deep-merges over
  `DEFAULT_THEME` and degrades with warnings; the render path must not see an
  incomplete theme. Any schema change needs a `MIGRATIONS` entry and a `THEME_VERSION`
  bump.
- **Service-worker precache URLs must stay scope-relative** — see Deployment below.
- Prettier: tabs, single quotes, no trailing commas, 100 cols.

## Fonts

Twelve families are bundled as **static** instances, four faces each, ~3.4 MB total,
fetched lazily and cached in IndexedDB. `scripts/build_fonts.py` produces them; the full
procedure and rationale is in `scripts/subset-fonts.md`. Two things that bit here:

- Upstream ships most of these as variable fonts, and pdfkit ignores variation axes — a
  variable file renders "Bold" as Regular. The build pins every axis and asserts `fvar`
  is gone.
- Ten of the twelve ship no ballot-box glyphs (task checkboxes) and none of the
  proportional families have box drawing (`tree` diagrams), so subsetting cannot retain
  what was never there. The build grafts them in from Source Sans 3 / JetBrains Mono,
  scaled to the host family's upem.

Google Fonts are requested with `text=`. Plain `css2` answers with a dozen `@font-face`
blocks split by `unicode-range`, and pdfkit can embed only one file — picking a block
rendered every Latin character as tofu.

## Deployment

`.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>` and publishes to GitHub
Pages, which must be set to **Source: GitHub Actions**. `static/.nojekyll` is committed
and `appDir` is `internal`, because Jekyll ignores `_app`.

Two service-worker bugs specific to a project site, both fixed in
`build-config/precacheTransform.ts` and covered by its unit test plus two E2E tests:

- **@vite-pwa/sveltekit derives its precache prefix from Vite's `base`**, which SvelteKit
  leaves at `/` while serving from `paths.base`. The shell was precached as root-absolute
  `/`, and since `navigateFallback` binds to that URL the worker answered *every* in-scope
  navigation with whatever lives at the domain root. Precache URLs are now scope-relative,
  so one build is correct at `/` and at `/<repo>/`.
- **The webmanifest was contributed twice** with different revisions, which workbox
  rejects — the worker registered but its precache silently never populated.

## Deviations from DESIGN.md

Five places the spec did not survive implementation. Each is commented at the site.

1. **The worker receives tokens, not a document definition** — see Architecture above.
   `src/lib/workers/protocol.ts`.
2. **pdf.js gets a worker port, not a `workerSrc` URL.** §9's `?url` form works in dev and
   fails in the production build: the emitted asset is an ES module, pdf.js loads
   `workerSrc` as a classic worker, and the fake-worker fallback then fails to import it.
   `?worker` plus `PDFWorker({ port })` works in both. `src/lib/preview/renderer.ts`.
3. **The watermark uses pdfmake's built-in one, not a text node.** §12.2 prescribes a text
   node with `angle`, but pdfmake only calls `rotate` for `docDefinition.watermark` —
   `angle` on an ordinary text node is silently ignored, so that shape renders horizontally
   while every text-content assertion still passes. Side effect: pdfmake stamps every page,
   so a watermark also lands on the cover. `src/lib/pdf/watermark.ts`.
4. **`wawoff2` is loaded as a classic script, not imported.** §7.4's `await
   import('wawoff2')` never settles in a bundled browser app — the Emscripten binding only
   assigns `module.exports` under Node and races its own readiness hook. Symptom: font
   resolution hangs and the render sits on "generating…" forever with no error to catch.
   `loadWoff2Binding()` in `src/lib/fonts/google.ts`.
5. **Subsetting alone could not keep the bullet and checkbox glyphs** — see Fonts above.

## Testing strategy

- **Unit** — the pure risky functions (theme migration/IO, page-break rules,
  header/footer templating, inline composition, font aliasing, scroll anchoring,
  precache transform).
- **Golden** (`tests/golden/`) — real pipeline via `tests/helpers/render.ts`, a Node-side
  `PdfPrinter` twin of the browser path, asserting **structure** (page count, text, break
  positions, text-transform angles) with pdf.js. Never pixels: flaky across pdfkit
  versions.
- **E2E** — Playwright against the production build only, because the pdf.js worker and
  base-path behaviour differ there. Downloads are parsed with pdf.js and compared to the
  preview.
- **Layout assertions are load-bearing.** Several of the worst bugs so far were CSS and
  invisible to type checks, unit tests and byte comparison. The suite asserts measured
  geometry — keep that habit when touching layout. What it has caught:

| Symptom | Cause |
|---|---|
| Nothing scrolled anywhere | panes defaulted to `min-height: auto` and overflowed their track |
| Left of the page unreachable when zoomed | `align-items: center` on the scroll container |
| Every keystroke after the first ignored | `<details open={prop}>` re-applied on re-render, collapsing the panel and dropping focus |
| `12` typed into a field became `42` | clamping on every keystroke |
