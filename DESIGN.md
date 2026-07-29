# md2pdf — Implementation Specification

A client-side Markdown → PDF application with fully themeable output. Static-hosted on GitHub Pages, installable as a PWA, no backend of any kind.

**Audience:** an autonomous coding agent (Claude Code). This document is the source of truth. Where it specifies an exact path, identifier, or library, use that one. Where it says *verify*, run the check before building on the assumption.

---

## 1. Product definition

### 1.1 What it does

A two-pane web app. Left: a Markdown editor. Right: a live, paginated, **pixel-exact** preview of the PDF that the Download button produces. A theme panel controls every visual aspect of the output — page geometry, fonts, colours, sizes, margins, background image/watermark, cover page, running header/footer, and page-break behaviour. Themes serialise to and from JSON.
Inspired by https://github.com/LapchienSun/Markdown-To-PDF

### 1.2 Differentiators (the reason this project exists)

1. **Runs entirely on GitHub Pages.** No server, no serverless functions, no build-time rendering of user content. Download/install is optional (PWA).
2. **Deep PDF theming with portable JSON themes.** This is the core value. Every design decision below defers to it.

### 1.3 Non-goals — do not build these

- Real-time collaboration, accounts, cloud sync.
- A general HTML-to-PDF engine. This app renders a **defined subset of Markdown** exactly, not arbitrary CSS.
- Raw HTML passthrough from Markdown into the PDF.
- Server-side or headless-browser PDF generation.
- Editing existing PDFs.

### 1.4 Rejected approaches — do not reintroduce

| Approach | Why rejected |
|---|---|
| `html2canvas` + `jsPDF` | Rasterises. Output is not searchable or selectable. Non-negotiable. |
| `paged.js` + `window.print()` | Backgrounds and watermarks only render if the user manually ticks "Background graphics" in the browser print dialog. Silently drops a must-have feature. Also no one-click download. |
| Separate HTML preview + separate PDF renderer | Two layout engines drift. With user-authored themes, that drift becomes the primary bug source. There is exactly one renderer. |
| `@react-pdf/renderer` | Would drag React into a Svelte codebase for the export path only. `pdfmake` is framework-agnostic and its document definition is already JSON, which maps near 1:1 onto the theme model. |
| Build-time harvesting of Google Fonts TTF URLs via User-Agent spoofing | Depends on undocumented Google behaviour. Superseded by the three-tier font model in §7. |
| Base64-inlining fonts into the JS bundle | 33% size inflation plus unavoidable parse cost. Fonts are fetched as binary and cached in IndexedDB. |

---

## 2. Locked technical decisions

| Concern | Decision |
|---|---|
| Framework | **SvelteKit 2 + Svelte 5 (runes)** + TypeScript, strict mode |
| Build | Vite (via SvelteKit), `@sveltejs/adapter-static` |
| Markdown parser | `markdown-it` + custom rules |
| PDF engine | `pdfmake` (v0.2.x), running in a dedicated Web Worker |
| PDF preview | `pdfjs-dist` rendering the exact same `ArrayBuffer` to `<canvas>` |
| Schema validation | `zod` |
| Binary cache | IndexedDB via `idb` |
| WOFF2 → TTF | `wawoff2` (lazy-loaded, only for the Google Fonts tier) |
| PWA | `vite-plugin-pwa` |
| Unit tests | Vitest |
| E2E tests | Playwright |
| Editor (phase 1–5) | plain `<textarea>` |
| Editor (phase 8, optional) | CodeMirror 6 |

**Type safety:** `strict: true`, no `any` in committed code. `pdfmake` has weak types; write local interfaces in `src/lib/pdf/pdfmake-types.ts` rather than casting to `any` at call sites.

---

## 3. Architecture

```
┌─────────────────── main thread ───────────────────┐
│  Editor  ──┐                                       │
│            ├─► docStore ──┐                        │
│  ThemePanel┘              │  debounce 400ms        │
│            └─► themeStore ┘         │              │
│                                     ▼              │
│                          resolveFonts()  ← IndexedDB / network
│                                     │              │
│                                     ▼              │
│                    postMessage({ docDef, fonts })  │
└────────────────────────────┬───────────────────────┘
                             ▼
                  ┌─── pdf.worker.ts ────┐
                  │  pdfMake.createPdf   │
                  │  → ArrayBuffer       │
                  └──────────┬───────────┘
                             ▼
        ┌────────────────────┴────────────────────┐
        ▼                                         ▼
  pdf.js worker → <canvas> preview        Download button
                                          (same ArrayBuffer)
```

The single most important property: **the preview and the download are the same bytes.** There is no second render path. Never introduce one.

---

## 4. Repository layout

