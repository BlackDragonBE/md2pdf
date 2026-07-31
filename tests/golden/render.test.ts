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
 * Every family a theme slot may point at. The emoji family is in the manifest
 * too, but it carries no Latin and no box drawing by design — it exists only
 * for the runs `pdf/emoji.ts` routes to it.
 */
function textFamilyIds(): string[] {
	const manifest = JSON.parse(
		readFileSync(join(import.meta.dirname, '..', '..', 'static', 'fonts', 'manifest.json'), 'utf8')
	) as Record<string, { category: string }>;
	return Object.entries(manifest)
		.filter(([, entry]) => entry.category !== 'emoji')
		.map(([id]) => id);
}

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
	const ids = textFamilyIds();

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

/**
 * A mid-sentence image used to render as nothing at all — not even its alt
 * text — because pdfmake reserves no width for a non-text node inside a `text`
 * array and never draws it. See patches/pdfmake+0.2.23.patch.
 */
/**
 * PDF has no colour-font concept, so colour emoji can only be artwork drawn
 * inline - see patches/pdfmake+0.2.23.patch. Artwork is injected here rather
 * than fetched, so these never touch the network.
 */
describe('colour emoji', () => {
	const FIRE =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path fill="#F4900C" d="M18 2s10 8 10 20a10 10 0 0 1-20 0C8 10 18 2 18 2z"/></svg>';
	const art = new Map([['\u{1F525}', FIRE]]);

	it('draws the artwork and keeps the sentence on one line', async () => {
		const { buffer } = await renderMarkdown('Before \u{1F525} after it.', { emojiArt: art });
		const out = await extract(buffer);

		// Vector, not raster: this is why SVG artwork beat a PNG sprite sheet.
		expect(buffer.includes(Buffer.from('/Subtype /Image'))).toBe(false);

		const words = out.items[0].filter((i) => i.str.trim());
		const before = words.find((i) => i.str.includes('Before'));
		const after = words.find((i) => i.str.includes('after'));
		expect(after!.transform[5]).toBeCloseTo(before!.transform[5], 1);
		expect(out.pageCount).toBe(1);
	});

	it('falls back to the monochrome font when artwork is missing', async () => {
		// No artwork supplied for this one, so it must still render as a glyph.
		const out = await renderAndExtract('Chart \u{1F4CA} here.', { emojiArt: art });
		expect(out.text).toContain('\u{1F4CA}');
	});

	it('leaves the theme own glyphs in the text font', async () => {
		const out = await renderAndExtract('Bullets • ☑ ─ and \u{1F525}.', { emojiArt: art });
		for (const glyph of ['\u2022', '\u2611', '\u2500']) expect(out.text).toContain(glyph);
	});
});

