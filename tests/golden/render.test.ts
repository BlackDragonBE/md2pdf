import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	extract,
	itemAngle,
	renderAndExtract,
	renderMarkdown,
	type TextItemGeometry
} from '../helpers/render';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';
import { importTheme } from '../../src/lib/theme/io';
import { PRESETS } from '../../src/lib/theme/presets';
import type { ResolvedImage } from '../../src/lib/pdf/images';
import type { Theme } from '../../src/lib/theme/schema';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * Structure only — page counts, text content, break positions. Never pixels:
 * pixel comparison is flaky across pdfkit versions (§14).
 */
describe('kitchen sink', () => {
	let text: string;
	let pages: string[];

	beforeAll(async () => {
		const out = await renderAndExtract(fixture('kitchen-sink.md'));
		text = out.text;
		pages = out.pages;
	});

	it('renders every heading level', () => {
		for (const heading of [
			'Level one heading',
			'Level two heading',
			'Level three heading',
			'Level four heading',
			'Level five heading',
			'Level six heading'
		]) {
			expect(text).toContain(heading);
		}
	});

	it('renders inline formatting as selectable text, not images', () => {
		expect(text).toContain('bold');
		expect(text).toContain('italic');
		expect(text).toContain('struck');
		expect(text).toContain('inline code');
		expect(text).toContain('link');
	});

	it('renders list content including nesting', () => {
		expect(text).toContain('First bullet');
		expect(text).toContain('Doubly nested bullet');
		expect(text).toContain('Third ordered');
	});

	it('renders task-list glyphs from the theme', () => {
		const t = cloneDefaultTheme();
		expect(text).toContain(t.list.taskChecked);
		expect(text).toContain(t.list.taskUnchecked);
		expect(text).toContain('Completed task');
		expect(text).toContain('Outstanding task');
	});

	it('renders blockquote and code-block content', () => {
		expect(text).toContain('A blockquote with');
		expect(text).toContain('export function pageOffset');
		expect(text).toContain('an indented code block');
	});

	it('renders table cells including alignment columns', () => {
		expect(text).toContain('Column A');
		expect(text).toContain('centre');
		expect(text).toContain('three');
	});

	it('does not leak front matter into the body', () => {
		expect(text).not.toContain('subtitle:');
		expect(text).not.toContain('---');
	});

	it('puts the footer page number on the page', () => {
		expect(pages[0]).toMatch(/1 \/ \d/);
	});
});

describe('page-break marker', () => {
	it('keeps a marker inside a fence literal and breaks on the real one', async () => {
		const out = await renderAndExtract(fixture('marker-in-fence.md'));
		expect(out.pageCount).toBe(2);
		// The fenced copy stays on page one as text…
		expect(out.pages[0]).toContain('\\pagebreak');
		// …and the standalone marker actually broke the page.
		expect(out.pages[0]).toContain('Before the fence');
		expect(out.pages[1]).toContain('After the break');
		expect(out.pages[1]).not.toContain('Before the fence');
	});

	it('follows a changed marker', async () => {
		const theme = cloneDefaultTheme();
		theme.pagebreak.marker = '<<<break>>>';
		const source = 'page one\n\n<<<break>>>\n\npage two';
		const out = await renderAndExtract(source, { theme });
		expect(out.pageCount).toBe(2);
		expect(out.pages[1]).toContain('page two');

		// The default marker must be inert once the theme has changed it.
		const inert = await renderAndExtract('page one\n\n\\pagebreak\n\npage two', { theme });
		expect(inert.pageCount).toBe(1);
	});
});

describe('cover page and numbering', () => {
	function coverTheme(exclude: boolean): Theme {
		const t = cloneDefaultTheme();
		t.cover.enabled = true;
		t.cover.excludeFromPageCount = exclude;
		t.footer.enabled = true;
		t.footer.template = '{{page}} / {{pages}}';
		return t;
	}

	const source = 'body one\n\n\\pagebreak\n\nbody two';

	it('adds a page for the cover and keeps it free of the footer', async () => {
		const out = await renderAndExtract(source, {
			theme: coverTheme(true),
			meta: { title: 'Cover Title' }
		});
		expect(out.pageCount).toBe(3); // cover + two content pages
		expect(out.pages[0]).toContain('Cover Title');
		expect(out.pages[0]).not.toMatch(/\d \/ \d/);
	});

	it('numbers content pages 1..N when the cover is excluded', async () => {
		const out = await renderAndExtract(source, {
			theme: coverTheme(true),
			meta: { title: 'Cover Title' }
		});
		expect(out.pages[1]).toContain('1 / 2');
		expect(out.pages[2]).toContain('2 / 2');
	});

	it('numbers content pages 2..N+1 when the cover counts', async () => {
		const out = await renderAndExtract(source, {
			theme: coverTheme(false),
			meta: { title: 'Cover Title' }
		});
		expect(out.pages[1]).toContain('2 / 3');
		expect(out.pages[2]).toContain('3 / 3');
	});

	it('renders every configured cover block that has content', async () => {
		const out = await renderAndExtract('body', {
			theme: coverTheme(true),
			meta: { title: 'T', subtitle: 'S', author: 'A', date: '2024-03-05' }
		});
		expect(out.pages[0]).toContain('T');
		expect(out.pages[0]).toContain('S');
		expect(out.pages[0]).toContain('A');
		expect(out.pages[0]).toContain('March 5, 2024');
	});
});

