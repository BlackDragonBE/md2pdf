import { describe, expect, it } from 'vitest';
import { EMPTY_META, type DocMeta } from '../../src/lib/markdown/frontmatter';
import {
	footerFor,
	formatDate,
	headerFor,
	isCoverPage,
	pageOffset,
	substitute,
	templateValues
} from '../../src/lib/pdf/headerFooter';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';
import type { PageSize, TextNode } from '../../src/lib/pdf/pdfmake-types';
import type { FontMap } from '../../src/lib/pdf/styles';

const FONTS: FontMap = { body: 'B', heading: 'H', mono: 'M' };
const PAGE: PageSize = { width: 595.28, height: 841.89 };
const META: DocMeta = {
	title: 'Title',
	subtitle: 'Sub',
	author: 'Author',
	date: '2024-03-05'
};

function values(page: number, pages: number) {
	return templateValues(META, cloneDefaultTheme(), page, pages);
}

describe('substitute', () => {
	it('replaces the whitelisted tokens', () => {
		expect(substitute('{{page}} / {{pages}}', values(2, 7))).toBe('2 / 7');
		expect(substitute('{{title}} — {{author}}', values(1, 1))).toBe('Title — Author');
		expect(substitute('{{subtitle}}', values(1, 1))).toBe('Sub');
	});

	it('tolerates whitespace inside the braces', () => {
		expect(substitute('{{ page }}/{{  pages  }}', values(3, 9))).toBe('3/9');
	});

	it('renders an unknown token literally and warns', () => {
		const warnings = new Set<string>();
		expect(substitute('{{nope}}', values(1, 1), warnings)).toBe('{{nope}}');
		expect([...warnings].join(' ')).toMatch(/Unknown template token/);
	});

	it('does not evaluate expressions or property access', () => {
		const warnings = new Set<string>();
		expect(substitute('{{page.toString}}', values(1, 1), warnings)).toBe('{{page.toString}}');
		expect(substitute('{{1+1}}', values(1, 1), warnings)).toBe('{{1+1}}');
	});
});

describe('formatDate', () => {
	it('formats an ISO date with the theme locale', () => {
		expect(formatDate('2024-03-05', 'en-GB')).toBe('5 March 2024');
		expect(formatDate('2024-03-05', 'de-DE')).toBe('5. März 2024');
	});

	it('falls back to en-GB for an invalid locale', () => {
		expect(formatDate('2024-03-05', 'not a locale')).toBe('5 March 2024');
	});

	it('returns unparseable input unchanged', () => {
		expect(formatDate('sometime', 'en-GB')).toBe('sometime');
	});

	it('uses today when the date is empty', () => {
		expect(formatDate('', 'en-GB')).toBe(
			new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date())
		);
	});
});

/** Getting this wrong is the classic bug in this feature (§12.1). */
describe('cover page numbering', () => {
	function footerText(page: number, pageCount: number, cover: boolean, exclude: boolean) {
		const t = cloneDefaultTheme();
		t.cover.enabled = cover;
		t.cover.excludeFromPageCount = exclude;
		const node = footerFor(page, pageCount, PAGE, t, META, FONTS, new Set());
		if (!node) return null;
		return (node as TextNode).text as string;
	}

	it('offsets by one when the cover is excluded', () => {
		const t = cloneDefaultTheme();
		t.cover.enabled = true;
		t.cover.excludeFromPageCount = true;
		expect(pageOffset(t)).toBe(1);
	});

	it('offsets by zero when the cover counts', () => {
		const t = cloneDefaultTheme();
		t.cover.enabled = true;
		t.cover.excludeFromPageCount = false;
		expect(pageOffset(t)).toBe(0);
	});

	it('offsets by zero with no cover at all', () => {
		expect(pageOffset(cloneDefaultTheme())).toBe(0);
	});

	it('suppresses the footer entirely on the cover', () => {
		expect(footerText(1, 5, true, true)).toBeNull();
		expect(footerText(1, 5, true, false)).toBeNull();
	});

	it('numbers the first content page 1 of 4 when the cover is excluded', () => {
		// 5 physical pages: cover + 4 content.
		expect(footerText(2, 5, true, true)).toBe('1 / 4');
		expect(footerText(5, 5, true, true)).toBe('4 / 4');
	});

	it('numbers the first content page 2 of 5 when the cover counts', () => {
		expect(footerText(2, 5, true, false)).toBe('2 / 5');
		expect(footerText(5, 5, true, false)).toBe('5 / 5');
	});

	it('numbers normally with no cover', () => {
		expect(footerText(1, 4, false, true)).toBe('1 / 4');
		expect(footerText(4, 4, false, true)).toBe('4 / 4');
	});

	it('knows which physical page is the cover', () => {
		const t = cloneDefaultTheme();
		t.cover.enabled = true;
		expect(isCoverPage(1, t)).toBe(true);
		expect(isCoverPage(2, t)).toBe(false);
		t.cover.enabled = false;
		expect(isCoverPage(1, t)).toBe(false);
	});
});

describe('header and footer nodes', () => {
	it('returns nothing when disabled', () => {
		const t = cloneDefaultTheme();
		expect(headerFor(1, 3, PAGE, t, META, FONTS, new Set())).toBeUndefined();
	});

	it('honours showOnFirstContentPage', () => {
		const t = cloneDefaultTheme();
		t.header.enabled = true;
		t.header.showOnFirstContentPage = false;
		expect(headerFor(1, 3, PAGE, t, META, FONTS, new Set())).toBeUndefined();
		expect(headerFor(2, 3, PAGE, t, META, FONTS, new Set())).toBeDefined();
	});

	it('maps the offset onto the page-edge-relative margin', () => {
		const t = cloneDefaultTheme();
		t.header.enabled = true;
		t.header.offset = 22;
		const node = headerFor(1, 3, PAGE, t, META, FONTS, new Set()) as TextNode;
		expect(node.margin).toEqual([t.page.margins[0], 22, t.page.margins[2], 0]);

		t.footer.offset = 19;
		const foot = footerFor(1, 3, PAGE, t, META, FONTS, new Set()) as TextNode;
		expect(foot.margin).toEqual([t.page.margins[0], 0, t.page.margins[2], 19]);
	});

	it('wraps the label in a stack when a rule line is enabled', () => {
		const t = cloneDefaultTheme();
		t.footer.enabled = true;
		t.footer.rule.enabled = true;
		const node = footerFor(1, 3, PAGE, t, META, FONTS, new Set());
		expect(node).toHaveProperty('stack');
	});

	it('resolves the font slot to the registered family name', () => {
		const t = cloneDefaultTheme();
		t.header.enabled = true;
		t.header.font = 'mono';
		const node = headerFor(1, 3, PAGE, t, META, FONTS, new Set()) as TextNode;
		expect(node.font).toBe('M');
	});

	it('renders empty metadata as an empty string, not "undefined"', () => {
		const t = cloneDefaultTheme();
		t.header.enabled = true;
		t.header.template = '{{title}}';
		const node = headerFor(1, 3, PAGE, t, EMPTY_META, FONTS, new Set()) as TextNode;
		expect(node.text).toBe('');
	});
});
