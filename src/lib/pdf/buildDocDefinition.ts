import type Token from 'markdown-it/lib/token.mjs';
import type { DocMeta } from '../markdown/frontmatter';
import type { ElementKey, Theme } from '../theme/schema';
import { makeContext, renderTokens } from './blocks';
import { buildCover, coverSpacer } from './cover';
import { footerFor, headerFor, isCoverPage } from './headerFooter';
import type { ResolvedImage } from './images';
import {
	pageDimensions,
	type Content,
	type DocDefinition,
	type PageBreakNodeInfo
} from './pdfmake-types';
import { buildDefaultStyle, buildStyles, type FontMap } from './styles';
import { pageBackground, watermarkSpec } from './watermark';

export interface BuildInput {
	tokens: Token[];
	theme: Theme;
	meta: DocMeta;
	images: Map<string, ResolvedImage>;
	/** Font role → the family name registered in the pdfmake font dictionary. */
	fonts: FontMap;
}

/** Where a source line ended up in the finished PDF. */
export interface Anchor {
	/** 0-based source line. */
	line: number;
	/** 1-based physical page. */
	page: number;
	/** Offset from the top of that page, in points. */
	top: number;
}

export interface BuildResult {
	docDefinition: DocDefinition;
	warnings: string[];
	/**
	 * Filled during layout, not at build time — read it only after the document
	 * has been generated. pdfmake calls `pageBreakBefore` for every node and
	 * hands back the position it settled at, which is the only way to learn
	 * where a given line of Markdown landed.
	 */
	anchors: Map<number, Anchor>;
}

const HEADING_KEYS: ElementKey[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Synchronous by construction: images are resolved on the main thread and
 * handed in, so this whole function can run inside the worker (§6.7 item 6).
 */
export function buildDocDefinition(input: BuildInput): BuildResult {
	const { tokens, theme: t, meta, images, fonts } = input;
	const warnings = new Set<string>();

	const pageSize = pageDimensions(t.page.size, t.page.orientation);
	const contentWidth = pageSize.width - t.page.margins[0] - t.page.margins[2];

	const ctx = makeContext(t, fonts, images, contentWidth, warnings);
	const body = renderTokens(tokens, ctx);

	if (t.background.image?.fit === 'tile') {
		warnings.add('Background image "tile" is not supported by the PDF engine — rendered as cover.');
	}

	// Indexed by headlineLevel, so 1-based with a dead slot at 0.
	const keepWithNext: boolean[] = [false, ...HEADING_KEYS.map((k) => t.elements[k].keepWithNext)];

	const anchors = new Map<number, Anchor>();

	const docDefinition: DocDefinition = {
		pageSize: t.page.size,
		pageOrientation: t.page.orientation,
		pageMargins: [...t.page.margins],
		content: [...coverSpacer(t), ...body] as Content[],
		styles: buildStyles(t, fonts),
		defaultStyle: buildDefaultStyle(t, fonts),
		info: {
			title: meta.title || undefined,
			author: meta.author || undefined,
			subject: meta.subtitle || undefined,
			creator: 'md2pdf',
			producer: 'md2pdf'
		},
		background: (currentPage, ps) =>
			isCoverPage(currentPage, t) ? buildCover(t, ps, meta, fonts) : pageBackground(t, ps),
		watermark: watermarkSpec(t, fonts),
		header: (currentPage, pageCount, ps) =>
			headerFor(currentPage, pageCount, ps, t, meta, fonts, warnings),
		footer: (currentPage, pageCount, ps) =>
			footerFor(currentPage, pageCount, ps, t, meta, fonts, warnings),
		pageBreakBefore: (currentNode: PageBreakNodeInfo, followingNodesOnPage: PageBreakNodeInfo[]) => {
			// Harvest the position while we are here; pdfmake offers no other hook
			// that reports where a node actually landed. Layout runs twice, so a
			// later pass simply overwrites with the final numbers.
			const id = currentNode.id;
			const position = currentNode.startPosition;
			if (id && id.charCodeAt(0) === 76 /* L */ && position) {
				const line = Number(id.slice(1));
				if (Number.isFinite(line)) {
					anchors.set(line, { line, page: position.pageNumber, top: position.top });
				}
			}

			// A heading that lands last on a page strands its section (§6.8).
			return (
				currentNode.headlineLevel != null &&
				keepWithNext[currentNode.headlineLevel] === true &&
				followingNodesOnPage.length === 0
			);
		},
		compress: true
	};

	return { docDefinition, warnings: [...warnings], anchors };
}
