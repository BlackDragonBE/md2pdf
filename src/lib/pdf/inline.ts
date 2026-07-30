import type Token from 'markdown-it/lib/token.mjs';
import type { Theme } from '../theme/schema';
import { splitEmojiRuns } from './emoji';
import type { ResolvedImage } from './images';
import type { ImageNode, TextRun } from './pdfmake-types';
import type { FontMap } from './styles';

export interface InlineContext {
	theme: Theme;
	fonts: FontMap;
	warnings: Set<string>;
	images: Map<string, ResolvedImage>;
	/** Content column width in pt, for sizing inline images. */
	contentWidth: number;
}

export type InlineContent = TextRun | ImageNode;

/** markdown-it Tokens survive structuredClone as plain objects; read attrs directly. */
export function attrGet(token: Token | { attrs?: [string, string][] | null }, name: string): string | null {
	const attrs = token.attrs;
	if (!attrs) return null;
	for (const [k, v] of attrs) if (k === name) return v;
	return null;
}

interface Format {
	bold: boolean;
	italics: boolean;
	strike: boolean;
	mark: boolean;
	link: string | null;
}

const BASE: Format = { bold: false, italics: false, strike: false, mark: false, link: null };

const CHECKBOX = /^<input\b[^>]*type=["']?checkbox/i;

/**
 * Flatten an inline token's children into pdfmake runs.
 *
 * Formatting is a stack of active flags, not a set of special cases, so
 * `**bold *and italic***` yields a single run carrying both (§6.4).
 */
export function renderInline(
	children: Token[] | null | undefined,
	style: string,
	ctx: InlineContext
): InlineContent[] {
	const out: InlineContent[] = [];
	const stack: Format[] = [{ ...BASE }];
	const top = () => stack[stack.length - 1];

	const push = (text: string, extra: Partial<TextRun> = {}) => {
		if (text === '') return;
		const f = top();
		const run: TextRun = { text, style, ...extra };
		if (f.bold) run.bold = true;
		if (f.italics) run.italics = true;
		if (f.strike) run.decoration = 'lineThrough';
		if (f.mark) {
			const h = ctx.theme.obsidian.highlight;
			run.background = h.background;
			if (h.color) run.color = h.color;
			if (h.bold) run.bold = true;
		}
		// A highlighted link keeps the link colour, as it does in Obsidian.
		if (f.link !== null) {
			run.link = f.link;
			run.color = ctx.theme.link.color;
			if (ctx.theme.link.underline) run.decoration = 'underline';
		}
		out.push(run);
	};

	const open = (patch: Partial<Format>) => stack.push({ ...top(), ...patch });
	const close = () => {
		if (stack.length > 1) stack.pop();
	};

	for (const tok of children ?? []) {
		switch (tok.type) {
			case 'text':
				push(tok.content);
				break;
			case 'strong_open':
				open({ bold: true });
				break;
			case 'em_open':
				open({ italics: true });
				break;
			case 's_open':
				open({ strike: true });
				break;
			case 'mark_open':
				open({ mark: true });
				break;
			case 'strong_close':
			case 'em_close':
			case 's_close':
			case 'mark_close':
			case 'link_close':
				close();
				break;
			case 'link_open':
				open({ link: attrGet(tok, 'href') ?? '' });
				break;
			case 'code_inline':
				push(tok.content, {
					style: 'inlineCode',
					background: ctx.theme.code.background
				});
				break;
			case 'softbreak':
				push(' '); // breaks: false (§6.4)
				break;
			case 'hardbreak':
				push('\n');
				break;
			case 'image': {
				const node = inlineImage(tok, ctx);
				if (node) out.push(node);
				else push(imageAltText(tok));
				break;
			}
			case 'html_inline': {
				const box = checkboxGlyph(tok.content, ctx.theme);
				if (box !== null) push(box);
				else ctx.warnings.add('Inline HTML was dropped — the PDF renderer has no HTML support.');
				break;
			}
			case 'wikilink': {
				const link = wikilinkRun(tok, ctx);
				if (link) push(link.text, link.extra);
				break;
			}
			case 'obsidian_comment': {
				const c = ctx.theme.obsidian.comments;
				if (c.show) push(tok.content, { color: c.color, italics: c.italics });
				break;
			}
			case 'block_id':
				break; // A vault-internal anchor; nothing to show in a PDF.
			case 'footnote_ref': {
				const id = (tok.meta as { id?: number } | undefined)?.id ?? 0;
				push(String(id + 1), { sup: true, color: ctx.theme.obsidian.footnotes.refColor });
				break;
			}
			default:
				// Unknown inline token with literal content still carries text.
				if (tok.content) push(tok.content);
		}
	}

	// Last, so every branch above is covered by one call: emoji need their own
	// family, and pdfmake binds a font per run (§ pdf/emoji.ts).
	return splitEmojiContent(out, ctx.fonts.emoji);
}

/** `splitEmojiRuns` over a list that may also hold image nodes. */
function splitEmojiContent(content: InlineContent[], font: string | undefined): InlineContent[] {
	if (!font) return content;
	const out: InlineContent[] = [];
	for (const item of content) {
		if ('text' in item) out.push(...splitEmojiRuns([item], font));
		else out.push(item);
	}
	return out;
}

/**
 * A wikilink points into a vault that a standalone PDF has no access to, so it
 * renders as styled text, never a hyperlink. `[[Note#Heading]]` without an
 * alias reads as `Note > Heading`, the way Obsidian shows it.
 */
function wikilinkRun(
	tok: Token,
	ctx: InlineContext
): { text: string; extra: Partial<TextRun> } | null {
	const o = ctx.theme.obsidian;
	const embed = attrGet(tok, 'embed') === '1';
	if (embed && !o.embeds.show) return null;

	const alias = attrGet(tok, 'alias') ?? '';
	const target = attrGet(tok, 'target') ?? '';
	const section = attrGet(tok, 'section') ?? '';

	let text = alias || (target && section ? `${target} > ${section}` : target || section);
	if (!text) return null;
	if (o.wikilinks.showBrackets) text = `${embed ? '!' : ''}[[${text}]]`;

	const extra: Partial<TextRun> = { color: o.wikilinks.color };
	if (o.wikilinks.italics || (embed && o.embeds.italics)) extra.italics = true;
	if (o.wikilinks.underline) extra.decoration = 'underline';
	return { text, extra };
}

/** markdown-it-task-lists injects the checkbox as html_inline; swap in the theme glyph. */
function checkboxGlyph(html: string, t: Theme): string | null {
	if (!CHECKBOX.test(html)) return null;
	return /\bchecked\b/i.test(html) ? t.list.taskChecked : t.list.taskUnchecked;
}

export function imageAltText(tok: Token): string {
	const alt = tok.children?.map((c) => c.content).join('') ?? '';
	return alt || attrGet(tok, 'alt') || '[image]';
}

function inlineImage(tok: Token, ctx: InlineContext): ImageNode | null {
	const src = attrGet(tok, 'src');
	if (!src) return null;
	const resolved = ctx.images.get(src);
	if (!resolved || resolved.kind === 'failed') return null;
	const width = Math.min(
		resolved.width * 0.75,
		ctx.contentWidth * ctx.theme.image.maxWidth
	);
	return { image: resolved.dataUri, width };
}

/** Collapse adjacent runs that share identical formatting. Purely cosmetic for output size. */
export function coalesce(runs: InlineContent[]): InlineContent[] {
	const out: InlineContent[] = [];
	for (const run of runs) {
		const prev = out[out.length - 1];
		if (
			prev &&
			'text' in prev &&
			'text' in run &&
			sameFormat(prev as TextRun, run as TextRun)
		) {
			(prev as TextRun).text += (run as TextRun).text;
			continue;
		}
		out.push(run);
	}
	return out;
}

function sameFormat(a: TextRun, b: TextRun): boolean {
	return (
		a.style === b.style &&
		a.bold === b.bold &&
		a.italics === b.italics &&
		a.decoration === b.decoration &&
		a.link === b.link &&
		a.color === b.color &&
		a.background === b.background &&
		a.sup === b.sup &&
		// Load-bearing: emoji runs differ from their neighbours *only* by font,
		// so without this they coalesce straight back into the text family.
		a.font === b.font
	);
}