```
md2pdf/
├── .github/workflows/deploy.yml
├── scripts/
│   └── subset-fonts.md              # one-time manual procedure, see §7.2
├── static/
│   ├── .nojekyll
│   └── fonts/                       # committed, subsetted TTFs
│       ├── inter/{Regular,Bold,Italic,BoldItalic}.ttf
│       ├── source-sans-3/…
│       └── manifest.json            # BuiltinFontManifest, see §7.1
├── src/
│   ├── app.html
│   ├── app.css
│   ├── lib/
│   │   ├── markdown/
│   │   │   ├── parse.ts             # source → { meta, tokens }
│   │   │   ├── pagebreak.ts         # markdown-it block rule
│   │   │   └── frontmatter.ts       # YAML front matter → DocMeta
│   │   ├── pdf/
│   │   │   ├── buildDocDefinition.ts # tokens + theme + meta → DocDefinition
│   │   │   ├── blocks.ts            # block-level token → pdfmake node
│   │   │   ├── inline.ts            # inline token → pdfmake text runs
│   │   │   ├── tables.ts
│   │   │   ├── images.ts
│   │   │   ├── cover.ts
│   │   │   ├── watermark.ts
│   │   │   ├── headerFooter.ts
│   │   │   ├── layouts.ts           # pdfmake table layouts
│   │   │   ├── styles.ts            # theme → pdfmake styles dictionary
│   │   │   └── pdfmake-types.ts
│   │   ├── fonts/
│   │   │   ├── types.ts
│   │   │   ├── builtin.ts
│   │   │   ├── upload.ts
│   │   │   ├── google.ts
│   │   │   ├── resolve.ts           # FontSource → FaceBuffers
│   │   │   ├── register.ts          # FaceBuffers → pdfmake vfs + fonts
│   │   │   └── cache.ts             # IndexedDB
│   │   ├── theme/
│   │   │   ├── schema.ts            # zod schema + Theme type
│   │   │   ├── defaults.ts          # DEFAULT_THEME
│   │   │   ├── migrate.ts           # versioned migration chain
│   │   │   ├── io.ts                # import/export JSON + .mdtheme
│   │   │   └── presets/*.json
│   │   ├── preview/
│   │   │   ├── renderer.ts          # pdf.js → canvas
│   │   │   └── scrollAnchor.ts
│   │   ├── stores/
│   │   │   ├── doc.svelte.ts
│   │   │   ├── theme.svelte.ts
│   │   │   └── pdf.svelte.ts        # generation state machine
│   │   ├── workers/
│   │   │   └── pdf.worker.ts
│   │   └── util/
│   │       ├── debounce.ts
│   │       └── base64.ts
│   └── routes/
│       ├── +layout.ts               # export const prerender = true; export const ssr = false;
│       ├── +page.svelte
│       └── licenses/+page.svelte    # font attribution, see §12.3
├── tests/
│   ├── unit/
│   └── e2e/
├── svelte.config.js
├── vite.config.ts
└── package.json
```

---

## 5. Theme model

### 5.1 Full schema

`src/lib/theme/schema.ts` — this is the canonical definition. The Zod schema and the TypeScript type must be derived from one another (`z.infer`), never written twice.

```ts
import { z } from 'zod';

export const THEME_VERSION = 1;

const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const Margin = z.tuple([z.number(), z.number(), z.number(), z.number()]); // [l, t, r, b] in pt

const FontSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), id: z.string() }),
  z.object({ kind: z.literal('upload'),  hash: z.string(), family: z.string() }),
  z.object({ kind: z.literal('google'),  family: z.string(), weights: z.array(z.number()).default([400, 700]) })
]);

const FontSlot = z.object({
  source: FontSource,
  /** Applied when `source` fails to resolve. Must be a builtin id. */
  fallback: z.string().default('inter')
});

const ElementStyle = z.object({
  font: z.enum(['body', 'heading', 'mono']).default('body'),
  size: z.number().min(4).max(96),
  bold: z.boolean().default(false),
  italics: z.boolean().default(false),
  color: Hex,
  lineHeight: z.number().min(0.6).max(3).default(1.35),
  alignment: z.enum(['left', 'center', 'right', 'justify']).default('left'),
  margin: Margin,
  /** Force a page break before this element. */
  breakBefore: z.boolean().default(false),
  /** Prevent this element being the last thing on a page. */
  keepWithNext: z.boolean().default(false),
  characterSpacing: z.number().default(0)
});

const ImageSpec = z.object({
  /** data: URI. Never a remote URL — see §9.3. */
  dataUri: z.string().startsWith('data:'),
  fit: z.enum(['cover', 'contain', 'stretch', 'tile']).default('cover'),
  opacity: z.number().min(0).max(1).default(1)
});

export const ThemeSchema = z.object({
  version: z.literal(THEME_VERSION),
  name: z.string().min(1).max(80),

  page: z.object({
    size: z.enum(['A4', 'A5', 'A3', 'LETTER', 'LEGAL', 'TABLOID']).default('A4'),
    orientation: z.enum(['portrait', 'landscape']).default('portrait'),
    margins: Margin.default([56, 64, 56, 64])
  }),

  fonts: z.object({
    body:    FontSlot,
    heading: FontSlot,
    mono:    FontSlot
  }),

  background: z.object({
    color: Hex.default('#ffffff'),
    image: ImageSpec.nullable().default(null)
  }),

  watermark: z.object({
    enabled: z.boolean().default(false),
    text: z.string().max(40).default('DRAFT'),
    angle: z.number().min(-90).max(90).default(-45),
    opacity: z.number().min(0).max(1).default(0.08),
    size: z.number().min(8).max(200).default(90),
    color: Hex.default('#000000'),
    font: z.enum(['body', 'heading', 'mono']).default('heading')
  }),

  cover: z.object({
    enabled: z.boolean().default(false),
    background: z.object({
      color: Hex.default('#ffffff'),
      image: ImageSpec.nullable().default(null)
    }),
    blocks: z.array(z.object({
      /** Which DocMeta field to render, or a literal string. */
      field: z.enum(['title', 'subtitle', 'author', 'date', 'literal']),
      literal: z.string().default(''),
      /** Vertical position as a percentage of page height, e.g. "38%". */
      y: z.string().regex(/^\d{1,3}(\.\d+)?%$/),
      alignment: z.enum(['left', 'center', 'right']).default('center'),
      font: z.enum(['body', 'heading', 'mono']).default('heading'),
      size: z.number().min(6).max(120),
      bold: z.boolean().default(false),
      color: Hex
    })).default([]),
    /** If true, the cover is not counted in {{page}} / {{pages}}. */
    excludeFromPageCount: z.boolean().default(true)
  }),

  header: z.object({
    enabled: z.boolean().default(false),
    template: z.string().default('{{title}}'),
    alignment: z.enum(['left', 'center', 'right']).default('right'),
    font: z.enum(['body', 'heading', 'mono']).default('body'),
    size: z.number().default(8),
    color: Hex.default('#888888'),
    /** Distance from page top edge, in pt. Must be < page.margins[1]. */
    offset: z.number().default(28),
    showOnFirstContentPage: z.boolean().default(true),
    rule: z.object({
      enabled: z.boolean().default(false),
      color: Hex.default('#dddddd'),
      width: z.number().default(0.5)
    })
  }),

  footer: z.object({
    enabled: z.boolean().default(true),
    template: z.string().default('{{page}} / {{pages}}'),
    alignment: z.enum(['left', 'center', 'right']).default('center'),
    font: z.enum(['body', 'heading', 'mono']).default('body'),
    size: z.number().default(8),
    color: Hex.default('#888888'),
    offset: z.number().default(28),
    showOnFirstContentPage: z.boolean().default(true),
    rule: z.object({
      enabled: z.boolean().default(false),
      color: Hex.default('#dddddd'),
      width: z.number().default(0.5)
    })
  }),

  pagebreak: z.object({
    /** Literal line in the Markdown source that forces a page break. */
    marker: z.string().min(2).max(32).default('\\pagebreak')
  }),

  code: z.object({
    background: Hex.default('#f6f8fa'),
    borderColor: Hex.default('#e1e4e8'),
    borderWidth: z.number().default(0.5),
    padding: Margin.default([8, 6, 8, 6]),
    showLineNumbers: z.boolean().default(false),
    lineNumberColor: Hex.default('#b0b0b0'),
    syntaxHighlight: z.boolean().default(false),
    /** Token colours, keyed by highlight.js scope name. */
    tokenColors: z.record(z.string(), Hex).default({})
  }),

  table: z.object({
    headerFill: Hex.default('#f0f0f0'),
    headerColor: Hex.default('#111111'),
    headerBold: z.boolean().default(true),
    borderColor: Hex.default('#dddddd'),
    borderWidth: z.number().default(0.5),
    zebra: Hex.nullable().default(null),
    cellPadding: Margin.default([6, 4, 6, 4]),
    /** Repeat the header row when a table spans pages. */
    repeatHeader: z.boolean().default(true)
  }),

  blockquote: z.object({
    barColor: Hex.default('#cccccc'),
    barWidth: z.number().default(3),
    indent: z.number().default(12),
    background: Hex.nullable().default(null)
  }),

  hr: z.object({
    color: Hex.default('#dddddd'),
    width: z.number().default(0.5),
    margin: Margin.default([0, 10, 0, 10])
  }),

  list: z.object({
    bulletChars: z.array(z.string()).default(['•', '◦', '▪']),
    indent: z.number().default(16),
    itemSpacing: z.number().default(3),
    taskChecked: z.string().default('☑'),
    taskUnchecked: z.string().default('☐')
  }),

  link: z.object({
    color: Hex.default('#0366d6'),
    underline: z.boolean().default(false)
  }),

  image: z.object({
    /** Max width as a fraction of the content column width. */
    maxWidth: z.number().min(0.1).max(1).default(1),
    alignment: z.enum(['left', 'center', 'right']).default('center'),
    margin: Margin.default([0, 8, 0, 8]),
    caption: z.object({
      enabled: z.boolean().default(false),
      size: z.number().default(8),
      italics: z.boolean().default(true),
      color: Hex.default('#666666')
    })
  }),

  elements: z.object({
    h1: ElementStyle, h2: ElementStyle, h3: ElementStyle,
    h4: ElementStyle, h5: ElementStyle, h6: ElementStyle,
    paragraph: ElementStyle,
    codeBlock: ElementStyle,
    inlineCode: ElementStyle,
    blockquote: ElementStyle,
    listItem: ElementStyle,
    tableCell: ElementStyle,
    tableHeader: ElementStyle
  }),

  locale: z.string().default('en-GB')
});

export type Theme = z.infer<typeof ThemeSchema>;
export type ElementStyleT = z.infer<typeof ElementStyle>;
export type FontSourceT = z.infer<typeof FontSource>;
```

