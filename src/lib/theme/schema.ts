import { z } from 'zod';

export const THEME_VERSION = 2;

const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const Margin = z.tuple([z.number(), z.number(), z.number(), z.number()]); // [l, t, r, b] in pt

const FontSource = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('builtin'), id: z.string() }),
	z.object({ kind: z.literal('upload'), hash: z.string(), family: z.string() }),
	z.object({
		kind: z.literal('google'),
		family: z.string(),
		weights: z.array(z.number()).default([400, 700])
	})
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

const Rule = z.object({
	enabled: z.boolean().default(false),
	color: Hex.default('#dddddd'),
	width: z.number().default(0.5)
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
		body: FontSlot,
		heading: FontSlot,
		mono: FontSlot
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
		blocks: z
			.array(
				z.object({
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
				})
			)
			.default([]),
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
		rule: Rule
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
		rule: Rule
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

	/**
	 * Obsidian Flavored Markdown. Each `enabled` flag gates *parsing*: with it
	 * off the syntax stays literal text, which matters for a document that uses
	 * `[[`, `%%` or `^id` to mean something else.
	 */
	obsidian: z.object({
		callouts: z.object({
			enabled: z.boolean().default(true),
			barWidth: z.number().min(0).max(20).default(3),
			padding: Margin.default([10, 8, 10, 8]),
			margin: Margin.default([0, 4, 0, 10]),
			/** `> [!note]-` is collapsed in Obsidian; a PDF cannot expand it. */
			showCollapsedBody: z.boolean().default(true),
			/** Keyed by canonical callout type — see CALLOUT_TYPES. */
			types: z
				.record(
					z.string(),
					z.object({
						color: Hex,
						background: Hex,
						/** Drawn before the title. Any character the font has; empty for none. */
						icon: z.string().max(4).default('')
					})
				)
				.default({})
		}),
		wikilinks: z.object({
			enabled: z.boolean().default(true),
			color: Hex.default('#7048c8'),
			underline: z.boolean().default(false),
			italics: z.boolean().default(false),
			/** Keep the `[[ ]]` brackets in the output. */
			showBrackets: z.boolean().default(false)
		}),
		embeds: z.object({
			/** There is no vault to embed from, so `![[…]]` renders as a reference. */
			show: z.boolean().default(true),
			italics: z.boolean().default(true)
		}),
		highlight: z.object({
			enabled: z.boolean().default(true),
			background: Hex.default('#fff3a3'),
			/** null keeps the surrounding text colour. */
			color: Hex.nullable().default(null),
			bold: z.boolean().default(false)
		}),
		footnotes: z.object({
			enabled: z.boolean().default(true),
			/** Heading above the notes section. Empty for none. */
			heading: z.string().max(80).default('Notes'),
			refColor: Hex.default('#0366d6'),
			breakBefore: z.boolean().default(false),
			rule: Rule
		}),
		comments: z.object({
			enabled: z.boolean().default(true),
			/** Off by default: a comment is meant to stay out of the PDF. */
			show: z.boolean().default(false),
			color: Hex.default('#8a8a8a'),
			italics: z.boolean().default(true)
		}),
		blockIds: z.object({
			/** `^id` at the end of a block is stripped; off leaves it literal. */
			enabled: z.boolean().default(true)
		})
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
		h1: ElementStyle,
		h2: ElementStyle,
		h3: ElementStyle,
		h4: ElementStyle,
		h5: ElementStyle,
		h6: ElementStyle,
		paragraph: ElementStyle,
		codeBlock: ElementStyle,
		inlineCode: ElementStyle,
		blockquote: ElementStyle,
		listItem: ElementStyle,
		tableCell: ElementStyle,
		tableHeader: ElementStyle,
		calloutTitle: ElementStyle,
		footnote: ElementStyle
	}),

	locale: z.string().default('en-US')
});

export type Theme = z.infer<typeof ThemeSchema>;
export type ElementStyleT = z.infer<typeof ElementStyle>;
export type FontSourceT = z.infer<typeof FontSource>;
export type FontSlotT = z.infer<typeof FontSlot>;
export type ImageSpecT = z.infer<typeof ImageSpec>;
export type CoverBlockT = Theme['cover']['blocks'][number];
export type FontRole = ElementStyleT['font'];
export type ElementKey = keyof Theme['elements'];

/**
 * A page-break marker that also parses as real Markdown would be swallowed by
 * markdown-it before our block rule ever sees it. Rejected on import (§6.3).
 */
export const MARKER_COLLISION = /^(#{1,6}\s|>|[-*_]{3,}$|\d+\.\s|[-*+]\s|```|~~~)/;
