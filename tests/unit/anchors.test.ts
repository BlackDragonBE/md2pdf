import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../helpers/render';
import { parse } from '../../src/lib/markdown/parse';
import { parseOpts } from '../helpers/parseOptions';

/**
 * Scroll sync maps a source line to a place in the PDF. pdfmake only reveals a
 * node's final position through the `pageBreakBefore` callback, so these assert
 * that the id round-trips and the positions are sane.
 */
describe('source-line anchors', () => {
	const doc = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n\nParagraph ${i}.`).join('\n\n');

	it('reports an anchor for the blocks it renders', async () => {
		const { anchors } = await renderMarkdown(doc);
		expect(anchors.length).toBeGreaterThan(40);
	});

	it('is sorted by line and free of duplicates', async () => {
		const { anchors } = await renderMarkdown(doc);
		const lines = anchors.map((a) => a.line);
		expect(lines).toEqual([...lines].sort((a, b) => a - b));
		expect(new Set(lines).size).toBe(lines.length);
	});

	it('maps to lines that exist in the source', async () => {
		const { anchors } = await renderMarkdown(doc);
		const lineCount = doc.split('\n').length;
		for (const anchor of anchors) {
			expect(anchor.line).toBeGreaterThanOrEqual(0);
			expect(anchor.line).toBeLessThan(lineCount);
		}
	});

	it('advances monotonically through the document', async () => {
		const { anchors } = await renderMarkdown(doc);
		let previous = { page: 0, top: 0 };
		for (const anchor of anchors) {
			const forward =
				anchor.page > previous.page || (anchor.page === previous.page && anchor.top >= previous.top);
			expect(forward, `line ${anchor.line} went backwards`).toBe(true);
			previous = { page: anchor.page, top: anchor.top };
		}
	});

	it('spans every page of a multi-page document', async () => {
		const { anchors, buffer } = await renderMarkdown(doc);
		expect(buffer.length).toBeGreaterThan(0);
		const pages = new Set(anchors.map((a) => a.page));
		expect(pages.size).toBeGreaterThan(1);
		expect(Math.min(...pages)).toBe(1);
	});

	it('lines up with the tokens the parser produced', async () => {
		const { anchors } = await renderMarkdown(doc);
		const sourceLines = new Set(
			parse(doc, parseOpts())
				.tokens.filter((t) => t.map)
				.map((t) => t.map![0])
		);
		for (const anchor of anchors) {
			expect(sourceLines.has(anchor.line), `line ${anchor.line} is not a block start`).toBe(true);
		}
	});

	it('keeps positions inside the page box', async () => {
		const { anchors } = await renderMarkdown(doc);
		for (const anchor of anchors) {
			expect(anchor.top).toBeGreaterThanOrEqual(0);
			expect(anchor.top).toBeLessThan(842); // A4 height in points
		}
	});
});
