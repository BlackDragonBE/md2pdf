export interface ScrollAnchor {
	/** scrollTop as a fraction of scrollHeight, so it survives a page-count change. */
	ratio: number;
	/** 1-based index of the page nearest the top of the viewport. */
	page: number;
	offsetInPage: number;
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

	return {
		ratio: Math.min(1, Math.max(0, top / height)),
		page,
		offsetInPage: top - (pageTops[page - 1] ?? 0)
	};
}

export function restore(
	container: HTMLElement,
	anchor: ScrollAnchor,
	pageTops: number[]
): void {
	// Prefer the page anchor: it holds even when the page count changes.
	const pageTop = pageTops[anchor.page - 1];
	if (pageTop !== undefined) {
		container.scrollTop = pageTop + anchor.offsetInPage;
		return;
	}
	const height = Math.max(0, container.scrollHeight - container.clientHeight);
	container.scrollTop = anchor.ratio * height;
}
