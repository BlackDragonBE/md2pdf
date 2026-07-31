import type { Anchor } from './buildDocDefinition';
import type { HeadingInfo } from './headings';

/**
 * The slice of pdfkit the outline needs. pdfmake never exposes the pdfkit
 * document in its public API, but both render paths already reach it — the
 * browser through `_createDoc`, the golden tests through `createPdfKitDocument`.
 */
export interface OutlineTarget {
	outline: { addItem(title: string): OutlineNode };
	switchToPage(index: number): unknown;
}

interface OutlineNode {
	addItem(title: string): OutlineNode;
}

/**
 * Bookmarks — the sidebar tree every PDF reader shows and pdfmake has no
 * concept of.
 *
 * `addItem` binds to whatever page is current, which is why this runs after
 * layout: the page a heading landed on is only known once `anchors` has been
 * filled, and `switchToPage` is the one supported way to point at an earlier
 * one. It needs `bufferPages: true`, so both callers pass it.
 */
export function applyOutline(
	doc: OutlineTarget,
	headings: HeadingInfo[],
	anchors: Map<number, Anchor> | Anchor[]
): void {
	if (headings.length === 0) return;
	const pageOf = anchors instanceof Map ? anchors : new Map(anchors.map((a) => [a.line, a]));

	// The chain of items still open, innermost last. The root is level 0, so a
	// document whose shallowest heading is h2 hangs those off the root rather
	// than off each other.
	const stack: { level: number; node: OutlineNode }[] = [{ level: 0, node: doc.outline }];

	for (const heading of headings) {
		const anchor = pageOf.get(heading.line);
		if (!anchor) continue; // never laid out — nothing to point at

		try {
			doc.switchToPage(anchor.page - 1);
		} catch {
			continue; // outside the buffered range; a dead bookmark is worse than none
		}

		// Close every item this heading is not inside. A document that starts at
		// h3, or skips h2, therefore nests by the levels it actually uses instead
		// of opening holes for the ones it does not.
		while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) stack.pop();

		const title = heading.number ? `${heading.number} ${heading.text}` : heading.text;
		const item = stack[stack.length - 1].node.addItem(title || 'Untitled');
		stack.push({ level: heading.level, node: item });
	}
}
