import { describe, expect, it } from 'vitest';
import { extract, extractNavigation, renderAndExtract, renderMarkdown } from '../helpers/render';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';
import type { Theme } from '../../src/lib/theme/schema';

/**
 * Navigation is the part of the PDF that carries no ink: bookmarks, the
 * contents page and internal links. Text extraction alone would pass with all
 * three broken, so these read the outline and the link annotations directly.
 */

const DOC = [
	'# Introduction',
	'',
	'See [the appendix](#appendix) for the details.',
	'',
	'## Scope',
	'',
	'Body text.',
	'',
	'### Out of scope',
	'',
	'Body text.',
	'',
	'# Appendix',
	'',
	'Body text.',
	''
].join('\n');

function themed(patch: (t: Theme) => void): Theme {
	const t = cloneDefaultTheme();
	patch(t);
	return t;
}

describe('PDF bookmarks', () => {
	it('nests one item per heading, in document order', async () => {
		const { buffer } = await renderMarkdown(DOC);
		const { outline } = await extractNavigation(buffer);

		expect(outline).toEqual([
			{ title: 'Introduction', depth: 0, page: 1 },
			{ title: 'Scope', depth: 1, page: 1 },
			{ title: 'Out of scope', depth: 2, page: 1 },
			{ title: 'Appendix', depth: 0, page: 1 }
		]);
	});

	it('points each bookmark at the page the heading landed on', async () => {
		const source = `# First\n\ntext\n\n<!--break-->\n\n# Second\n\ntext\n`;
		const theme = themed((t) => (t.pagebreak.marker = '<!--break-->'));
		const { buffer } = await renderMarkdown(source, { theme });
		const { outline } = await extractNavigation(buffer);

		expect(outline.map((o) => [o.title, o.page])).toEqual([
			['First', 1],
			['Second', 2]
		]);
	});

	it('treats a document starting at h2 as a flat tree, not a nested one', async () => {
		const { buffer } = await renderMarkdown('## One\n\n## Two\n');
		const { outline } = await extractNavigation(buffer);
		expect(outline.map((o) => o.depth)).toEqual([0, 0]);
	});

	it('carries the heading number when numbering is on', async () => {
		const theme = themed((t) => (t.headings.numbered = true));
		const { buffer } = await renderMarkdown(DOC, { theme });
		const { outline } = await extractNavigation(buffer);
		expect(outline.map((o) => o.title)).toEqual([
			'1 Introduction',
			'1.1 Scope',
			'1.1.1 Out of scope',
			'2 Appendix'
		]);
	});

	it('produces no outline for a document with no headings', async () => {
		const { buffer } = await renderMarkdown('Just a paragraph.\n');
		expect((await extractNavigation(buffer)).outline).toEqual([]);
	});
});

describe('internal links', () => {
	it('turns [text](#slug) into a jump inside the document', async () => {
		const { buffer } = await renderMarkdown(DOC);
		const { links } = await extractNavigation(buffer);
		// One annotation per laid-out word, as pdfmake does for external links
		// too. `L12` is the source line the Appendix heading sits on.
		expect(links.length).toBeGreaterThan(0);
		expect(new Set(links.map((l) => `${l.page}:${l.dest}`))).toEqual(new Set(['1:L12']));
	});

	it('leaves an anchor no heading matches without a dead external link', async () => {
		const { buffer } = await renderMarkdown('# One\n\n[nowhere](#nowhere)\n');
		const { links } = await extractNavigation(buffer);
		expect(links).toEqual([]);
	});

	it('still styles an external link as a link', async () => {
		const out = await renderAndExtract('[example](https://example.com)\n');
		expect(out.text).toContain('example');
	});

	it('resolves an anchor written the way Obsidian writes it', async () => {
		// Obsidian links to a heading by its text, not by a GitHub slug.
		const { buffer } = await renderMarkdown('# My Heading\n\n[go](#My%20Heading)\n');
		const { links } = await extractNavigation(buffer);
		expect(new Set(links.map((l) => l.dest))).toEqual(new Set(['L0']));
	});
});

