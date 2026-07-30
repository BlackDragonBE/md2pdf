import type Token from 'markdown-it/lib/token.mjs';
import type { ElementKey, Theme } from '../theme/schema';
import { splitEmojiRuns } from './emoji';
import { highlightRuns } from './highlight';
import type { ResolvedImage } from './images';
import { drawWidth } from './images';
import { attrGet, coalesce, imageAltText, renderInline, type InlineContext } from './inline';
import type {
	Content,
	ImageNode,
	ListNode,
	StackNode,
	TableNode,
	TextNode,
	TextRun
} from './pdfmake-types';
import { alignmentFromStyle, buildTable, type TableCellSpec } from './tables';
import type { FontMap } from './styles';

export interface BlockContext extends InlineContext {
	/** Nesting depth of the current list, for bullet character selection. */
	listDepth: number;
	/** Style paragraphs render with. Footnote bodies swap it out. */
	paragraphStyle: string;
	/** Accent of the enclosing callout, applied to its title. */
	calloutColor: string | null;
}

class Cursor {
	i = 0;
	constructor(readonly tokens: Token[]) {}
	peek(): Token | undefined {
		return this.tokens[this.i];
	}
	next(): Token | undefined {
		return this.tokens[this.i++];
	}
	done(): boolean {
		return this.i >= this.tokens.length;
	}
}

export function renderTokens(tokens: Token[], ctx: BlockContext): Content[] {
	return renderBlocks(new Cursor(tokens), ctx, null);
}

function renderBlocks(cur: Cursor, ctx: BlockContext, stop: string | null): Content[] {
	const out: Content[] = [];
	while (!cur.done()) {
		const tok = cur.peek() as Token;
		if (stop && tok.type === stop) break;
		// The source line that produced this block. pdfmake reports `id` back with
		// the node's final page and offset, which is what scroll sync maps through.
		const line = tok.map?.[0];
		const node = renderBlock(cur, ctx);
		if (!node) continue;
		for (const produced of Array.isArray(node) ? node : [node]) {
			if (line != null && isTaggable(produced)) {
				(produced as { id?: string }).id = `L${line}`;
			}
			out.push(produced);
		}
	}
	return out;
}

/** Only object nodes can carry an id; strings and arrays cannot. */
function isTaggable(node: Content): node is Exclude<Content, string | Content[]> {
	return typeof node === 'object' && node !== null && !Array.isArray(node) && !('id' in node);
}

function elementNode(node: Content, key: ElementKey, t: Theme): Content {
	const style = t.elements[key];
	if (!style.breakBefore || typeof node !== 'object' || node === null || Array.isArray(node)) {
		return node;
	}
	return { ...(node as object), pageBreak: 'before' } as Content;
}