describe('mid-sentence images', () => {
	const PNG =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQaztBEmIY1TCqYfhqAABrG3wQY1e8RAAAAABJRU5ErkJggg==';
	const images = new Map<string, ResolvedImage>([
		['pic.png', { kind: 'ok', dataUri: PNG, width: 16, height: 16 }]
	]);

	it('draws the image and keeps the whole sentence on one line', async () => {
		const { buffer } = await renderMarkdown('Before ![alt](pic.png) after it.', { images });
		const out = await extract(buffer);

		expect(out.text).toContain('Before');
		expect(out.text).toContain('after');
		// The image really is embedded, not silently skipped.
		expect(buffer.includes(Buffer.from('/Subtype /Image'))).toBe(true);

		// Same baseline before and after means it flowed inline rather than
		// becoming a block or vanishing.
		const words = out.items[0].filter((i) => i.str.trim());
		const before = words.find((i) => i.str.includes('Before'));
		const after = words.find((i) => i.str.includes('after'));
		expect(before && after).toBeTruthy();
		expect(after!.transform[5]).toBeCloseTo(before!.transform[5], 1);
		// ...and it took horizontal space between them.
		expect(after!.transform[4]).toBeGreaterThan(before!.transform[4] + 30);
	});

	it('still falls back to alt text when the image failed to resolve', async () => {
		const broken = new Map<string, ResolvedImage>([
			['gone.png', { kind: 'failed', reason: 'nope' }]
		]);
		const out = await renderAndExtract('Before ![the alt](gone.png) after.', { images: broken });
		expect(out.text).toContain('the alt');
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
/**
 * `−` is a real minus sign, not the ASCII hyphen, and `≈` is what any
 * document with a calculation in it uses. Neither was in the subset ranges, so a
 * line like "BMR ≈ 10(87) − 5(37)" came out with blank boxes in it.
 */
describe('mathematical operators', () => {
	const ids = textFamilyIds();
	const MATH = '−≈≠≤≥√∞≡∑∏∫∂∆↔⇐⇒';

	it.each(ids)('%s renders every operator', async (id) => {
		const theme = cloneDefaultTheme();
		theme.fonts.body = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.heading = { source: { kind: 'builtin', id }, fallback: id };
		theme.fonts.mono = { source: { kind: 'builtin', id }, fallback: id };

		const out = await renderAndExtract(`Math: ${MATH}`, { theme });
		for (const glyph of MATH) {
			expect(out.text, `${id} lost ${glyph}`).toContain(glyph);
		}
	});

	it('renders a real calculation the way it was written', async () => {
		const out = await renderAndExtract(
			[
				'- **BMR** ≈ 10(87) + 6.25(178) − 5(37) + 5 = **1,813 kcal/day**',
				'- Deficit of ±150 kcal, 3–4×/week, ~2,490 kcal/day'
			].join('\n')
		);
		expect(out.text).toContain('≈');
		expect(out.text).toContain('−');
		expect(out.text).toContain('±');
		expect(out.text).toContain('×');
		expect(out.text).toContain('1,813 kcal/day');
	});
});

describe('box drawing', () => {
	const ids = textFamilyIds();

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

/**
 * Obsidian Flavored Markdown through the real pipeline. Callouts and the
 * footnote section are the two shapes that only exist after layout — a callout
 * is a table with an inline layout, and the notes block is appended by
 * markdown-it-footnote after every other token.
 */
describe('obsidian flavored markdown', () => {
	it('renders a callout with its title and body as text', async () => {
		const out = await renderAndExtract('> [!warning] Mind the gap\n> Do not step off.');
		expect(out.text).toContain('Mind the gap');
		expect(out.text).toContain('Do not step off.');
		expect(out.text).not.toContain('[!warning]');
	});

	it('titles an untitled callout with its type', async () => {
		const out = await renderAndExtract('> [!tip]\n> Body only.');
		expect(out.text).toContain('Tip');
		expect(out.text).toContain('Body only.');
	});

	it('draws the callout icon when the theme supplies one', async () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.callouts.types.note.icon = '✓';
		const out = await renderAndExtract('> [!note] Titled\n> Body.', { theme });
		expect(out.text).toContain('✓');
	});

	it('drops the body of a collapsed callout only when asked', async () => {
		const source = '> [!note]- Collapsed\n> Hidden body.';
		expect((await renderAndExtract(source)).text).toContain('Hidden body.');

		const theme = cloneDefaultTheme();
		theme.obsidian.callouts.showCollapsedBody = false;
		const out = await renderAndExtract(source, { theme });
		expect(out.text).toContain('Collapsed');
		expect(out.text).not.toContain('Hidden body.');
	});

	it('renders footnotes as a numbered notes section', async () => {
		const out = await renderAndExtract('Claim[^a] and another[^b].\n\n[^a]: First.\n[^b]: Second.');
		expect(out.text).toContain('Notes');
		expect(out.text).toContain('First.');
		expect(out.text).toContain('Second.');
		// Reference markers, in order of first use.
		expect(out.text.indexOf('First.')).toBeLessThan(out.text.indexOf('Second.'));
	});

	it('can start the notes section on its own page', async () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.footnotes.breakBefore = true;
		const out = await renderAndExtract('Claim[^a].\n\n[^a]: First.', { theme });
		expect(out.pageCount).toBe(2);
		expect(out.pages[1]).toContain('First.');
	});

	it('keeps a highlight as selectable text', async () => {
		const out = await renderAndExtract('This is ==important== text.');
		expect(out.text).toContain('important');
	});

	it('renders tags, and leaves things that only look like tags alone', async () => {
		const out = await renderAndExtract(
			'Filed under #project/alpha and #urgent, see #1234 and example.com#frag.'
		);
		expect(out.text).toContain('#project/alpha');
		expect(out.text).toContain('#urgent');
		expect(out.text).toContain('#1234');
		expect(out.text).toContain('example.com#frag');
	});

	it('renders a wikilink as text and keeps comments out', async () => {
		const out = await renderAndExtract('See [[Other Note|the other]] %%not this%% here. ^blk-1');
		expect(out.text).toContain('the other');
		expect(out.text).not.toContain('not this');
		expect(out.text).not.toContain('blk-1');
	});
});

/**
 * pdfmake binds one font per run and pdfkit has no glyph fallback, so an emoji
 * in a Latin-subset family is a silent blank box. The renderer cuts runs at
 * emoji boundaries and points those pieces at the bundled Noto Emoji family.
 */
describe('emoji', () => {
	it('embeds the emoji family only when the document has emoji', async () => {
		const plain = await renderAndExtract('# Just text\n\nNothing special here.');
		expect(plain.fontNames.length).toBeGreaterThan(0);

		const withEmoji = await renderAndExtract('# Heading 🏋️\n\nBody 📊 text.');
		expect(withEmoji.fontNames.length).toBeGreaterThan(plain.fontNames.length);
	});

	it('keeps the surrounding text and the emoji on the same line', async () => {
		const out = await renderAndExtract('Progress 📊 report 🎯 done ✅');
		expect(out.text).toContain('Progress');
		expect(out.text).toContain('report');
		expect(out.text).toContain('done');
		expect(out.pageCount).toBe(1);
	});

	it('renders emoji in headings, lists, tables, code and callouts', async () => {
		const source = [
			'# Heading 🚀',
			'',
			'- item 🔥',
			'- [x] task ✨',
			'',
			'| a | b |',
			'|---|---|',
			'| 💡 | 📝 |',
			'',
			'```',
			'code 🐛 line',
			'```',
			'',
			'> [!tip] Tip 💡',
			'> Body 🎯.'
		].join('\n');
		const out = await renderAndExtract(source);
		for (const word of ['Heading', 'item', 'task', 'code', 'line', 'Tip', 'Body']) {
			expect(out.text).toContain(word);
		}
		// The theme's own glyphs still come from the text font, unchanged.
		expect(out.text).toContain('☑');
	});

	it('renders emoji in the header, footer and cover', async () => {
		const theme = cloneDefaultTheme();
		theme.header.enabled = true;
		theme.header.template = 'Report 📊';
		theme.footer.template = '{{page}} 🔥 {{pages}}';
		theme.cover.enabled = true;
		const out = await renderAndExtract('# Body', {
			theme,
			meta: { title: 'Cover 🚀' }
		});
		expect(out.text).toContain('Report');
		expect(out.text).toContain('Cover');
	});

	it('leaves list bullets and tree diagrams to the text font', async () => {
		// Same document with and without an emoji: the box drawing must not move
		// to the emoji family, which has no glyph for it.
		const tree = 'Tree:\n\n```\n├── a\n└── b\n```\n';
		const plain = await renderAndExtract(tree);
		const mixed = await renderAndExtract(`${tree}\nAnd an emoji 🔥.`);
		expect(plain.text).toContain('├──');
		expect(mixed.text).toContain('├──');
		expect(mixed.text).toContain('└──');
	});
});
