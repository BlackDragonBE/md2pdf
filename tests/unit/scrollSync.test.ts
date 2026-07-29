import { describe, expect, it } from 'vitest';
import {
	lineForPreviewOffset,
	pageTopsFrom,
	previewOffsetForLine
} from '../../src/lib/preview/scrollSync';
import type { Anchor } from '../../src/lib/pdf/buildDocDefinition';

const GAP = 16;
const PAGE = 842; // A4 height in points, and in px at zoom 1

/** Three pages of anchors, 100pt apart. */
const ANCHORS: Anchor[] = [
	{ line: 0, page: 1, top: 50 },
	{ line: 10, page: 1, top: 300 },
	{ line: 20, page: 1, top: 600 },
	{ line: 30, page: 2, top: 60 },
	{ line: 40, page: 2, top: 400 },
	{ line: 50, page: 3, top: 80 }
];

function geometry(zoom = 1, pages = 3) {
	return { pageTops: pageTopsFrom(Array(pages).fill(PAGE * zoom), GAP), zoom };
}

describe('previewOffsetForLine', () => {
	it('places the first line at its anchor', () => {
		expect(previewOffsetForLine(ANCHORS, 0, geometry())).toBe(GAP + 50);
	});

	it('places a line on a later page past that page top', () => {
		const pageTwoTop = GAP + PAGE + GAP;
		expect(previewOffsetForLine(ANCHORS, 30, geometry())).toBe(pageTwoTop + 60);
	});

	it('interpolates between anchors rather than jumping block to block', () => {
		const at10 = previewOffsetForLine(ANCHORS, 10, geometry())!;
		const at20 = previewOffsetForLine(ANCHORS, 20, geometry())!;
		const at15 = previewOffsetForLine(ANCHORS, 15, geometry())!;
		expect(at15).toBeGreaterThan(at10);
		expect(at15).toBeLessThan(at20);
		expect(at15).toBeCloseTo((at10 + at20) / 2, 5);
	});

	it('scales with zoom', () => {
		const atOne = previewOffsetForLine(ANCHORS, 20, geometry(1))!;
		const atTwo = previewOffsetForLine(ANCHORS, 20, geometry(2))!;
		expect(atTwo).toBeGreaterThan(atOne);
	});

	it('clamps a line before the first anchor to the first anchor', () => {
		expect(previewOffsetForLine(ANCHORS, -5, geometry())).toBe(GAP + 50);
	});

	it('clamps a line past the last anchor to the last anchor', () => {
		const last = previewOffsetForLine(ANCHORS, 50, geometry())!;
		expect(previewOffsetForLine(ANCHORS, 9999, geometry())).toBe(last);
	});

	it('returns null when there is nothing to map through', () => {
		expect(previewOffsetForLine([], 5, geometry())).toBeNull();
		expect(previewOffsetForLine(ANCHORS, 5, { pageTops: [], zoom: 1 })).toBeNull();
	});

	it('never goes backwards as the line advances', () => {
		let previous = -Infinity;
		for (let line = 0; line <= 60; line++) {
			const offset = previewOffsetForLine(ANCHORS, line, geometry())!;
			expect(offset).toBeGreaterThanOrEqual(previous);
			previous = offset;
		}
	});
});

describe('lineForPreviewOffset', () => {
	it('inverts previewOffsetForLine at the anchors', () => {
		for (const anchor of ANCHORS) {
			const offset = previewOffsetForLine(ANCHORS, anchor.line, geometry())!;
			expect(lineForPreviewOffset(ANCHORS, offset, geometry())).toBeCloseTo(anchor.line, 5);
		}
	});

	it('inverts between anchors too', () => {
		for (const line of [3, 7, 14, 26, 35, 47]) {
			const offset = previewOffsetForLine(ANCHORS, line, geometry())!;
			expect(lineForPreviewOffset(ANCHORS, offset, geometry())).toBeCloseTo(line, 4);
		}
	});

	it('survives an offset above the first page', () => {
		expect(lineForPreviewOffset(ANCHORS, 0, geometry())).toBe(0);
	});

	it('survives an offset past the end', () => {
		expect(lineForPreviewOffset(ANCHORS, 999_999, geometry())).toBe(50);
	});

	it('returns null with no anchors', () => {
		expect(lineForPreviewOffset([], 100, geometry())).toBeNull();
	});
});

describe('pageTopsFrom', () => {
	it('stacks pages with a gap between them', () => {
		expect(pageTopsFrom([100, 200, 300], 10)).toEqual([10, 120, 330]);
	});

	it('handles an empty document', () => {
		expect(pageTopsFrom([], 10)).toEqual([]);
	});
});