### 5.2 Import rules

`src/lib/theme/io.ts`:

```ts
export function importTheme(raw: unknown): { theme: Theme; warnings: string[] }
```

1. Run `migrate(raw)` first (§5.3) — never validate before migrating.
2. Deep-merge the migrated object **over** `DEFAULT_THEME`, so a partial or hand-edited file always yields a complete theme.
3. Validate the merged result with `ThemeSchema.safeParse`.
4. On failure, return `DEFAULT_THEME` plus human-readable warnings derived from `error.issues` — **never throw into the render path**. A malformed theme must degrade, not crash.
5. Reject any `dataUri` exceeding 4 MB with a warning; reject non-`image/*` MIME types outright.

### 5.3 Migration

`src/lib/theme/migrate.ts`:

```ts
type Migration = (input: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Record<number, Migration> = {
  // 1: (t) => ({ ...t, version: 2, newField: default }),
};
export function migrate(raw: unknown): Record<string, unknown>
```

Apply migrations in ascending order from `raw.version` to `THEME_VERSION`. An unknown or missing `version` is treated as `1`. **Write the migration harness in phase 4 even though it is empty** — retrofitting it after themes are in users' hands is not possible.

### 5.4 Export

- Default export: `<slug>.theme.json`, pretty-printed with 2-space indent.
- `builtin` and `google` font sources export as identifiers only — **never inline their binaries**. A shared theme should be a few KB.
- If any font slot uses `kind: 'upload'`, or any `dataUri` exceeds 256 KB, export a `.mdtheme` ZIP instead (`theme.json` + `assets/` + `fonts/`). Use `fflate` for zipping.

---

## 6. Markdown pipeline

### 6.1 Parse

`src/lib/markdown/parse.ts`:

```ts
export interface DocMeta {
  title: string;
  subtitle: string;
  author: string;
  date: string;      // ISO 8601, or '' to mean "today at render time"
}

export interface ParseResult {
  meta: DocMeta;
  tokens: Token[];   // markdown-it Token[]
}

export function parse(source: string, marker: string): ParseResult
```

`markdown-it` configuration — fix these exactly:

