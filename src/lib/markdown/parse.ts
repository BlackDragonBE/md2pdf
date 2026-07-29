import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import taskLists from 'markdown-it-task-lists';
import { extractFrontMatter, mergeMeta, type DocMeta } from './frontmatter';
import { pagebreakPlugin } from './pagebreak';

export type { DocMeta };

export interface ParseResult {
	meta: DocMeta;
	tokens: Token[];
	warnings: string[];
}

/**
 * The marker is configurable, so a parser is cached per marker rather than
 * built once (§6.3). Only ever one live entry — themes change one at a time.
 */
let cached: { marker: string; md: MarkdownIt } | undefined;

function parser(marker: string): MarkdownIt {
	if (cached?.marker === marker) return cached.md;
	const md = new MarkdownIt({
		html: false, // NON-NEGOTIABLE. Raw HTML never reaches the PDF (§6.1).
		linkify: true,
		typographer: true,
		breaks: false
	});
	md.use(taskLists, { enabled: true, label: false });
	md.use(pagebreakPlugin, { marker });
	cached = { marker, md };
	return md;
}

export function parse(
	source: string,
	marker: string,
	metaOverrides: Partial<DocMeta> = {}
): ParseResult {
	const fm = extractFrontMatter(source);
	const md = parser(marker);
	const tokens = md.parse(fm.body, {});
	return {
		meta: mergeMeta(fm.meta, metaOverrides),
		tokens,
		warnings: fm.warnings
	};
}
