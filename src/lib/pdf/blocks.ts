import type Token from 'markdown-it/lib/token.mjs';
import type { ElementKey, Theme } from '../theme/schema';
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
		const node = renderBlock(cur, ctx);
		if (node) out.push(...(Array.isArray(node) ? node : [node]));
	}
	return out;
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
				text: inline as (string | TextRun)[],
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
			const inline = takeInline(cur, 'paragraph', ctx);
			skipUntil(cur, 'paragraph_close');
			if (inline.length === 0) return null;
			const node: TextNode = { text: inline as (string | TextRun)[], style: 'paragraph' };
			// Tight list items hide their paragraphs; the margin belongs to the item.
			if (tok.hidden) return { text: inline as (string | TextRun)[], style: 'listItem' };
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

		case 'html_block':
			ctx.warnings.add('Block-level HTML was dropped — the PDF renderer has no HTML support.');
			return null;

		case 'inline': {
			// An inline token outside any block wrapper; render it as a paragraph.
			const runs = coalesce(renderInline(tok.children, 'paragraph', ctx));
			return runs.length ? ({ text: runs as (string | TextRun)[], style: 'paragraph' } as TextNode) : null;
		}

		default:
			return null;
	}
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

	const runs: TextRun[] = t.code.syntaxHighlight
		? highlightRuns(source, language, t)
		: [{ text: source }];

	const codeCell: Content = { text: runs as (string | TextRun)[], style: 'codeBlock' };

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
					content: { text: runs as (string | TextRun)[], style } as TextNode,
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
	contentWidth: number,
	warnings: Set<string>
): BlockContext {
	return { theme, fonts, images, contentWidth, warnings, listDepth: 0 };
}