function renderBlock(cur: Cursor, ctx: BlockContext): Content | Content[] | null {
	const tok = cur.next();
	if (!tok) return null;
	const t = ctx.theme;

	switch (tok.type) {
		case 'heading_open': {
			const level = Math.min(6, Math.max(1, Number(tok.tag.slice(1)) || 1));
			const key = `h${level}` as ElementKey;
			const inline = takeInline(cur, key, ctx);
			skipUntil(cur, 'heading_close');
			const node: TextNode = {
				text: inline,
				style: key,
				headlineLevel: level,
				margin: [...t.elements[key].margin]
			};
			return elementNode(node, key, t);
		}

		case 'paragraph_open': {
			const inlineTok = cur.peek();
			// A paragraph holding nothing but an image becomes a block image (§6.7).
			const solo = inlineTok && soloImage(inlineTok);
			if (solo) {
				cur.next();
				skipUntil(cur, 'paragraph_close');
				return blockImage(solo, ctx);
			}
			const inline = takeInline(cur, ctx.paragraphStyle, ctx);
			skipUntil(cur, 'paragraph_close');
			if (inline.length === 0) return null;
			const node: TextNode = {
				text: inline,
				style: ctx.paragraphStyle
			};
			// Tight list items hide their paragraphs; the margin belongs to the item.
			if (tok.hidden) return { text: inline, style: 'listItem' };
			return elementNode(node, 'paragraph', t);
		}

		case 'bullet_list_open':
		case 'ordered_list_open': {
			const ordered = tok.type === 'ordered_list_open';
			const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
			const items: Content[] = [];
			ctx.listDepth++;
			while (!cur.done() && cur.peek()?.type !== close) {
				const item = cur.peek() as Token;
				if (item.type !== 'list_item_open') {
					cur.next();
					continue;
				}
				cur.next();
				const body = renderBlocks(cur, ctx, 'list_item_close');
				if (cur.peek()?.type === 'list_item_close') cur.next();
				items.push(body.length === 1 ? body[0] : ({ stack: body } as StackNode));
			}
			ctx.listDepth--;
			if (cur.peek()?.type === close) cur.next();

			const node: ListNode = {
				margin: [t.list.indent, 0, 0, t.elements.listItem.margin[3] + t.list.itemSpacing],
				style: 'listItem',
				markerColor: t.elements.listItem.color
			};
			if (ordered) {
				node.ol = items;
				const start = Number(attrGet(tok, 'start'));
				if (Number.isFinite(start) && start > 0) node.start = start;
			} else {
				node.ul = items;
				node.type = bulletForDepth(ctx.listDepth, t);
			}
			return elementNode(node, 'listItem', t);
		}

		case 'blockquote_open': {
			const calloutType = attrGet(tok, 'callout');
			if (calloutType !== null) return callout(tok, calloutType, cur, ctx);
			const body = renderBlocks(cur, ctx, 'blockquote_close');
			if (cur.peek()?.type === 'blockquote_close') cur.next();
			const node: TableNode = {
				table: {
					widths: ['*'],
					body: [[{ stack: body.length ? body : [{ text: '' }], style: 'blockquote' }]]
				},
				layout: 'blockquoteBar',
				margin: [...t.elements.blockquote.margin]
			};
			return elementNode(node, 'blockquote', t);
		}

		case 'fence':
		case 'code_block':
			return elementNode(codeBlock(tok, ctx), 'codeBlock', t);

		case 'table_open':
			return table(cur, ctx);

		case 'hr':
			return {
				canvas: [
					{
						type: 'line',
						x1: 0,
						y1: 0,
						x2: ctx.contentWidth,
						y2: 0,
						lineWidth: t.hr.width,
						lineColor: t.hr.color
					}
				],
				margin: [...t.hr.margin]
			};

		case 'pagebreak':
			return { text: '', pageBreak: 'after' };

		case 'callout_title_open': {
			const inline = takeInline(cur, 'calloutTitle', ctx);
			skipUntil(cur, 'callout_title_close');
			const node: TextNode = { text: inline, style: 'calloutTitle' };
			if (ctx.calloutColor) node.color = ctx.calloutColor;
			return node;
		}

		case 'footnote_block_open': {
			const previous = ctx.paragraphStyle;
			ctx.paragraphStyle = 'footnote';
			const body = renderBlocks(cur, ctx, 'footnote_block_close');
			ctx.paragraphStyle = previous;
			if (cur.peek()?.type === 'footnote_block_close') cur.next();
			return footnoteSection(body, ctx);
		}

		case 'footnote_open': {
			const id = (tok.meta as { id?: number } | undefined)?.id ?? 0;
			const body = renderBlocks(cur, ctx, 'footnote_close');
			if (cur.peek()?.type === 'footnote_close') cur.next();
			// An `ol` of one, started at the note's number: pdfmake already knows
			// how to hang the marker, and no separate gutter column is needed.
			return {
				ol: [body.length === 1 ? body[0] : ({ stack: body } as StackNode)],
				start: id + 1,
				style: 'footnote',
				markerColor: t.elements.footnote.color,
				margin: [t.list.indent, 0, 0, 0]
			} as ListNode;
		}

		case 'footnote_anchor':
			return null; // A backlink to the reference; a PDF has nothing to click.

		case 'obsidian_comment_block': {
			const c = t.obsidian.comments;
			if (!c.show || !tok.content) return null;
			return {
				text: tok.content,
				style: 'paragraph',
				color: c.color,
				italics: c.italics
			} as TextNode;
		}

		case 'html_block':
			ctx.warnings.add('Block-level HTML was dropped — the PDF renderer has no HTML support.');
			return null;

		case 'inline': {
			// An inline token outside any block wrapper; render it as a paragraph.
			const runs = coalesce(renderInline(tok.children, 'paragraph', ctx));
			return runs.length ? ({ text: runs, style: 'paragraph' } as TextNode) : null;
		}

		default:
			return null;
	}
}

