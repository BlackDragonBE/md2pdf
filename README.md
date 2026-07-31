# md2pdf

Markdown in, deeply themeable PDF out — entirely in your browser.

**→ [blackdragonbe.github.io/md2pdf](https://blackdragonbe.github.io/md2pdf/)**

Nothing is uploaded anywhere. There is no server, no account and no sign-up: the
whole thing is a static page, and your document never leaves your machine. Your
work is saved in the browser, so closing the tab does not lose it.

## Features

- **Live preview** of the real PDF, side by side with the editor. The preview and
  the download are the same file — what you see is exactly what you get.
- **Built for long documents.** Every heading becomes a PDF bookmark, so readers
  get a navigable sidebar. Optional contents page with real page numbers,
  optional `1.2.3` heading numbering, and `[text](#heading)` links that jump
  within the PDF.
- **Deep theming.** Page size and margins, three font slots, per-element
  typography, colours and spacing, background colour or image, watermark, cover
  page, running header and footer, and page-break rules.
- **Twelve bundled fonts**, or upload your own TTF/OTF, or pull a family from
  Google Fonts. Emoji render in colour, as vector artwork.
- **Portable themes.** Export as JSON and share it; hand-editing is fine.
  Five presets ship in the box.
- **Two-way scroll sync** that follows the actual content, not a percentage.
- **Works offline.** Installable as a PWA; after the first visit it needs no
  network at all.
- Front matter, tables, task lists, syntax-highlighted code fences, pasted
  images, mid-sentence images, and manual page breaks.
- **Open and save Markdown files.** Drop a `.md` anywhere on the page, or use
  Open; Save .md hands the source back.
- **Obsidian Flavored Markdown** — callouts, wikilinks, embeds, highlights,
  footnotes, comments and block identifiers, each themeable and each
  individually switchable off.

## Getting started

Open the [hosted app](https://blackdragonbe.github.io/md2pdf/) and start typing —
there is nothing to install. Your browser will offer to install it as an app,
which makes it available offline and in its own window.

To run it locally instead:

```bash
npm install
npm run dev
```

## Using it

**The panes.** Editor on the left, live PDF on the right, theme panel on the
far right. Drag the divider to resize, or hide the editor entirely to give the
PDF the whole window. Everything you adjust persists.

**Preview.** Opens at a zoom that fits the page to the pane; **Fit** returns to
that after you have zoomed. Click the preview and the arrow keys, Page Up/Down,
Home and End scroll it. Your scroll position survives edits and zoom changes, so
typing never throws you back to page one.

**Scroll sync** keeps both panes on the same content in both directions. It
tracks where each block actually landed in the PDF, so it stays honest across
page breaks and long code blocks. Toggle it off if you would rather scroll each
pane independently.

**Long documents.** Headings always become PDF bookmarks — open the outline
sidebar in any reader and the whole document is a tree. Two more switches live
under **Contents and numbering** in the theme panel:

| Setting           | What it does                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Number headings   | `1`, `1.2`, `1.2.3` in front of each heading, from its level. The same numbers appear in the contents page and the bookmarks                                                                                     |
| Table of contents | A contents page built from the headings, listing the page each one starts on. Depth, indent, spacing and the page break after it are all themeable, and the two `Contents …` entries under Elements set its type |

A document that starts at `##` numbers from 1 rather than `0.1`, and its
bookmarks nest from the levels it actually uses.

`[text](#some-heading)` jumps to that heading inside the PDF. Anchors resolve
both the GitHub way (lowercased, punctuation dropped, spaces hyphenated,
repeats suffixed `-1`) and the Obsidian way (the heading text itself, ignoring
case and spacing), so `[x](#my-heading)` and `[[#My Heading]]` both land. An
anchor no heading matches renders as plain styled text rather than a dead
external link.

Obsidian's own forms work too: `[[#Heading]]` and `[[#^block-id]]` are real
jumps, since they name somewhere in _this_ document. `[[Other#Heading]]` names
a note that is not in the PDF, so it stays inert — pointing it at a same-named
heading here would send the reader somewhere the document never said.

**Opening and saving.** Drop a `.md` file anywhere on the page, or press
**Open**. It replaces the current document — you get one confirmation, because
there is no undo across a whole replacement — and the file name becomes the
document title unless front matter or the metadata panel says otherwise.
**Save .md** hands back the source; **Download PDF** hands back the PDF.

**Images.** Paste an image into the editor and it is embedded directly in the
document. This is the way to include local images — a page with no server cannot
read files off your disk by relative path. Pasted images are capped at 2 MB.

**Obsidian syntax.** Notes written in Obsidian print as they read:

| Syntax                                            | In the PDF                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `> [!warning] Title`                              | A callout — coloured bar, tinted panel, styled title. Aliases such as `tldr` or `caution` work, and `[!note]-` marks it collapsed |
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]` | Styled text. A standalone PDF has no vault to link into, so it is not a hyperlink                                                 |
| `[[#Heading]]`, `[[#^block-id]]`                  | A real jump to that place in this PDF — no vault needed. Case and spacing do not matter, and an alias still sets the text         |
| `![[Note]]`                                       | A reference to the target, italic by default, or hidden                                                                           |
| `==text==`                                        | Highlighted                                                                                                                       |
| `[^1]` plus `[^1]: note`                          | A superscript marker and a numbered notes section at the end                                                                      |
| `#tag`, `#parent/child`                           | Coloured, optionally on a tinted background. A numeric `#1234` stays literal, so issue references survive                         |
| `%%text%%`                                        | Left out, inline or across several lines. Optionally printed, for review copies                                                   |
| `^my-id`                                          | Stripped, but remembered — `[[#^my-id]]` jumps to the block it marked                                                             |

Each of these is a switch in the theme panel. Turn one off and that syntax stays
in the PDF as literal text — useful if your document means something else by
`[[`, `%%`, `#` or `^id`. Callout colours are per type, and every one takes an
optional icon character.

Math (`$…$`) is not supported.

**Themes.** Every visual choice lives in the theme, and themes are portable
JSON — export one, edit it in a text editor, send it to someone else. A partial
or hand-edited file still works: anything it does not specify falls back to the
defaults. A theme carrying an uploaded font or a large image exports as a
`.mdtheme` ZIP instead.

**Fonts.** The twelve bundled families are fetched only when you pick them and
then cached, so a second visit downloads nothing. You can also upload a TTF or
OTF, or fetch a family from Google Fonts — that last one needs a connection the
first time and is marked experimental.

**Emoji** work anywhere text does — headings, tables, callouts, code fences,
the header and footer — and they are in **colour**. PDF has no colour-font
concept, so they are drawn as vector artwork (Twemoji) rather than glyphs,
which also means they stay sharp at any zoom or print size. The set is fetched
the first time you use an emoji and cached, so a document without any downloads
nothing extra. Sequences behave: family emoji, skin tones, flags and keycaps
each render as one picture. Offline before the set has ever loaded, emoji fall
back to a bundled monochrome font rather than disappearing.

**Mid-sentence images.** `![alt](…)` works inside a paragraph, flowing and
wrapping with the text around it, not just on a line of its own.

**Metadata.** Title, subtitle, author and date come from YAML front matter if the
document has any, and can be filled in from the metadata panel otherwise. They
feed the cover page, the header and footer, and the download filename.

**Appearance** follows light, dark, or your system setting. That is the app's own
chrome — the PDF looks however its theme says.

### Keyboard

| Shortcut            | Action                                       |
| ------------------- | -------------------------------------------- |
| `Ctrl/Cmd+S`        | Download the PDF                             |
| `Ctrl/Cmd+Shift+B`  | Toggle the theme panel                       |
| `Ctrl/Cmd+Shift+E`  | Collapse the editor                          |
| `Tab` / `Shift+Tab` | Indent / outdent, without leaving the editor |

On narrow windows the theme panel becomes an overlay, and below 720px the editor
and preview stack vertically.

## How it works

```
Editor ──┐
         ├─► debounce ─► fonts (cached) ─► Web Worker ─► PDF bytes ─┬─► preview
Theme  ──┘                                                          └─► download
```

Markdown is parsed, the theme is applied, and a Web Worker generates the PDF with
[pdfmake](https://pdfmake.github.io/) — off the main thread, so typing stays
responsive. Those exact bytes are what the preview renders (via
[pdf.js](https://mozilla.github.io/pdf.js/)) and what the Download button hands
you; there is no second render path for the two to disagree about. If the worker
cannot start, generation falls back to the main thread and the app says so.

Documents beyond ~300 pages still generate correctly, but the preview gets slow
and memory-hungry, and the app will warn you. The download is unaffected.

## Contributing

- [CLAUDE.md](CLAUDE.md) — architecture, commands, and the invariants to know
  before changing anything.
- [docs/verification.md](docs/verification.md) — the experiments behind the
  decisions the spec declined to guess at.

## Licence

Application code: MIT. The bundled fonts keep their own licences (all OFL-1.1) —
each is committed beside its family and listed on the app's About page.

Colour emoji artwork is [Twemoji](https://github.com/jdecked/twemoji), licensed
**CC-BY 4.0** by Twitter and the Twemoji contributors.