```ts
const md = new MarkdownIt({
  html: false,        // NON-NEGOTIABLE. Raw HTML never reaches the PDF.
  linkify: true,
  typographer: true,
  breaks: false
});
md.use(taskListsPlugin);   // markdown-it-task-lists
md.use(pagebreakPlugin, { marker });
```

`html: false` is a hard security and correctness requirement. The PDF renderer has no HTML support, so any passthrough would either be dropped silently or leak escaped angle brackets into the output. `html_block` and `html_inline` tokens must be dropped in `buildDocDefinition` with a collected warning.

### 6.2 Front matter

`src/lib/markdown/frontmatter.ts` — strip a leading `---\n…\n---` block, parse with `js-yaml` in `JSON_SCHEMA` mode (not the default schema; avoid arbitrary type construction). Extract `title`, `subtitle`, `author`, `date`. Anything else is ignored. Missing fields fall back to the values in the document-metadata UI panel, then to `''`.

### 6.3 Page-break rule

`src/lib/markdown/pagebreak.ts` — a `markdown-it` **block rule**, registered before `hr`:

```ts
md.block.ruler.before('hr', 'pagebreak', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
```

The rule matches a line whose trimmed content equals `theme.pagebreak.marker` exactly, and pushes a token with `type: 'pagebreak'`, `block: true`, `nesting: 0`.

**Do not implement this by splitting the source string.** A marker inside a fenced code block must render as literal text, and only a real block rule respects fence state.

The marker is configurable, so `parse()` must be re-run when `theme.pagebreak.marker` changes. Validate on theme import that the marker does not match `/^(#{1,6}\s|>|[-*_]{3,}$|\d+\.\s|[-*+]\s|```|~~~)/` — reject with a warning if it collides with real Markdown syntax.

### 6.4 Token → pdfmake node mapping

Implemented across `src/lib/pdf/blocks.ts` and `inline.ts`. `T` = theme, `E` = `T.elements`.

| markdown-it token | pdfmake node |
|---|---|
| `heading_open` h1–h6 | `{ text: inline, style: 'h1'…'h6', headlineLevel: n, margin: E.hN.margin, pageBreak: E.hN.breakBefore ? 'before' : undefined }` |
| `paragraph_open` | `{ text: inline, style: 'paragraph' }` |
| `bullet_list_open` | `{ ul: [...], type: bulletCharForDepth(depth), markerColor: E.listItem.color }` |
| `ordered_list_open` | `{ ol: [...], start: token.attrGet('start') }` |
| `list_item_open` | recurse; nested lists nest as `ul`/`ol` inside the item array |
| task list item | `{ text: [{ text: checked ? T.list.taskChecked : T.list.taskUnchecked }, ' ', ...inline] }` |
| `blockquote_open` | 1×1 table with `layout: 'blockquoteBar'` (§6.6) |
| `fence` / `code_block` | 1×1 table, `layout: 'codeBlock'`, `fillColor: T.code.background` |
| `table_open` | `{ table: { headerRows: T.table.repeatHeader ? 1 : 0, widths, body }, layout: 'themed' }` |
| `hr` | `{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: T.hr.width, lineColor: T.hr.color }], margin: T.hr.margin }` |
| `pagebreak` (custom) | `{ text: '', pageBreak: 'after' }` |
| `html_block`, `html_inline` | **dropped**, warning collected |
| `text` | `{ text, style: contextStyle }` |
| `strong_open` | `bold: true` on the run |
| `em_open` | `italics: true` |
| `s_open` | `decoration: 'lineThrough'` |
| `code_inline` | `{ text, style: 'inlineCode', background: T.code.background }` |
| `link_open` | `{ text, link: href, color: T.link.color, decoration: T.link.underline ? 'underline' : undefined }` |
| `image` | see §6.7 |
| `softbreak` | `' '` (because `breaks: false`) |
| `hardbreak` | `'\n'` |

**Nested inline formatting must compose.** `**bold *and italic***` produces one run with both `bold` and `italics`. Implement `inline.ts` as a stack of active format flags, not a series of special cases.

### 6.5 Styles dictionary

`src/lib/pdf/styles.ts` maps `theme.elements` onto the pdfmake `styles` object. `defaultStyle` is derived from `E.paragraph`. Every `ElementStyle` field has a direct pdfmake equivalent except `keepWithNext` and `breakBefore`, which are handled in `buildDocDefinition` (§6.8) and per-node respectively.

### 6.6 Table layouts

`src/lib/pdf/layouts.ts` exports a factory, because layouts close over the theme:

```ts
export function buildLayouts(t: Theme): Record<string, CustomTableLayout>
// keys: 'themed' (Markdown tables), 'codeBlock', 'blockquoteBar'
```

- `blockquoteBar`: `vLineWidth: (i) => (i === 0 ? t.blockquote.barWidth : 0)`, `hLineWidth: () => 0`, `vLineColor: () => t.blockquote.barColor`, `paddingLeft: () => t.blockquote.indent`.
- `codeBlock`: zero border widths unless `t.code.borderWidth > 0`; padding from `t.code.padding`.
- `themed`: borders from `t.table.*`, `fillColor: (rowIndex) => rowIndex === 0 ? t.table.headerFill : (t.table.zebra && rowIndex % 2 === 0 ? t.table.zebra : null)`.

Pass layouts as the second argument to `createPdf`, not via a global.

### 6.7 Images

`src/lib/pdf/images.ts`. This is the most failure-prone part of the pipeline; handle every branch.

1. `data:` URI → use directly.
2. `http(s)` URL → `fetch(url, { mode: 'cors' })` → `Blob` → data URI. On network or CORS failure, emit a placeholder: a grey `canvas` rectangle plus the alt text, and collect a warning. **Do not let a broken image abort generation.**
3. Relative paths → not resolvable in a static app. Emit the placeholder and a warning telling the user to paste an image (which stores it as a data URI in the document).
4. **Intrinsic size is required.** pdfmake will not scale an image without an explicit `width`. Decode with `createImageBitmap(blob)` to obtain `width`/`height`, then compute:
   ```
   contentWidth = pageWidthPt - margins[0] - margins[2]
   drawWidth    = min(intrinsicWidth * 0.75, contentWidth * theme.image.maxWidth)   // px → pt at 96dpi
   ```
   Omitting this produces images that overflow the page and silently clip.
5. Cache resolved data URIs in a `Map<string, string>` keyed by URL for the session, so a re-render on every keystroke does not re-fetch.
6. Image resolution is **async**, but `buildDocDefinition` must be **sync** to run in the worker. Resolve all images on the main thread first, into a `Map<string, ResolvedImage>` passed into the worker alongside the tokens.

### 6.8 Orphan control

`buildDocDefinition` sets:

```ts
pageBreakBefore: (currentNode, followingNodesOnPage) =>
  currentNode.headlineLevel != null &&
  themeKeepWithNext[currentNode.headlineLevel] &&
  followingNodesOnPage.length === 0
