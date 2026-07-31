# Verification of DESIGN.md §16 open items

The five items DESIGN.md flagged as "genuinely unknown, settle by testing, not
assumption". All five were settled by running them. Re-run the commands if a
dependency moves.

---

## 1. Does `pdfmake` run cleanly in a Web Worker under Vite?

**Yes.** No fallback needed.

`src/lib/workers/pdf.worker.ts` imports `pdfmake/build/pdfmake` in a module
worker and generates without touching `window`. Verified in the _production_
build, not just dev — a Playwright test asserts the main-thread fallback banner
is absent:

```
tests/e2e/app.spec.ts → 'generation runs in a worker, not on the main thread'
```

The fallback in `pdf.svelte.ts` is retained anyway: it costs a `try`/`catch` and
covers browsers that refuse module workers.

**One deviation was forced.** §8 posts a finished `TDocumentDefinitions` to the
worker, but §12.1 requires `background`, `header` and `footer` to be _functions_,
which cannot be structured-cloned. The token stream, theme, metadata and
pre-resolved images cross the boundary instead, and `buildDocDefinition` — which
is synchronous precisely so it can — runs worker-side. See
`src/lib/workers/protocol.ts`.

## 2. Does `css2` with a single pinned weight return a static instance?

**Yes, for every family tested.** The warning is a safety net, not routine.

`https://fonts.googleapis.com/css2?family=Inter:wght@700` with a browser
User-Agent returns a WOFF2 which, once decoded, has **no `fvar` table** and
`usWeightClass 700`. Pinning a single weight is therefore the right request
shape; a range (`wght@400..700`) is not.

Also confirmed against the live endpoints:

| Observation                                              | Result                           |
| -------------------------------------------------------- | -------------------------------- |
| `css2` CORS                                              | `access-control-allow-origin: *` |
| `gstatic` CORS                                           | `access-control-allow-origin: *` |
| Browser UA                                               | `format('woff2')`                |
| Legacy UA                                                | `format('truetype')`             |
| Unknown family                                           | HTTP **400** (not 404)           |
| Family without the requested weight (Lobster `wght@700`) | HTTP 400                         |
| Family without italics (Oswald `ital,wght@1,400`)        | HTTP 400                         |

The last two matter: a 400 does not mean "no such family". `google.ts` treats a
failed italic as routine (alias plus warning) and only a failed upright as an
error worth surfacing.

`hasVariationAxes()` still runs on every decoded face and warns loudly if `fvar`
survives, because this was verified for a sample of families, not all of them.

## 3. Is `wawoff2` output TTF-compatible for pdfkit?

**Yes** — but _getting_ the output was the real problem.

### The output format

Decompressed output starts with the `0x00010000` TrueType tag, and pdfkit
embeds it as `/FontFile2`:

```
downloaded 10496 bytes, magic wOF2
decompressed 21536 bytes, tag 0x10000
pdfkit accepted the decoded font: %PDF- … /FontFile2: true
```

No separate CFF/OTF handling was needed. `decodeFont()` additionally short
circuits when the download is _already_ a font, which covers the legacy-UA
`truetype` response shape.

### `wawoff2` cannot be `import`ed in a bundled browser app

The design assumes `const { decompress } = await import('wawoff2')` works. It
does not, and it fails in the worst possible way: **the promise never settles**.
No error, no rejection — font resolution hangs, and with it the whole render,
which sits on "generating…" forever.

Two independent causes, found by bisecting the package:

1. `wawoff2/build/decompress_binding.js` is an Emscripten build that assigns
   `module.exports` **only** under `ENVIRONMENT_IS_NODE`. In a browser it relies
   on its top-level `var Module` becoming a global. Bundling to ESM takes that
   global away, so the import resolves to an object with no `decompress` on it.
   (`decompress` is registered by embind at runtime, so it is never visible to
   static export detection either.)
2. `wawoff2/index.js` requires the binding and only _then_ assigns
   `em_module.onRuntimeInitialized`. If the runtime has already finished, the
   hook never fires and its `await runtimeInit` waits forever.

