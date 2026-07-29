import { describe, expect, it } from 'vitest';
import { capture, restore } from '../../src/lib/preview/scrollAnchor';

/** Minimal stand-in for the scroll container; only three properties matter. */
function container(scrollTop: number, scrollHeight: number, clientHeight: number) {
	return { scrollTop, scrollHeight, clientHeight } as unknown as HTMLElement;
}

/** Page tops for N pages of equal height, with a 16pt gap, matching Preview. */
function tops(count: number, height = 800, gap = 16): number[] {
	return Array.from({ length: count }, (_, i) => gap + i * (height + gap));
}

describe('scroll anchoring', () => {
	it('identifies the page nearest the top of the viewport', () => {
		const t = tops(5); // [16, 832, 1648, 2464, 3280]
		expect(capture(container(0, 4080, 600), t).page).toBe(1);
		expect(capture(container(831, 4080, 600), t).page).toBe(1); // still page 1 by 1px
		expect(capture(container(832, 4080, 600), t).page).toBe(2);
		expect(capture(container(2500, 4080, 600), t).page).toBe(4);
	});

	it('records the offset within the page', () => {
		const t = tops(5);
		const anchor = capture(container(t[2] + 120, 4080, 600), t);
		expect(anchor.page).toBe(3);
		expect(anchor.offsetInPage).toBe(120);
	});

	it('round-trips an exact scroll position when the layout is unchanged', () => {
		const t = tops(5);
		const anchor = capture(container(1700, 4080, 600), t);
		const target = container(0, 4080, 600);
		restore(target, anchor, t);
		expect(target.scrollTop).toBe(1700);
	});

	it('keeps the reader on the same page when earlier pages reflow', () => {
		const before = tops(5, 800);
		const anchor = capture(container(before[3] + 50, 4080, 600), before);
		// The document grew: pages are now taller, so absolute offsets moved.
		const after = tops(6, 900);
		const target = container(0, 5500, 600);
		restore(target, anchor, after);
		expect(target.scrollTop).toBe(after[3] + 50);
	});

	it('falls back to the scroll ratio when the anchored page no longer exists', () => {
		const before = tops(8);
		const anchor = capture(container(before[6], 6600, 600), before);
		const after = tops(3);
		const target = container(0, 2500, 600);
		restore(target, anchor, after);
		expect(target.scrollTop).toBeGreaterThan(0);
		expect(target.scrollTop).toBeLessThanOrEqual(2500 - 600);
	});

	it('never snaps to the top when the reader was scrolled down', () => {
		const before = tops(10);
		for (const position of [900, 2000, 5000, 7000]) {
			const anchor = capture(container(position, 8200, 600), before);
			const target = container(0, 8200, 600);
			restore(target, anchor, before);
			expect(target.scrollTop, `position ${position}`).toBeGreaterThan(0);
		}
	});

	it('clamps the ratio into [0, 1]', () => {
		const t = tops(3);
		expect(capture(container(-50, 2500, 600), t).ratio).toBe(0);
		expect(capture(container(99999, 2500, 600), t).ratio).toBe(1);
	});

	it('survives a container that cannot scroll', () => {
		const t = tops(1);
		const anchor = capture(container(0, 500, 500), t);
		expect(Number.isFinite(anchor.ratio)).toBe(true);
		// scrollTop 0 sits in the gap above page 1, so the offset is negative and
		// restoring lands back on 0 rather than jumping down to the page top.
		expect(anchor.offsetInPage).toBe(-16);
		const target = container(0, 500, 500);
		restore(target, anchor, t);
		expect(target.scrollTop).toBe(0);
	});

	it('survives an empty document', () => {
		const anchor = capture(container(0, 0, 600), []);
		expect(anchor.page).toBe(1);
		const target = container(0, 0, 600);
		restore(target, anchor, []);
		expect(target.scrollTop).toBe(0);
	});
});