```

This is why headings carry `headlineLevel`. Without it, headings strand at the bottom of pages and the output looks amateurish.

---

## 7. Fonts

Three tiers behind one interface. `src/lib/fonts/types.ts`:

```ts
export type FaceKey = 'normal' | 'bold' | 'italics' | 'bolditalics';
export type FaceBuffers = Record<FaceKey, ArrayBuffer>;

export interface ResolvedFont {
  family: string;          // key used in pdfMake.fonts
  faces: FaceBuffers;
  warnings: string[];
}

export function resolve(source: FontSourceT, fallbackId: string): Promise<ResolvedFont>;
```

**All four faces must always be populated.** pdfmake throws the moment a document contains `*emphasis*` in a family with no registered `italics`. When a real face is unavailable, alias it to `normal` (or `bold` for `bolditalics`) and add a warning. This single rule prevents the most common crash in the app.

### 7.1 Tier 1 — 12 built-in families (ship first)

| Category | Families |
|---|---|
| Sans | Inter, Source Sans 3, Lato, Work Sans |
| Serif | Source Serif 4, EB Garamond, Merriweather, Lora |
| Mono | JetBrains Mono, IBM Plex Mono |
| Display | Playfair Display, Bitter |

All OFL-1.1 or Apache-2.0. All have genuine bold and italic cuts — no synthesised faces.

**Ship static instances, not variable fonts.** pdfkit does not apply variation axes; a variable file renders as its default instance, so a "Bold" request silently produces Regular. Download the static cuts from each family's GitHub release or the `google/fonts` repository, not the variable file.

`static/fonts/manifest.json`:

```jsonc
{
  "inter": {
    "name": "Inter",
    "category": "sans",
    "license": "OFL-1.1",
    "files": {
      "normal": "inter/Regular.ttf", "bold": "inter/Bold.ttf",
      "italics": "inter/Italic.ttf", "bolditalics": "inter/BoldItalic.ttf"
    }
  }
}
```

Loading: `fetch(`${base}/fonts/${path}`)` → `ArrayBuffer` → cache in IndexedDB under `builtin:<id>:<face>`. Note `base` must come from SvelteKit's `$app/paths` `base` export, or every font 404s on GitHub Pages (§11).

### 7.2 Subsetting (one-time, manual)

Unsubsetted, 12 families × 4 faces is roughly 12 MB in the repository. Subset to Latin + Latin Extended-A and it lands near 3.5 MB.

Document the procedure in `scripts/subset-fonts.md`; run it once locally and **commit the outputs**. Do not add a Python dependency to CI for this.

```bash
pip install fonttools brotli
pyftsubset Inter-Regular.ttf \
  --unicodes="U+0000-00FF,U+0100-017F,U+2000-206F,U+20A0-20BF,U+2122,U+2190-2193,U+25A0-25FF,U+2610,U+2611" \
  --layout-features="kern,liga,clig" \
  --output-file=static/fonts/inter/Regular.ttf