describe('running header and footer', () => {
	it('substitutes metadata into both bands', async () => {
		const theme = cloneDefaultTheme();
		theme.header.enabled = true;
		theme.header.template = '{{title}} · {{author}}';
		theme.footer.template = 'p{{page}} of {{pages}}';
		const out = await renderAndExtract('content', {
			theme,
			meta: { title: 'Doc', author: 'Ann' }
		});
		expect(out.pages[0]).toContain('Doc · Ann');
		expect(out.pages[0]).toContain('p1 of 1');
	});

	it('omits the first-page band when showOnFirstContentPage is false', async () => {
		const theme = cloneDefaultTheme();
		theme.header.enabled = true;
		theme.header.template = 'HEADERMARK';
		theme.header.showOnFirstContentPage = false;
		const out = await renderAndExtract('one\n\n\\pagebreak\n\ntwo', { theme });
		expect(out.pages[0]).not.toContain('HEADERMARK');
		expect(out.pages[1]).toContain('HEADERMARK');
	});
});

describe('watermark', () => {
	it('appears on every content page', async () => {
		const theme = cloneDefaultTheme();
		theme.watermark.enabled = true;
		theme.watermark.text = 'CONFIDENTIAL';
		const out = await renderAndExtract('one\n\n\\pagebreak\n\ntwo', { theme });
		expect(out.pageCount).toBe(2);
		for (const page of out.pages) expect(page).toContain('CONFIDENTIAL');
	});

	it('is absent when disabled', async () => {
		const out = await renderAndExtract('one', { theme: cloneDefaultTheme() });
		expect(out.text).not.toContain('DRAFT');
	});

	/**
	 * The angle has to be read out of the PDF, not merely configured: pdfmake
	 * ignores `angle` on ordinary text nodes, so a watermark built that way
	 * renders horizontally and every text-content assertion still passes.
	 */
	it.each([-45, -30, 0, 30, 60])('is rotated by the configured %i degrees', async (angle) => {
		const theme = cloneDefaultTheme();
		theme.watermark.enabled = true;
		theme.watermark.text = 'ROTATED';
		theme.watermark.angle = angle;

		const out = await renderAndExtract('body text', { theme });
		const mark = out.items[0].find((item) => item.str.includes('ROTATED'));
		expect(mark, 'watermark text missing from page 1').toBeDefined();
		// pdf.js reports the rotation as the negative of pdfkit's clockwise angle.
		expect(Math.abs(itemAngle(mark as TextItemGeometry))).toBe(Math.abs(angle));
	});

	it('leaves body text unrotated', async () => {
		const theme = cloneDefaultTheme();
		theme.watermark.enabled = true;
		theme.watermark.angle = -45;
		const out = await renderAndExtract('unrotated body copy', { theme });
		// pdf.js splits a line into several items, so match a single word.
		const body = out.items[0].find((item) => item.str.includes('unrotated'));
		expect(body, 'body text missing from page 1').toBeDefined();
		expect(itemAngle(body as TextItemGeometry)).toBe(0);
	});
});

describe('images', () => {
	it('renders a placeholder and a warning instead of aborting on broken images', async () => {
		const images = new Map<string, ResolvedImage>([
			[
				'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
				{
					kind: 'ok',
					dataUri:
						'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
					width: 1,
					height: 1
				}
			],
			['./diagram.png', { kind: 'failed', reason: 'relative path' }],
			['https://example.invalid/missing.png', { kind: 'failed', reason: 'network' }]
		]);
		const out = await renderAndExtract(fixture('images.md'), { images });
		expect(out.pageCount).toBeGreaterThanOrEqual(1);
		// Alt text stands in for the images that could not load.
		expect(out.text).toContain('local diagram');
		expect(out.text).toContain('remote');
		expect(out.text).toContain('Trailing text');
	});
});