describe('Obsidian internal links', () => {
	it('makes [[#Heading]] a jump to that heading', async () => {
		const { buffer } = await renderMarkdown(
			'# Overview\n\ntext\n\n## Details\n\nSee [[#Details]].\n'
		);
		const { links } = await extractNavigation(buffer);
		expect(new Set(links.map((l) => l.dest))).toEqual(new Set(['L4']));
	});

	it('ignores case and spacing in the heading reference', async () => {
		const { buffer } = await renderMarkdown('# The  Overview\n\nSee [[#the overview]].\n');
		const { links } = await extractNavigation(buffer);
		expect(new Set(links.map((l) => l.dest))).toEqual(new Set(['L0']));
	});

	it('makes [[#^block-id]] a jump to the block it marks', async () => {
		const source = '# One\n\nSee [[#^target]].\n\nThe block being referenced. ^target\n';
		const { buffer } = await renderMarkdown(source);
		const { links } = await extractNavigation(buffer);
		expect(new Set(links.map((l) => l.dest))).toEqual(new Set(['L4']));
	});

	it('keeps a block reference distinct from a heading of the same name', async () => {
		// `[[#intro]]` and `[[#^intro]]` name different things; stripping the `^`
		// during parsing used to make them the same reference.
		const source = '# intro\n\n[[#intro]] and [[#^intro]]\n\nA marked block. ^intro\n';
		const { buffer } = await renderMarkdown(source);
		const { links } = await extractNavigation(buffer);
		expect(new Set(links.map((l) => l.dest))).toEqual(new Set(['L0', 'L4']));
	});

	it('uses the alias for the text and still links', async () => {
		const out = await renderAndExtract('# Details\n\nSee [[#Details|the details]].\n');
		expect(out.text).toContain('the details');
		expect(out.text).not.toContain('[[');
	});

	it('leaves a link into another note inert, having no vault to reach it', async () => {
		const { buffer } = await renderMarkdown('# Details\n\nSee [[Other#Details]].\n');
		const { links } = await extractNavigation(buffer);
		expect(links).toEqual([]);
	});

	it('leaves a reference to a heading this document lacks inert', async () => {
		const { buffer } = await renderMarkdown('# One\n\nSee [[#Nowhere]].\n');
		const { links } = await extractNavigation(buffer);
		expect(links).toEqual([]);
	});
});

describe('heading numbering', () => {
	it('prints the number before the heading text', async () => {
		const theme = themed((t) => (t.headings.numbered = true));
		const out = await renderAndExtract(DOC, { theme });
		expect(out.text).toContain('1 Introduction');
		expect(out.text).toContain('1.1.1 Out of scope');
	});

	it('prints nothing extra when it is off', async () => {
		const out = await renderAndExtract(DOC);
		expect(out.text).not.toMatch(/1\s+Introduction/);
	});
});

describe('table of contents', () => {
	const withToc = (patch: (t: Theme) => void = () => {}) =>
		themed((t) => {
			t.toc.enabled = true;
			patch(t);
		});

	it('puts a contents page before the body, with one entry per heading', async () => {
		const { buffer } = await renderMarkdown(DOC, { theme: withToc() });
		const { pages } = await extract(buffer);

		expect(pages[0]).toContain('Contents');
		expect(pages[0]).toContain('Introduction');
		expect(pages[0]).toContain('Scope');
		expect(pages[0]).toContain('Appendix');
		expect(pages[1]).toContain('Body text.');
	});

	it('prints the page each heading actually starts on', async () => {
		const source = `# First\n\ntext\n\n<!--break-->\n\n# Second\n\ntext\n`;
		const theme = withToc((t) => (t.pagebreak.marker = '<!--break-->'));
		const { buffer } = await renderMarkdown(source, { theme });
		const { pages } = await extract(buffer);

		// Contents is page 1, so the body starts at 2 and the break puts Second on 3.
		expect(pages[0]).toMatch(/First\s*2/);
		expect(pages[0]).toMatch(/Second\s*3/);
	});

	it('honours the depth limit', async () => {
		const { buffer } = await renderMarkdown(DOC, { theme: withToc((t) => (t.toc.depth = 1)) });
		const { pages } = await extract(buffer);

		expect(pages[0]).toContain('Introduction');
		expect(pages[0]).not.toContain('Out of scope');
	});

	it('renders entries at the contents size, not the heading size', async () => {
		const theme = withToc((t) => {
			t.elements.tocEntry.size = 9;
			t.elements.h1.size = 30;
		});
		const { buffer } = await renderMarkdown(DOC, { theme });
		const { items } = await extract(buffer);

		// The `h1` style leaking into the TOC line was the failure mode here: the
		// entry text is the same run array the heading renders with.
		const entry = items[0].find((i) => i.str.includes('Introduction'));
		expect(entry).toBeDefined();
		expect(entry!.transform[0]).toBeCloseTo(9, 1);
	});

	it('makes every entry a link to its heading', async () => {
		const { buffer } = await renderMarkdown(DOC, { theme: withToc() });
		const { links } = await extractNavigation(buffer);
		const fromToc = links.filter((l) => l.page === 1).map((l) => l.dest);
		expect(new Set(fromToc)).toEqual(new Set(['L0', 'L4', 'L8', 'L12']));
	});

	it('keeps the body on the same page when the break after is off', async () => {
		const theme = withToc((t) => (t.toc.pageBreakAfter = false));
		const { buffer } = await renderMarkdown(DOC, { theme });
		const { pages, pageCount } = await extract(buffer);

		expect(pageCount).toBe(1);
		expect(pages[0]).toContain('Body text.');
	});

	it('adds nothing at all when it is off', async () => {
		const out = await renderAndExtract(DOC);
		expect(out.text).not.toContain('Contents');
		expect(out.pageCount).toBe(1);
	});
});