```

The `U+2610`/`U+2611` range covers the task-list checkbox glyphs and `U+25A0-25FF` covers list bullets — omit them and those characters render as blank boxes. Verify after subsetting that `theme.list.bulletChars` and the task glyphs render.

### 7.3 Tier 2 — user uploads (ship second)

`src/lib/fonts/upload.ts`. Simplest tier, no network, works offline. Ship it before the Google tier.

1. `<input type="file" accept=".ttf,.otf" multiple>`, one input per face.
2. **Validate magic bytes**, not the file extension: `0x00010000` or `true` (TTF), `OTTO` (CFF/OTF). Reject `wOFF`/`wOF2` with a message pointing at the Google tier, or route them through §7.4's decoder.
3. Key by SHA-256 of the bytes (`crypto.subtle.digest`) so the same font uploaded twice stores once.
4. Store in IndexedDB store `uploads`.
5. If the user supplies only a regular face, alias the other three and warn.

### 7.4 Tier 3 — Google Fonts (ship third, label as experimental)

`src/lib/fonts/google.ts`.

**Verified facts** — these were checked against the live endpoints and can be relied on:

- `fonts.googleapis.com/css2` responds with `access-control-allow-origin: *`.
- `fonts.gstatic.com` responds with `access-control-allow-origin: *` for both `.woff2` and `.ttf`.
- `css2` varies its response on `User-Agent`. A browser UA yields `format('woff2')`; a legacy UA yields `format('truetype')`.

Because `fetch()` cannot override `User-Agent`, the browser always receives WOFF2. Therefore **`wawoff2` is the only path, not a fallback**:

```ts
const css = await fetch(
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,400;0,700;1,400;1,700`
).then(r => r.text());

// Parse @font-face blocks → Map<`${style}:${weight}`, url>
const woff2 = await fetch(url).then(r => r.arrayBuffer());
const { decompress } = await import('wawoff2');          // ~300 KB wasm, lazy
const ttf = await decompress(new Uint8Array(woff2));      // → OTF/TTF bytes
```

Handle these cases explicitly:

- **404 from `css2`** — family does not exist or the name is misspelled. Show the typo, not a stack trace.
- **Variable-font instances.** Request one weight at a time (`wght@700`, never a range `wght@400..700`) to maximise the chance of a static cut. **Verify per family** whether a pinned single weight actually returns a static instance — I have not confirmed that it always does. After decoding, check the font for an `fvar` table; if present, surface a visible warning in the theme editor that weights may render incorrectly. Do not fail silently.
- **Missing italics.** Many families have none. Apply the aliasing rule from §7.
- **Offline.** Cache the decoded TTF in IndexedDB under `google:<family>:<weight>:<style>` on first success, so the font keeps working offline afterwards. When a Google font cannot be resolved and is not cached, fall back to `slot.fallback` and show an explicit "font unavailable offline" state in the UI. Silently substituting Roboto in a typography tool is unacceptable output.

Label this tier "Google Fonts (online only, experimental)" in the UI.

### 7.5 Registration

`src/lib/fonts/register.ts` converts `ResolvedFont` into the two structures pdfmake needs:

```ts
export function buildVfs(fonts: ResolvedFont[]): {
  vfs: Record<string, string>;                    // filename → base64
  fonts: Record<string, Record<FaceKey, string>>; // family → face → filename
}
```

Pass both as the third and fourth arguments to `pdfMake.createPdf(docDef, layouts, fonts, vfs)`. **Do not mutate `pdfMake.vfs` / `pdfMake.fonts` globals** — the worker is long-lived and stale global state between renders causes fonts to bleed across theme switches.

Base64 conversion on multi-megabyte buffers: chunk it. `String.fromCharCode.apply(null, hugeArray)` blows the argument limit. Use 8 KB chunks in `src/lib/util/base64.ts`.

---

## 8. PDF generation worker

`src/lib/workers/pdf.worker.ts`.

```ts
// main → worker
interface RenderRequest {
  id: number;                            // monotonic generation token
  docDefinition: TDocumentDefinitions;
  vfs: Record<string, string>;
  fonts: Record<string, Record<FaceKey, string>>;
}

// worker → main
type RenderResponse =
  | { id: number; ok: true;  buffer: ArrayBuffer; pageCount: number }
  | { id: number; ok: false; error: string };
```

Transfer the `ArrayBuffer` (second argument to `postMessage`) rather than copying it.

**Verify early (phase 2, first task):** `pdfmake` must import and run inside a Web Worker. Some builds reference `window`. If `import pdfMake from 'pdfmake/build/pdfmake'` fails in the worker context, try `pdfmake/build/pdfmake.min.js`, and if that also fails, fall back to main-thread generation guarded by `requestIdleCallback` and record the limitation. Do not spend more than a short spike on this before falling back — the worker is a performance optimisation, not a correctness requirement.

Generation state machine in `src/lib/stores/pdf.svelte.ts`:

- Debounce input by **400 ms**.
- Each request carries an incrementing `id`. Responses with `id < latestId` are **discarded**. Without this, a fast typist queues a backlog of stale PDFs and the preview lags seconds behind the editor.
- States: `idle | generating | ready | error`. The previous `ArrayBuffer` is retained across `generating` so the preview never blanks.

---

## 9. Preview

`src/lib/preview/renderer.ts`, using `pdfjs-dist`.

```ts
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
```

Requirements, in priority order:

1. **Preserve scroll position and page index across re-renders.** The naive implementation snaps to page 1 on every keystroke and makes the app unusable. `scrollAnchor.ts` records `scrollTop` as a fraction of `scrollHeight` before swapping and restores it after.
2. **No flicker.** Render the new pages into offscreen canvases, then swap. Never clear the container before the new render resolves.
3. Render at `devicePixelRatio * zoom` scale, capped at 3× to bound memory.
4. Virtualise beyond 20 pages: render pages within ±2 of the viewport, placeholder the rest at correct dimensions so scroll height stays stable.
5. `pdfDoc.destroy()` on every swap. Leaking pdf.js documents on each keystroke exhausts memory within minutes.

The Download button calls `new Blob([buffer], { type: 'application/pdf' })` on the **same buffer already in the store**. It never triggers a regeneration.

---

## 10. Persistence

| Key | Store | Contents |
|---|---|---|
| `md2pdf:doc` | localStorage | Markdown source, debounced 1 s |
| `md2pdf:meta` | localStorage | `DocMeta` overrides |
| `md2pdf:theme` | localStorage | Active theme JSON |
| `md2pdf:recentThemes` | localStorage | Last 10 themes, LRU |
| `fonts` | IndexedDB `md2pdf` | `builtin:*`, `google:*` → `ArrayBuffer` |
| `uploads` | IndexedDB `md2pdf` | `<sha256>` → `{ bytes, family, face }` |
| `assets` | IndexedDB `md2pdf` | background / cover images over 256 KB |

localStorage caps at ~5 MB. Keep binaries out of it — background images above 256 KB go to IndexedDB with the theme holding a reference key, and are inlined only at export time.

---

## 11. Deployment

`svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter({ fallback: '404.html', strict: false }),
    paths: { base: process.env.BASE_PATH ?? '' },
    appDir: 'internal'   // avoids the leading-underscore _app dir that Jekyll ignores
  }
};
```

`src/routes/+layout.ts`:

```ts
export const prerender = true;
export const ssr = false;      // pdfmake, pdf.js and IndexedDB are browser-only
```

- Commit `static/.nojekyll`.
- **Every runtime asset URL must be prefixed with `base` from `$app/paths`.** Font fetches, the PWA manifest, and preset theme JSON all break on a project-site path (`/<repo>/`) otherwise. This is the single most common GitHub Pages failure for this kind of app.

`.github/workflows/deploy.yml`:

```yaml
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
        env:
          BASE_PATH: /${{ github.event.repository.name }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: build }
  deploy:
    needs: build
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    runs-on: ubuntu-latest
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

PWA (`vite-plugin-pwa`, `registerType: 'autoUpdate'`): precache the app shell and **only the default font family**. Lazy-fetch the other eleven — precaching 3.5 MB of fonts makes first load hostile. Google-tier fonts are `NetworkFirst` with an IndexedDB-backed fallback.

Lazy-load the PDF engine: `const { generate } = await import('$lib/pdf/engine')`. pdfmake plus pdf.js is a large chunk and must not block first paint.

---

## 12. Special features — concrete mechanics

### 12.1 Cover page

pdfmake has no per-page master. The working technique is to draw the cover in the `background` callback using `absolutePosition`, and make content page 1 an empty spacer.

`src/lib/pdf/cover.ts`:

```ts
background: (currentPage: number, pageSize: PageSize) =>
  currentPage === 1 && t.cover.enabled
    ? buildCover(t, pageSize, meta)
    : buildPageBackground(t, pageSize),

header: (currentPage) => headerFor(currentPage, t, meta),
footer: (currentPage, pageCount) => footerFor(currentPage, pageCount, t, meta),

content: [
  ...(t.cover.enabled ? [{ text: '', pageBreak: 'after' as const }] : []),
  ...renderTokens(tokens, t, images)
]
```

Why the background callback rather than normal content flow: it receives `pageSize`, which is the only way to vertically centre a title block. pdfmake's content flow has no vertical alignment. A `cover.blocks[].y` of `"38%"` becomes `y = pageSize.height * 0.38`.

**Page numbering offset.** When `cover.excludeFromPageCount` is true:

```ts
const offset = t.cover.enabled && t.cover.excludeFromPageCount ? 1 : 0;
// {{page}}  → currentPage - offset
// {{pages}} → pageCount - offset
// suppress header/footer entirely when currentPage <= offset
```

Getting this wrong — footer reading "1 / 5" on the cover, or "2 / 5" on the first real page — is the classic bug here. Cover it with a unit test.

### 12.2 Watermark

`src/lib/pdf/watermark.ts`, emitted from the same `background` callback:

```ts
{
  text: t.watermark.text,
  fontSize: t.watermark.size,
  color: t.watermark.color,
  opacity: t.watermark.opacity,
  bold: true,
  angle: t.watermark.angle,
  absolutePosition: { x: 0, y: pageSize.height / 2 },
  alignment: 'center',
  width: pageSize.width
}
```

pdfmake supports `opacity` on both text and vector nodes. Background image, watermark, and cover composite in that order — background image first (bottom), watermark last (top).

### 12.3 Header / footer templates

`src/lib/pdf/headerFooter.ts`. A deliberately small template engine — substitute a fixed whitelist, nothing more:

| Token | Value |
|---|---|
| `{{page}}` | current page, cover-adjusted |
| `{{pages}}` | total pages, cover-adjusted |
| `{{title}}` | `meta.title` |
| `{{subtitle}}` | `meta.subtitle` |
| `{{author}}` | `meta.author` |
| `{{date}}` | `meta.date` formatted with `Intl.DateTimeFormat(theme.locale)` |

Unknown `{{…}}` tokens render literally and collect a warning. Do not implement expressions, conditionals, or arbitrary property access.

Positioning: a header/footer node's `margin` is relative to the page edge, so `offset` maps to `margin: [ml, offset, mr, 0]`. Validate on import that `header.offset < page.margins[1]` and `footer.offset < page.margins[3]`, otherwise the running text collides with body content.

Optional rule line: a `canvas` line node below the header text / above the footer text, spanning the content width.

### 12.4 Font licence attribution

Committing the 12 families to a public repository means committing each family's `OFL.txt` or `LICENSE.txt` alongside it under `static/fonts/<id>/`. `src/routes/licenses/+page.svelte` lists every bundled family with its licence and upstream URL, linked from the footer. Cheap now, tedious to retrofit.

---

## 13. Implementation phases

Each phase must be independently runnable and independently reviewable. Do not start a phase before the previous one's acceptance criteria pass.

### Phase 1 — Vertical slice
Scope: `<textarea>` → `markdown-it` → `buildDocDefinition` with `DEFAULT_THEME` hardcoded → pdfmake on the **main thread**, Roboto only → preview in an `<iframe>` with a blob URL → Download button.

Prove the whole loop end-to-end before adding anything.

- [ ] Headings, paragraphs, bold/italic, lists, links, `hr`, code blocks and tables all render
- [ ] Downloaded PDF opens in Acrobat and Chrome; text is selectable and searchable
- [ ] `npm run build` produces a working static site

### Phase 2 — Worker + real preview
Scope: move generation to `pdf.worker.ts`; replace the iframe with pdf.js canvas rendering; generation token discipline; scroll preservation.

**Do this before anything else is built on top.** Retrofitting the worker boundary later means rewriting the whole render path.

- [ ] Worker spike resolved (worker works, or documented fallback to main thread per §8)
- [ ] Typing continuously for 30 s in a 20-page document never blocks input
- [ ] Scroll position is preserved across re-renders; no flicker; no page-1 snap
- [ ] Stale responses are discarded (assert via injected 2 s delay)
- [ ] No memory growth over 100 consecutive renders (`pdfDoc.destroy()` verified)

### Phase 3 — Built-in fonts
Scope: subset and commit the 12 families; `manifest.json`; `resolve` / `register` / IndexedDB cache; font pickers for the three slots.

- [ ] All 12 families render in all 4 faces
- [ ] `*emphasis*` in every family generates without throwing
- [ ] Second load fetches zero font bytes from network (IndexedDB hit)
- [ ] Bullets and task checkboxes render (subsetting kept the needed codepoints)
- [ ] `base` path prefix applied; fonts load from a project-site URL

### Phase 4 — Theme system
Scope: full Zod schema; `DEFAULT_THEME`; the migration harness (empty but present); import/export; deep-merge-over-defaults; localStorage persistence; the theme editor UI.

- [ ] Every field in §5.1 is reachable from the UI and changes the PDF
- [ ] Importing `{}` yields `DEFAULT_THEME` plus warnings, and does not crash
- [ ] Importing a theme with an unknown extra field succeeds with a warning
- [ ] Round-trip export → import is byte-identical
- [ ] Malformed JSON produces a readable error, never an unhandled rejection

### Phase 5 — Cover, watermark, header/footer, page breaks
Scope: §12 in full; the `pagebreak` markdown-it rule; `pageBreakBefore` orphan control; per-element `margin` / `breakBefore` / `keepWithNext`.

- [ ] Cover renders with its own background and no header/footer
- [ ] `{{page}}`/`{{pages}}` are correct with `excludeFromPageCount` both true and false
- [ ] The page-break marker inside a fenced code block renders as literal text
- [ ] Changing `theme.pagebreak.marker` re-parses the document
- [ ] A heading with `keepWithNext` never lands last on a page
- [ ] Watermark appears on every content page at the configured angle and opacity

### Phase 6 — Font upload
Scope: §7.3. No network, so it works offline; ship it before the Google tier.

- [ ] Magic-byte validation rejects a renamed `.woff2` with a clear message
- [ ] Uploading only a regular face produces a working document with a warning
- [ ] Uploaded fonts survive a reload
- [ ] `.mdtheme` ZIP export/import round-trips an uploaded font

### Phase 7 — Google Fonts
Scope: §7.4, labelled experimental.

- [ ] A valid family resolves, decodes and renders
- [ ] A misspelled family shows a useful error, not a stack trace
- [ ] A variable-font family surfaces the `fvar` warning
- [ ] A previously used family still renders with the network disabled
- [ ] An unresolvable family falls back to `slot.fallback` with a visible notice

### Phase 8 — Polish
PWA install and offline; preset theme gallery; CodeMirror 6 editor; code-block syntax highlighting (`highlight.js` tokens → styled runs, driven by `theme.code.tokenColors`); document metadata panel; keyboard shortcuts; licences page.

---

## 14. Testing

**Unit (Vitest)** — the pure functions carry the risk:
- `theme/migrate.ts` — every migration path, including missing and future `version`
- `theme/io.ts` — partial, malformed, oversized, and hostile input
- `markdown/pagebreak.ts` — marker inside fences, blockquotes, lists; marker collision validation
- `pdf/headerFooter.ts` — template substitution, cover offsets, unknown tokens
- `pdf/inline.ts` — nested formatting composition
- `fonts/resolve.ts` — face aliasing when italics are missing

**Golden-file tests** — render a fixture document under three themes, extract text and page count with `pdfjs-dist` in Node, and assert against committed expectations. Assert **structure** (page count, text content, page-break positions), not pixels — pixel comparison will be flaky across pdfkit versions.

**E2E (Playwright)** — type Markdown, wait for the preview, click Download, intercept the blob, parse it with pdf.js, assert page count and that a known string appears on the expected page.

**Fixture corpus** in `tests/fixtures/`: a kitchen-sink document, a 60-page stress document, a document with broken/remote/data-URI images, a document with a marker inside a fence, and a document using every heading level.

---

## 15. Known pitfalls

Ranked by how much time they will cost if missed.

1. **`base` path on GitHub Pages.** Any asset URL not prefixed with `base` from `$app/paths` 404s on a project site. Fonts, manifest, presets.
2. **Missing font faces.** Always register all four; alias when a real face is absent. Otherwise the first `*emphasis*` crashes generation.
3. **Preview scroll reset.** Snapping to page 1 on every keystroke makes the app unusable regardless of how good the output is.
4. **Stale render responses.** Without generation tokens, a fast typist sees a preview seconds behind the editor.
5. **Cover page numbering off-by-one.** Test both `excludeFromPageCount` values.
6. **Images without explicit width.** pdfmake does not auto-scale; images overflow and clip silently.
7. **Variable fonts.** Render as the default instance, so "Bold" silently produces Regular. Detect `fvar` and warn.
8. **pdf.js document leaks.** `destroy()` on every swap, or memory exhausts within minutes of typing.
9. **Base64 chunking.** `String.fromCharCode.apply` on a multi-MB array exceeds the argument limit.
10. **localStorage quota.** Binaries belong in IndexedDB; a large background image inlined into the theme will silently fail to persist.
11. **Subsetting dropped glyphs.** Bullets and checkbox characters vanish if their codepoints were not included.
12. **`html: false`.** Do not relax it "temporarily". The PDF renderer cannot consume HTML.

---

## 16. Open items to resolve during implementation

These are genuinely unknown and must be settled by testing, not assumption:

1. **Does `pdfmake` run cleanly in a Web Worker under Vite?** Spike in phase 2. Fallback documented in §8.
2. **Does `css2` with a single pinned weight always return a static instance?** Unconfirmed. Determines how loud the phase-7 variable-font warning needs to be.
3. **`wawoff2` output format** — confirm whether decompressed output is always TTF-compatible for pdfkit, or whether CFF/OTF output needs separate handling.
4. **pdfmake `opacity` on text nodes** — confirmed supported on vector nodes; verify on text before relying on it for the watermark. If unsupported, render the watermark as a vector path or a pre-rendered translucent PNG.
5. **Large-document ceiling** — measure generation time at 50, 100 and 200 pages and set a documented soft limit with a UI warning.

---

## 17. Definition of done for v1

- Themes fully control page geometry, all three font slots, every element's typography and margins, background colour and image, watermark, cover page, running header and footer, and page-break behaviour.
- Themes export to and import from JSON, survive a schema-version bump, and degrade gracefully when malformed.
- Preview is byte-identical to the download because they are the same buffer.
- Twelve built-in families work offline; uploads work offline; Google Fonts work online and offline-after-first-use.
- The whole app is served from GitHub Pages with no backend, and installs as a PWA.