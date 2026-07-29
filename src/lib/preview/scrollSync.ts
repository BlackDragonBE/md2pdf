import type { Anchor } from '../pdf/buildDocDefinition';

/**
 * Two-way mapping between a source line and a position in the rendered PDF.
 *
 * The anchors come from pdfmake reporting where each block actually landed, so
 * this is a real correspondence rather than a proportional guess: a document
 * with a tall image or a page break stays aligned where scroll-fraction sync
 * would drift badly.
 *
 * Everything here is pure and unit-tested; the DOM plumbing lives in the
 * components.
 */

/** Absolute y of each page's top edge in the preview scroll container. */
export function pageTopsFrom(heights: number[], gap: number): number[] {
	const tops: number[] = [];
	for (let i = 0; i < heights.length; i++) {
		tops.push(i === 0 ? gap : tops[i - 1] + heights[i - 1] + gap);
	}
	return tops;
}

/** Index of the last anchor at or before `line`, or -1 when there is none. */
function anchorBefore(anchors: Anchor[], line: number): number {
	let low = 0;
	let high = anchors.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (anchors[mid].line <= line) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

/** Absolute y of an anchor in the preview scroll container, in CSS pixels. */
function anchorOffset(anchor: Anchor, pageTops: number[], zoom: number): number {
	const top = pageTops[anchor.page - 1];
	if (top === undefined) return pageTops[pageTops.length - 1] ?? 0;
	// pdf.js renders 1pt as 1px at zoom 1, so points scale straight by zoom.
	return top + anchor.top * zoom;
}

export interface SyncGeometry {
	pageTops: number[];
	zoom: number;
}

/**
 * Where in the preview a given source line lives.
 *
 * Interpolates between the surrounding anchors so scrolling through a long
 * paragraph moves the preview smoothly instead of jumping block to block.
 */
export function previewOffsetForLine(
	anchors: Anchor[],
	line: number,
	geometry: SyncGeometry
): number | null {
	if (anchors.length === 0 || geometry.pageTops.length === 0) return null;

	const index = anchorBefore(anchors, line);
	if (index < 0) return anchorOffset(anchors[0], geometry.pageTops, geometry.zoom);

	const current = anchors[index];
	const next = anchors[index + 1];
	const start = anchorOffset(current, geometry.pageTops, geometry.zoom);
	if (!next) return start;

	const span = next.line - current.line;
	if (span <= 0) return start;

	const end = anchorOffset(next, geometry.pageTops, geometry.zoom);
	const progress = Math.min(1, Math.max(0, (line - current.line) / span));
	return start + (end - start) * progress;
}

/** The inverse: which source line sits at a given preview offset. */
export function lineForPreviewOffset(
	anchors: Anchor[],
	offset: number,
	geometry: SyncGeometry
): number | null {
	if (anchors.length === 0 || geometry.pageTops.length === 0) return null;

	// Anchors are sorted by line, and layout order matches, so their offsets are
	// non-decreasing too — a scan from the end finds the enclosing pair.
	let index = 0;
	for (let i = 0; i < anchors.length; i++) {
		if (anchorOffset(anchors[i], geometry.pageTops, geometry.zoom) <= offset) index = i;
		else break;
	}

	const current = anchors[index];
	const next = anchors[index + 1];
	const start = anchorOffset(current, geometry.pageTops, geometry.zoom);
	if (!next) return current.line;

	const end = anchorOffset(next, geometry.pageTops, geometry.zoom);
	if (end <= start) return current.line;

	const progress = Math.min(1, Math.max(0, (offset - start) / (end - start)));
	return current.line + (next.line - current.line) * progress;
}
