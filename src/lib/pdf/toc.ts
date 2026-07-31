import type { Theme } from '../theme/schema';
import type { Content, TocNode } from './pdfmake-types';

/**
 * pdfmake's own table of contents, not a hand-built one.
 *
 * Entries collect from every node carrying `tocItem` (see blocks.ts), and the
 * page numbers are filled on a second layout pass — the only way to print a
 * number that is still correct after the TOC itself has pushed the content
 * down. Indentation is per entry, through `tocMargin`.
 */
export function tocNode(t: Theme): Content[] {
	if (!t.toc.enabled) return [];

	const node: TocNode = {
		toc: {
			textStyle: 'tocEntry',
			numberStyle: 'tocEntry',
			textMargin: [0, t.toc.entrySpacing, 0, 0]
		}
	};
	if (t.toc.title.trim()) {
		node.toc.title = { text: t.toc.title, style: 'tocTitle' };
	}

	// A spacer node, not `pageBreak: 'after'` on the TOC itself: pdfmake replaces
	// the toc node with a table at layout time and the flag does not survive.
	return t.toc.pageBreakAfter ? [node, { text: '', pageBreak: 'after' }] : [node];
}