Fix: load the binding as a **classic `<script>`** from a `?url` asset, which
restores the global the way Emscripten expects, and pre-seed
`window.Module.onRuntimeInitialized` before injecting it so there is no race.
The WASM is inlined as a `data:` URI, so nothing extra is fetched and it stays
self-hosted. See `loadWoff2Binding()` in `src/lib/fonts/google.ts`; it is
main-thread only, which is where font resolution runs.

Verified in both dev and the production build: four faces of Roboto decoded in
38 ms, decoder served as a hashed asset (HTTP 200), no warnings.

There is also a 20-second guard on decoder startup, so any future regression of
this shape degrades to the fallback font instead of freezing the app.

### CORS on error responses

`css2` answers an unknown family — or a weight/style a family does not have —
with a **400 that carries no CORS headers**, so the browser rejects the request
outright and the status never reaches application code. `fetch` merely throws
`Failed to fetch`, which is not the "show the typo, not a stack trace" the
design asks for. `fetchWeight()` therefore maps a network-level failure to a
named-family message, checking `navigator.onLine` first to tell a genuine
offline apart from a typo.

## 4. Does pdfmake honour `opacity` and `angle` on text nodes?

**`opacity` yes. `angle` no — and that one mattered.**

`printer.js` applies `pdfKitDoc.opacity(inline.opacity)` per inline, and
`pdfKitDoc.opacity(image.opacity)` for images, so both are honoured. But
`pdfKitDoc.rotate` is called in exactly one place: `renderWatermark`, for
pdfmake's built-in `docDefinition.watermark`. **`angle` on an ordinary text node
is silently ignored.**

The node shape §12.2 prescribes therefore renders the watermark horizontally.
Worse, it fails invisibly: the text is present, at the right colour and opacity,
so every text-content assertion passes.

Fixed by using pdfmake's built-in watermark, which honours angle, opacity, font,
size and colour, and draws after content on every page — the "watermark last
(top)" ordering §12.2 asks for. The regression test reads the rotation back out
of the PDF via pdf.js text transforms rather than trusting the config:

```
tests/golden/render.test.ts → 'is rotated by the configured %i degrees'
```

**Consequence worth knowing:** pdfmake stamps every page, so an enabled
watermark also appears on the cover page.

## 5. Large-document ceiling

Generation is **linear at roughly 3 ms/page**. Measured with
`npx vite-node -c vitest.config.ts scripts/measure-ceiling.mjs`:

| Pages | Generate | ms/page |   Size |
| ----: | -------: | ------: | -----: |
|    10 |    79 ms |       8 |  44 KB |
|    22 |    85 ms |       4 |  88 KB |
|    47 |   155 ms |       3 | 175 KB |
|    93 |   292 ms |       3 | 339 KB |
|   187 |   622 ms |       3 | 667 KB |

Node-side, so this excludes worker transfer and pdf.js rasterisation — treat it
as a floor for the browser, not a prediction.

Generation is not the bottleneck. Preview rasterisation and memory are, which is
why the preview virtualises beyond 20 pages and destroys each pdf.js document on
swap. **Documented soft limit: 300 pages** (`SOFT_PAGE_LIMIT` in
`src/lib/stores/pdf.svelte.ts`), above which the UI says the preview will be
slow and that the download is unaffected. Nothing is blocked.

Browser-side confirmation of the memory claim: 12 consecutive renders of a
37-page document held steady at 37 page placeholders, 3 rasterised canvases and
an 11 MB JS heap.

---

## Additional finding, outside §16

**Subsetting could not preserve the bullet and checkbox glyphs**, because ten of
the twelve bundled families have no ballot boxes upstream and several have no
`◦` or `▪`. §7.2 assumes the codepoints only need retaining. The build now
grafts the missing symbols in from Source Sans 3, scaled to the host family's
units-per-em. See `scripts/subset-fonts.md`; asserted by
`tests/golden/render.test.ts → 'every bundled family survives emphasis'`.