const NOTE_FALLBACK = { color: '#086ddd', background: '#e7f0fd', icon: '' };

/**
 * A callout is a blockquote the parser tagged with a type (§ obsidian.ts). The
 * bar and tint colours vary per callout, so the layout is built inline rather
 * than looked up by name in buildLayouts — pdfmake accepts either.
 */
function callout(open: Token, type: string, cur: Cursor, ctx: BlockContext): Content {
	const t = ctx.theme;
	const c = t.obsidian.callouts;
	const spec = c.types[type] ?? c.types.note ?? NOTE_FALLBACK;

	const previousColor = ctx.calloutColor;
	ctx.calloutColor = spec.color;
	let body = renderBlocks(cur, ctx, 'blockquote_close');
	ctx.calloutColor = previousColor;
	if (cur.peek()?.type === 'blockquote_close') cur.next();

	// `> [!note]-` is collapsed in Obsidian. A PDF has no disclosure triangle, so
	// the theme decides whether the body is printed or dropped.
	if (attrGet(open, 'callout-fold') === '-' && !c.showCollapsedBody) body = body.slice(0, 1);

	if (spec.icon && body.length && isTitleNode(body[0])) {
		const title = body[0] as TextNode;
		const runs = Array.isArray(title.text) ? title.text : [title.text];
		title.text = [{ text: `${spec.icon} `, color: spec.color }, ...runs];
	}

	const node: TableNode = {
		table: { widths: ['*'], body: [[{ stack: body.length ? body : [{ text: '' }] }]] },
		layout: {
			hLineWidth: () => 0,
			vLineWidth: (i) => (i === 0 ? c.barWidth : 0),
			hLineColor: () => spec.color,
			vLineColor: () => spec.color,
			paddingLeft: () => c.padding[0],
			paddingTop: () => c.padding[1],
			paddingRight: () => c.padding[2],
			paddingBottom: () => c.padding[3],
			fillColor: () => spec.background
		},
		margin: [...c.margin]
	};
	return elementNode(node, 'blockquote', t);
}

function isTitleNode(node: Content): boolean {
	return typeof node === 'object' && node !== null && (node as TextNode).style === 'calloutTitle';
}

/** The endnotes markdown-it-footnote appends, with its own rule and heading. */
function footnoteSection(body: Content[], ctx: BlockContext): Content {
	const t = ctx.theme;
	const f = t.obsidian.footnotes;
	const stack: Content[] = [];

	if (f.rule.enabled) {
		stack.push({
			canvas: [
				{
					type: 'line',
					x1: 0,
					y1: 0,
					x2: ctx.contentWidth,
					y2: 0,
					lineWidth: f.rule.width,
					lineColor: f.rule.color
				}
			],
			margin: [0, 12, 0, 8]
		});
	}
	if (f.heading.trim()) {
		stack.push({ text: f.heading, style: 'h2', margin: [...t.elements.h2.margin] });
	}
	stack.push(...body);

	const node: StackNode = { stack };
	if (f.breakBefore) node.pageBreak = 'before';
	return node;
}

function bulletForDepth(depth: number, t: Theme): string {
	const chars = t.list.bulletChars;
	if (chars.length === 0) return 'square';
	return chars[Math.max(0, depth - 1) % chars.length];
}

function takeInline(cur: Cursor, style: string, ctx: BlockContext) {
	const tok = cur.peek();
	if (!tok || tok.type !== 'inline') return [];
	cur.next();
	return coalesce(renderInline(tok.children, style, ctx));
}

function skipUntil(cur: Cursor, type: string): void {
	while (!cur.done()) {
		const tok = cur.next();
		if (tok?.type === type) return;
	}
}

/** An inline token whose only meaningful child is a single image. */
function soloImage(tok: Token): Token | null {
	if (tok.type !== 'inline') return null;
	const kids = (tok.children ?? []).filter((c) => !(c.type === 'text' && c.content.trim() === ''));
	return kids.length === 1 && kids[0].type === 'image' ? kids[0] : null;
}

