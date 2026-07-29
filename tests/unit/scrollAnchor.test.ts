import { describe, expect, it } from 'vitest';
import { capture, restore } from '../../src/lib/preview/scrollAnchor';

/** Minimal stand-in for the scroll container; only three properties matter. */
function container(scrollTop: number, scrollHeight: number, clientHeight: number) {
	return { scrollTop, scrollHeight, clientHeight } as unknown as HTMLElement;
}

/** Page tops for N pages of equal height, with a 16px gap, matching Preview. */
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

	it('records the offset as a fraction of the page span', () => {
		const t = tops(5); // span 816
		const anchor = capture(container(t[2] + 408, 4080, 600), t);
		expect(anchor.page).toBe(3);
		expect(anchor.offsetInPage).toBeCloseTo(0.5, 5);
	});

	it('round-trips an exact scroll position when the layout is unchanged', () => {
		const t = tops(5);
		const anchor = capture(container(1700, 4080, 600), t);
		const target = container(0, 4080, 600);
		restore(target, anchor, t);
		expect(target.scrollTop).toBeCloseTo(1700, 5);
	});

	it('keeps the reader on the same page when earlier pages reflow', () => {
		const before = tops(5, 800);
		const anchor = capture(container(before[3] + 50, 4080, 600), before);
		// The document grew: pages are now taller, so absolute offsets moved.
		const after = tops(6, 900);
		const target = container(0, 5500, 600);
		restore(target, anchor, after);
		expect(target.scrollTop).toBeGreaterThan(after[3]);
		expect(target.scrollTop).toBeLessThan(after[4]);
	});

	/** A pixel offset would drift on every zoom change; a fraction does not. */
	it('lands on the same point in the page after a zoom change', () => {
		const atOneX = tops(6, 800);
		const anchor = capture(container(atOneX[3] + 400, 5000, 600), atOneX);
		expect(anchor.offsetInPage).toBeCloseTo(400 / 816, 5);

		const atTwoX = tops(6, 1600, 32);
		const target = container(0, 10000, 600);
		restore(target, anchor, atTwoX);

		// Halfway down page 4 at 1x must still be halfway down page 4 at 2x.
		const spanAtTwoX = atTwoX[4] - atTwoX[3];
		const positionInPage = (target.scrollTop - atTwoX[3]) / spanAtTwoX;
		expect(positionInPage).toBeCloseTo(400 / 816, 5);
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

	it('survives a single-page document, where there is no span to measure', () => {
		const t = tops(1);
		const anchor = capture(container(0, 500, 500), t);
		expect(Number.isFinite(anchor.ratio)).toBe(true);
		expect(anchor.offsetInPage).toBe(0);
		const target = container(0, 500, 500);
		restore(target, anchor, t);
		expect(target.scrollTop).toBe(16);
	});

	it('survives an empty document', () => {
		const anchor = capture(container(0, 0, 600), []);
		expect(anchor.page).toBe(1);
		const target = container(0, 0, 600);
		restore(target, anchor, []);
		expect(target.scrollTop).toBe(0);
	});

	it('produces a finite scrollTop for every anchor it can produce', () => {
		const t = tops(4);
		for (const position of [0, 16, 500, 832, 3000, 4000]) {
			const anchor = capture(container(position, 3400, 600), t);
			const target = container(0, 3400, 600);
			restore(target, anchor, t);
			expect(Number.isFinite(target.scrollTop), `position ${position}`).toBe(true);
		}
	});
});
