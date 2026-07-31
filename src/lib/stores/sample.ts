export const SAMPLE_DOCUMENT = `---
title: md2pdf
subtitle: Markdown in, themeable PDF out
author: You
---

# md2pdf

Everything you see on the right is the **same PDF bytes** the Download button
hands you. There is no second renderer, so there is nothing to drift.

## What the theme controls

Open the theme panel and every field below changes the output:

- Page geometry, margins and orientation
- Three font slots — body, heading and *monospace*
- Per-element size, colour, spacing and page-break behaviour
- Background colour or image, watermark, cover page
- Running header and footer, with \`{{page}} / {{pages}}\` templates
- A contents page and numbered headings, both off by default

Headings always become PDF bookmarks — open the sidebar in any PDF reader.
Links between them work too: [jump to page two](#page-two), and Obsidian's own
[[#Page two]] does the same.

### Text

Inline formatting composes: **bold**, *italic*, ***both at once***,
~~struck through~~, \`inline code\`, and [links](https://example.com).

1. Ordered lists
2. Nested lists
   - and their own bullet characters
   - one per depth
3. Task lists:

- [x] Preview is byte-identical to the download
- [ ] Anything you have not themed yet

> Blockquotes get a coloured bar whose width, colour and indent are all
> theme fields.

### Code

\`\`\`ts
export function pageOffset(t: Theme): number {
  return t.cover.enabled && t.cover.excludeFromPageCount ? 1 : 0;
}
\`\`\`

### Tables

| Feature | Themeable | Notes |
|---|:---:|---|
| Page size | yes | A3 through Tabloid |
| Watermark | yes | angle, opacity, size |
| Fonts | yes | built-in, uploaded, or Google |

---

Put \`\\pagebreak\` on a line of its own to force a page break. The marker is a
theme field, and it stays literal inside a fenced code block.

\\pagebreak

## Page two

Which is where the footer template starts earning its keep.
`;
