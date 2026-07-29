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

export interface BuildResult {
	docDefinition: DocDefinition;
	warnings: string[];
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
		// A heading that lands last on a page strands its section (§6.8).
		pageBreakBefore: (currentNode: PageBreakNodeInfo, followingNodesOnPage: PageBreakNodeInfo[]) =>
			currentNode.headlineLevel != null &&
			keepWithNext[currentNode.headlineLevel] === true &&
			followingNodesOnPage.length === 0,
		compress: true
	};

	return { docDefinition, warnings: [...warnings] };
}
