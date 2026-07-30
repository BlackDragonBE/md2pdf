# The pdfmake patch

`pdfmake+0.2.23.patch` teaches pdfmake to flow an image or SVG **inline with
text**. Two features depend on it entirely: colour emoji, and mid-sentence
`![alt](x)` images.

Applied by `postinstall` (`patch-package`). Guarded by
`tests/unit/pdfmakePatch.test.ts`.

## Why

pdfmake has no in-text-flow non-text node, and never has. PDF itself has no
colour-font concept either, so no emoji *font* can carry colour — pdfkit's
maintainer says the only route is to
"insert the emoji as images" ([pdfkit#575](https://github.com/devongovett/pdfkit/issues/575)).
That is precisely what pdfmake cannot do.

Upstream is a dead end in all three directions:

- [pdfmake#1287](https://github.com/bpampuch/pdfmake/pull/1287) is exactly this
  fix. Open since **2018**, maintainer-silent, still working per commenters.
- pdfmake **0.3.x does not add it** — master's `TextBreaker.js`/`TextInlines.js`
  contain no `image`/`svg` handling at all. It would also cost us per-render font
  isolation (0.3 moves fonts to mutable singleton state) and `_createDoc`/
  `_flushDoc`, our page-count hook.
- [pdfkit#1690](https://github.com/foliojs/pdfkit/pull/1690) /
  [#1692](https://github.com/foliojs/pdfkit/pull/1692) add real colour-emoji
  support and stalled in March 2026 on a test-font licence — and would land in
  upstream pdfkit, not the `@foliojs-fork/pdfkit` pdfmake 0.2.x bundles.

**Remove this patch** if pdfmake ever ships inline artwork natively.

## What it does

The node was never really "dropped": `copyStyle` copies every key except `text`
onto the inline, and `splitWords('')` still yields one word, so an `{svg}` item
reaches the renderer carrying its markup. It failed for two narrow reasons, so
the patch is two hunks in the two functions `sup`/`sub` already use:

- **`src/textTools.js`, `measure()`** — stop overwriting the caller's width with
  `widthOfString('') === 0`. Stash the draw size on `_inlineW`/`_inlineH`.
  `height` deliberately stays the text line height: `Line.getHeight` grows the
  box from the tallest inline but `Line.getAscenderHeight` is font-derived only,
  so raising it would add space *below* the baseline instead of moving the text.
- **`src/printer.js`, `renderLine()`** — draw `inline.svg` via `SVGtoPDF` or
  `inline.image` via `pdfKitDoc.image`, on the baseline, then `continue`.

The caller must always supply **both** `width` and `height`. That is what lets
the patch avoid any new `require`, which matters below.

Not needed, contrary to #1287: its `layoutBuilder.js` change would push image
inlines into the character-splitting branch (`''.length === 0` already skips it),
and its `line.js` change multiplies an ascender ratio by a pixel height.

## The trap: there are two copies of pdfmake

| Consumer | Entry |
|---|---|
| Browser / worker (`src/lib/pdf/engine.ts`) | `pdfmake/build/pdfmake.js` — a 2.85 MB prebuilt webpack bundle |
| Node golden tests (`tests/helpers/render.ts`) | `pdfmake/src/printer.js` |

They are **different copies of the same code**. Patching only `src/` turns the
entire Node suite green while the app stays broken. The bundle is unminified and
byte-identical to `src/`, so the same hunks apply — but only because they
introduce no import: in the bundle, requires are numeric webpack module ids.

This bit during development. A script that copied the hunks matched on a
trailing code line, truncated the `measure()` hunk at the end of its `if` branch,
and dropped the `else` that measures every ordinary word. The marker comment was
still present, every Node test passed, and the browser could not lay out any text
at all. Hence `tests/unit/pdfmakePatch.test.ts` asserts the *surviving original
behaviour* (`widthOfString(item.text`, `pdfKitDoc.text(inline.text`), not just
the marker — and the E2E test
"a mid-sentence image reaches the downloaded PDF" is the only thing that
exercises the bundle at all.

## Maintenance

- **`pdfmake` is pinned to an exact version.** A caret range lets `npm install`
  pull a version the patch does not match, silently un-patching the browser.
  Note `npm install` will happily rewrite the pin back to `^` when it re-resolves
  the package — the guard test catches that.
- Regenerate after editing `node_modules/pdfmake`:
  `npx patch-package pdfmake`.
- `postinstall` does not run under `npm ci --ignore-scripts`. The guard tests
  fail loudly rather than letting a silently unpatched build ship.