function blockImage(tok: Token, ctx: BlockContext): Content {
	const t = ctx.theme;
	const src = attrGet(tok, 'src') ?? '';
	const resolved: ResolvedImage | undefined = ctx.images.get(src);
	const alt = imageAltText(tok);

	if (!resolved || resolved.kind === 'failed') {
		// A broken image must never abort generation (§6.7 item 2).
		const w = Math.min(240, ctx.contentWidth);
		return {
			stack: [
				{
					canvas: [
						{
							type: 'rect',
							x: 0,
							y: 0,
							w,
							h: 90,
							color: '#f2f2f2',
							lineColor: '#cccccc',
							lineWidth: 0.5
						}
					]
				},
				{ text: alt, style: 'imageCaption', margin: [0, 4, 0, 0] }
			],
			alignment: t.image.alignment,
			margin: [...t.image.margin]
		};
	}

	const image: ImageNode = {
		image: resolved.dataUri,
		width: drawWidth(resolved.width, ctx.contentWidth, t.image.maxWidth),
		alignment: t.image.alignment
	};

	if (!t.image.caption.enabled || !alt || alt === '[image]') {
		return { ...image, margin: [...t.image.margin] };
	}

	return {
		stack: [image, { text: alt, style: 'imageCaption', margin: [0, 4, 0, 0] }],
		margin: [...t.image.margin]
	};
}

function codeBlock(tok: Token, ctx: BlockContext): Content {
	const t = ctx.theme;
	const language = (tok.info ?? '').trim().split(/\s+/)[0] || null;
	const source = tok.content.replace(/\n$/, '');

	const runs: TextRun[] = splitEmojiRuns(
		t.code.syntaxHighlight ? highlightRuns(source, language, t) : [{ text: source }],
		ctx.fonts.emoji
	);

	const codeCell: Content = { text: runs, style: 'codeBlock' };

	if (!t.code.showLineNumbers) {
		return {
			table: { widths: ['*'], body: [[codeCell]] },
			layout: 'codeBlock',
			fillColor: t.code.background,
			margin: [...t.elements.codeBlock.margin]
		};
	}

	const gutter = source.split('\n').map((_, i) => `${i + 1}\n`).join('');
	return {
		table: {
			widths: ['auto', '*'],
			body: [[{ text: gutter, style: 'codeLineNumber' }, codeCell]]
		},
		layout: 'codeBlockGutter',
		fillColor: t.code.background,
		margin: [...t.elements.codeBlock.margin]
	};
}

function table(cur: Cursor, ctx: BlockContext): Content {
	const header: TableCellSpec[] = [];
	const rows: TableCellSpec[][] = [];
	let current: TableCellSpec[] | null = null;
	let inHead = false;

	while (!cur.done()) {
		const tok = cur.next() as Token;
		if (tok.type === 'table_close') break;

		switch (tok.type) {
			case 'thead_open':
				inHead = true;
				break;
			case 'thead_close':
				inHead = false;
				break;
			case 'tr_open':
				current = [];
				break;
			case 'tr_close':
				if (current) {
					if (inHead && header.length === 0) header.push(...current);
					else rows.push(current);
				}
				current = null;
				break;
			case 'th_open':
			case 'td_open': {
				const alignment = alignmentFromStyle(attrGet(tok, 'style'));
				const style = tok.type === 'th_open' ? 'tableHeader' : 'tableCell';
				const runs = takeInline(cur, style, ctx);
				skipUntil(cur, tok.type === 'th_open' ? 'th_close' : 'td_close');
				current?.push({
					content: { text: runs, style } as TextNode,
					alignment
				});
				break;
			}
			default:
				break;
		}
	}

	return buildTable(header, rows, ctx.theme);
}

export function makeContext(
	theme: Theme,
	fonts: FontMap,
	images: Map<string, ResolvedImage>,
	emojiArt: Map<string, string>,
	contentWidth: number,
	warnings: Set<string>
): BlockContext {
	return {
		theme,
		fonts,
		images,
		emojiArt,
		contentWidth,
		warnings,
		listDepth: 0,
		paragraphStyle: 'paragraph',
		calloutColor: null
	};
}
