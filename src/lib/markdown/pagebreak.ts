import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';

export interface PagebreakOptions {
	marker: string;
}

/**
 * A block rule, not a source-string split: a marker inside a fenced code block
 * must render as literal text, and only a real block rule sees fence state
 * (§6.3).
 */
export function pagebreakPlugin(md: MarkdownIt, options: PagebreakOptions): void {
	const marker = options.marker;

	const rule = (state: StateBlock, startLine: number, _endLine: number, silent: boolean) => {
		// Indented by four or more spaces: that is a code block, not a marker.
		if (state.sCount[startLine] - state.blkIndent >= 4) return false;

		const pos = state.bMarks[startLine] + state.tShift[startLine];
		const max = state.eMarks[startLine];
		if (state.src.slice(pos, max).trim() !== marker) return false;

		if (silent) return true;

		state.line = startLine + 1;
		const token = state.push('pagebreak', '', 0);
		token.block = true;
		token.nesting = 0;
		token.map = [startLine, state.line];
		token.markup = marker;
		return true;
	};

	md.block.ruler.before('hr', 'pagebreak', rule, {
		alt: ['paragraph', 'reference', 'blockquote', 'list']
	});
}
