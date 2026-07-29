import { describe, expect, it } from 'vitest';
import { parse } from '../../src/lib/markdown/parse';
import { coalesce, renderInline, type InlineContext } from '../../src/lib/pdf/inline';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';
import type { TextRun } from '../../src/lib/pdf/pdfmake-types';

function ctx(): InlineContext {
	return {
		theme: cloneDefaultTheme(),
		fonts: { body: 'B', heading: 'H', mono: 'M' },
		warnings: new Set<string>(),
		images: new Map(),
		contentWidth: 483
	};
}

function runs(markdown: string, c = ctx()): TextRun[] {
	const inline = parse(markdown, '\\pagebreak').tokens.find((t) => t.type === 'inline');
	return coalesce(renderInline(inline?.children, 'paragraph', c)) as TextRun[];
}

function find(list: TextRun[], text: string): TextRun {
	const hit = list.find((r) => r.text === text);
	if (!hit) throw new Error(`no run with text ${JSON.stringify(text)} in ${JSON.stringify(list)}`);
	return hit;
}

describe('nested inline formatting', () => {
	it('composes bold and italic into one run', () => {
		const out = runs('***both***');
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ text: 'both', bold: true, italics: true });
	});

	it('composes bold wrapping italic', () => {
		const out = runs('**bold *and italic***');
		expect(find(out, 'bold ')).toMatchObject({ bold: true });
		expect(find(out, 'bold ').italics).toBeUndefined();
		expect(find(out, 'and italic')).toMatchObject({ bold: true, italics: true });
	});

	it('composes italic wrapping bold', () => {
		const out = runs('*italic **and bold***');
		expect(find(out, 'italic ')).toMatchObject({ italics: true });
		expect(find(out, 'and bold')).toMatchObject({ bold: true, italics: true });
	});

	it('closes formatting so following text is plain', () => {
		const out = runs('**bold** plain');
		expect(find(out, 'bold').bold).toBe(true);
		expect(find(out, ' plain').bold).toBeUndefined();
	});

	it('composes strikethrough with bold', () => {
		const out = runs('~~**both**~~');
		expect(out[0]).toMatchObject({ bold: true, decoration: 'lineThrough' });
	});

	it('composes formatting inside a link', () => {
		const out = runs('[**bold link**](https://example.com)');
		expect(out[0]).toMatchObject({
			text: 'bold link',
			bold: true,
			link: 'https://example.com'
		});
	});

	it('handles three levels of nesting', () => {
		const out = runs('*a **b ~~c~~** d*');
		expect(find(out, 'c')).toMatchObject({ italics: true, bold: true, decoration: 'lineThrough' });
		expect(find(out, ' d')).toMatchObject({ italics: true });
		expect(find(out, ' d').bold).toBeUndefined();
	});
});

describe('inline node mapping', () => {
	it('gives inline code its own style and background', () => {
		const c = ctx();
		const out = runs('`code`', c);
		expect(out[0]).toMatchObject({
			text: 'code',
			style: 'inlineCode',
			background: c.theme.code.background
		});
	});

	it('applies the theme link colour and underline setting', () => {
		const c = ctx();
		c.theme.link.underline = true;
		c.theme.link.color = '#ff0000';
		const out = runs('[x](https://e.com)', c);
		expect(out[0]).toMatchObject({ color: '#ff0000', decoration: 'underline' });
	});

	it('renders a soft break as a space and a hard break as a newline', () => {
		expect(runs('one\ntwo').map((r) => r.text).join('')).toBe('one two');
		expect(runs('one  \ntwo').map((r) => r.text).join('')).toContain('\n');
	});

	it('keeps raw HTML as literal text rather than emitting an html token', () => {
		// `html: false` makes markdown-it escape rather than tokenise, so nothing
		// reaches the renderer as html_inline in the first place (§6.1).
		const c = ctx();
		const tokens = parse('text <b>x</b> more', '\\pagebreak').tokens;
		const inline = tokens.find((t) => t.type === 'inline');
		expect(inline?.children?.some((child) => child.type === 'html_inline')).toBe(false);
		expect(runs('text <b>x</b> more', c).map((r) => r.text).join('')).toBe('text <b>x</b> more');
	});

	it('drops an html_inline token with a warning if one ever appears', () => {
		const c = ctx();
		// Synthesised: the parser cannot produce this, but the renderer must not
		// leak markup if a future plugin does.
		const token = { type: 'html_inline', content: '<script>alert(1)</script>' } as never;
		const out = renderInline([token], 'paragraph', c);
		expect(out).toEqual([]);
		expect([...c.warnings].join(' ')).toMatch(/Inline HTML was dropped/);
	});
});

describe('task list checkboxes', () => {
	function itemText(markdown: string, c = ctx()): string {
		const tokens = parse(markdown, '\\pagebreak').tokens;
		const inline = tokens.find((t) => t.type === 'inline');
		return (coalesce(renderInline(inline?.children, 'listItem', c)) as TextRun[])
			.map((r) => r.text)
			.join('');
	}

	it('substitutes the theme glyph for a checked box', () => {
		const c = ctx();
		expect(itemText('- [x] done', c)).toBe(`${c.theme.list.taskChecked} done`);
	});

	it('substitutes the theme glyph for an unchecked box', () => {
		const c = ctx();
		expect(itemText('- [ ] todo', c)).toBe(`${c.theme.list.taskUnchecked} todo`);
	});

	it('honours a custom glyph', () => {
		const c = ctx();
		c.theme.list.taskChecked = '[X]';
		expect(itemText('- [x] done', c)).toBe('[X] done');
	});

	it('does not warn about dropped HTML for a checkbox', () => {
		const c = ctx();
		itemText('- [x] done', c);
		expect([...c.warnings]).toEqual([]);
	});
});

describe('coalesce', () => {
	it('merges adjacent runs with identical formatting', () => {
		const merged = coalesce([
			{ text: 'a', style: 'p' },
			{ text: 'b', style: 'p' },
			{ text: 'c', style: 'p', bold: true }
		]) as TextRun[];
		expect(merged).toHaveLength(2);
		expect(merged[0].text).toBe('ab');
	});

	it('keeps runs with different links apart', () => {
		const merged = coalesce([
			{ text: 'a', style: 'p', link: 'x' },
			{ text: 'b', style: 'p', link: 'y' }
		]);
		expect(merged).toHaveLength(2);
	});
});
