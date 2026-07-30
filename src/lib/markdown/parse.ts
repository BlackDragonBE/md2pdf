import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import footnote from 'markdown-it-footnote';
import mark from 'markdown-it-mark';
import taskLists from 'markdown-it-task-lists';
import type { Theme } from '../theme/schema';
import { extractFrontMatter, mergeMeta, type DocMeta } from './frontmatter';
import { obsidianPlugin, type ObsidianOptions } from './obsidian';
import { pagebreakPlugin } from './pagebreak';

export type { DocMeta };

/** Everything in the theme that changes the *token stream* rather than its styling. */
export interface ParseOptions extends ObsidianOptions {
	marker: string;
	highlight: boolean;
	footnotes: boolean;
}

export function parseOptionsFor(theme: Theme): ParseOptions {
	const o = theme.obsidian;
	return {
		marker: theme.pagebreak.marker,
		wikilinks: o.wikilinks.enabled,
		callouts: o.callouts.enabled,
		comments: o.comments.enabled,
		blockIds: o.blockIds.enabled,
		tags: o.tags.enabled,
		highlight: o.highlight.enabled,
		footnotes: o.footnotes.enabled
	};
}

export interface ParseResult {
	meta: DocMeta;
	tokens: Token[];
	warnings: string[];
}

/**
 * The marker and the Obsidian feature switches are configurable, so a parser is
 * cached per configuration rather than built once (§6.3). Only ever one live
 * entry — themes change one at a time.
 */
let cached: { key: string; md: MarkdownIt } | undefined;

function cacheKey(o: ParseOptions): string {
	return [
		o.marker,
		o.wikilinks,
		o.callouts,
		o.comments,
		o.blockIds,
		o.tags,
		o.highlight,
		o.footnotes
		// A NUL as an escape, never a literal NUL byte in the source: one of those
		// makes git treat the whole file as binary, so it gets no diff and no
		// blame. The marker is free-form user text, so the separator has to be
		// something it cannot contain.
	].join('\u0000');
}

function parser(options: ParseOptions): MarkdownIt {
	const key = cacheKey(options);
	if (cached?.key === key) return cached.md;
	const md = new MarkdownIt({
		html: false, // NON-NEGOTIABLE. Raw HTML never reaches the PDF (§6.1).
		linkify: true,
		typographer: true,
		breaks: false
	});
	md.use(taskLists, { enabled: true, label: false });
	md.use(pagebreakPlugin, { marker: options.marker });
	if (options.highlight) md.use(mark);
	if (options.footnotes) md.use(footnote);
	md.use(obsidianPlugin, options);
	cached = { key, md };
	return md;
}

export function parse(
	source: string,
	options: ParseOptions,
	metaOverrides: Partial<DocMeta> = {}
): ParseResult {
	const fm = extractFrontMatter(source);
	const md = parser(options);
	const tokens = md.parse(fm.body, {});
	return {
		meta: mergeMeta(fm.meta, metaOverrides),
		tokens,
		warnings: fm.warnings
	};
}