describe('orphan control', () => {
	it('never leaves a keepWithNext heading as the last thing on a page', async () => {
		// Fill a page almost exactly, then a heading, then body text.
		const filler = Array.from({ length: 34 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
		const source = `${filler}\n\n## Stranded heading\n\nBody that must follow the heading.`;
		const out = await renderAndExtract(source);

		const headingPage = out.pages.findIndex((p) => p.includes('Stranded heading'));
		expect(headingPage).toBeGreaterThanOrEqual(0);
		const page = out.pages[headingPage];
		const afterHeading = page.slice(page.indexOf('Stranded heading') + 'Stranded heading'.length);
		// Something other than the footer must follow it on the same page.
		expect(afterHeading.replace(/\d+ \/ \d+/g, '').trim().length).toBeGreaterThan(0);
	});
});

describe('presets and page geometry', () => {
	it.each(PRESETS.map((p) => [p.name, p.theme] as const))(
		'renders the kitchen sink under the %s preset',
		async (_name, raw) => {
			const { theme, warnings } = importTheme(raw);
			expect(warnings.filter((w) => !w.startsWith('Unknown top-level'))).toEqual([]);
			const out = await renderAndExtract(fixture('kitchen-sink.md'), { theme });
			expect(out.pageCount).toBeGreaterThanOrEqual(1);
			expect(out.text).toContain('Level one heading');
			expect(out.text).toContain('Trailing paragraph');
		}
	);

	it.each(['A3', 'A4', 'A5', 'LETTER', 'LEGAL', 'TABLOID'] as const)(
		'renders at page size %s',
		async (size) => {
			const theme = cloneDefaultTheme();
			theme.page.size = size;
			const out = await renderAndExtract('# Title\n\nBody.', { theme });
			expect(out.text).toContain('Title');
		}
	);

	it('renders in landscape', async () => {
		const theme = cloneDefaultTheme();
		theme.page.orientation = 'landscape';
		const out = await renderAndExtract('# Wide\n\nBody.', { theme });
		expect(out.text).toContain('Wide');
	});
});

describe('every bundled family survives emphasis', () => {
	const ids = Object.keys(
		JSON.parse(
			readFileSync(join(import.meta.dirname, '..', '..', 'static', 'fonts', 'manifest.json'), 'utf8')
		) as Record<string, unknown>
	);

	it.each(ids)('%s renders all four faces without throwing', async (id) => {
		const theme = cloneDefaultTheme();
		theme.fonts.body = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.heading = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.mono = { source: { kind: 'builtin', id }, fallback: id };

		const source = [
			'# Heading',
			'',
			'Regular, **bold**, *emphasis*, ***bold emphasis***, `mono`.',
			'',
			'- • bullet ◦ ▪',
			'- [x] checked',
			'- [ ] unchecked'
		].join('\n');

		const out = await renderAndExtract(source, { theme });
		expect(out.pageCount).toBe(1);
		expect(out.text).toContain('bold emphasis');
		expect(out.text).toContain(theme.list.taskChecked);
		expect(out.text).toContain(theme.list.taskUnchecked);
	});
});

describe('stress document', () => {
	it('renders past sixty pages with a consistent final page number', async () => {
		const { buffer } = await renderMarkdown(fixture('stress-60-pages.md'));
		const out = await extract(buffer);
		expect(out.pageCount).toBeGreaterThan(20);
		expect(out.pages[out.pageCount - 1]).toContain(`${out.pageCount} / ${out.pageCount}`);
		expect(out.text).toContain('Section 120');
	});
});

describe('code blocks', () => {
	it('renders line numbers when enabled', async () => {
		const theme = cloneDefaultTheme();
		theme.code.showLineNumbers = true;
		const out = await renderAndExtract('```\nalpha\nbravo\ncharlie\n```', { theme });
		expect(out.text).toContain('alpha');
		expect(out.text).toContain('3');
	});

	it('keeps the source intact with syntax highlighting on', async () => {
		const theme = cloneDefaultTheme();
		theme.code.syntaxHighlight = true;
		const out = await renderAndExtract('```js\nconst answer = 42;\n```', { theme });
		expect(out.text).toContain('const');
		expect(out.text).toContain('answer');
		expect(out.text).toContain('42');
	});
});

describe('generated documents are text, not raster', () => {
	it('embeds subsetted fonts and selectable text', async () => {
		const { buffer } = await renderMarkdown('# Searchable\n\nFind me.');
		const out = await extract(buffer);
		expect(out.text).toContain('Find me.');
		expect(out.fontNames.length).toBeGreaterThan(0);
		// No image XObject means nothing was rasterised.
		expect(buffer.includes(Buffer.from('/Subtype /Image'))).toBe(false);
	});
});

/**
 * Box-drawing characters were absent from the subset ranges entirely, so every
 * `tree`-style diagram rendered as blank boxes in every family.
 */
describe('box drawing', () => {
	const ids = Object.keys(
		JSON.parse(
			readFileSync(join(import.meta.dirname, '..', '..', 'static', 'fonts', 'manifest.json'), 'utf8')
		) as Record<string, unknown>
	);

	const BOX = '─│┌┐└┘├┤┬┴┼';

	it.each(ids)('%s renders every box-drawing glyph', async (id) => {
		const theme = cloneDefaultTheme();
		theme.fonts.body = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.heading = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.mono = { source: { kind: 'builtin', id }, fallback: id };

		const out = await renderAndExtract(`Tree: ${BOX}`, { theme });
		for (const glyph of BOX) {
			expect(out.text, `${id} lost ${glyph}`).toContain(glyph);
		}
	});

	it('renders a full tree diagram inside a fence', async () => {
		const out = await renderAndExtract(fixture('tree-diagram.md'));
		expect(out.text).toContain('├──');
		expect(out.text).toContain('└──');
		expect(out.text).toContain('│');
		expect(out.text).toContain('manifest.json');
	});
});
