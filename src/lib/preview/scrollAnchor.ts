export interface ScrollAnchor {
	/** scrollTop as a fraction of scrollHeight, so it survives a page-count change. */
	ratio: number;
	/** 1-based index of the page nearest the top of the viewport. */
	page: number;
	/**
	 * Position within that page, as a fraction of the page's own height.
	 *
	 * A fraction rather than pixels so it survives a zoom change: the same
	 * anchor has to restore correctly against page tops measured at a different
	 * scale. May fall outside [0, 1] when the scroll position sits in the gap
	 * between pages.
	 */
	offsetInPage: number;
}

/** Distance from one page top to the next; the last page reuses the previous span. */
function pageSpan(pageTops: number[], index: number): number {
	if (pageTops.length < 2) return 0;
	const i = Math.min(index, pageTops.length - 2);
	return pageTops[i + 1] - pageTops[i];
}

/**
 * Snapping to page 1 on every keystroke makes the app unusable regardless of how
 * good the output is (§9 requirement 1, pitfall 3).
 */
export function capture(container: HTMLElement, pageTops: number[]): ScrollAnchor {
	const top = container.scrollTop;
	const height = Math.max(1, container.scrollHeight - container.clientHeight);

	let page = 1;
	for (let i = 0; i < pageTops.length; i++) {
		if (pageTops[i] <= top) page = i + 1;
		else break;
	}

	const span = pageSpan(pageTops, page - 1);
	const offset = top - (pageTops[page - 1] ?? 0);

	return {
		ratio: Math.min(1, Math.max(0, top / height)),
		page,
		offsetInPage: span > 0 ? offset / span : 0
	};
}

export function restore(container: HTMLElement, anchor: ScrollAnchor, pageTops: number[]): void {
	// Prefer the page anchor: it holds even when the page count or zoom changes.
	const pageTop = pageTops[anchor.page - 1];
	if (pageTop !== undefined) {
		const span = pageSpan(pageTops, anchor.page - 1);
		container.scrollTop = pageTop + anchor.offsetInPage * span;
		return;
	}
	const height = Math.max(0, container.scrollHeight - container.clientHeight);
	container.scrollTop = anchor.ratio * height;
}
