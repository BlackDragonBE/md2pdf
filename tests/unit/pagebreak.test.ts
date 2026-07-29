import { describe, expect, it } from 'vitest';
import { parse } from '../../src/lib/markdown/parse';

const MARKER = '\\pagebreak';

function types(source: string, marker = MARKER): string[] {
	return parse(source, marker).tokens.map((t) => t.type);
}

describe('pagebreak block rule', () => {
	it('emits a pagebreak token for a marker on its own line', () => {
		expect(types(`a\n\n${MARKER}\n\nb`)).toContain('pagebreak');
	});

	it('leaves a marker inside a fenced code block as literal text', () => {
		const source = ['```', MARKER, '```'].join('\n');
		const tokens = parse(source, MARKER).tokens;
		expect(tokens.map((t) => t.type)).not.toContain('pagebreak');
		expect(tokens.find((t) => t.type === 'fence')?.content).toBe(`${MARKER}\n`);
	});

	it('leaves a marker inside a tilde fence as literal text', () => {
		const source = ['~~~', MARKER, '~~~'].join('\n');
		expect(types(source)).not.toContain('pagebreak');
	});

	it('leaves a marker inside an indented code block as literal text', () => {
		expect(types(`text\n\n    ${MARKER}\n`)).not.toContain('pagebreak');
	});

	it('works inside a blockquote', () => {
		expect(types(`> before\n>\n> ${MARKER}\n`)).toContain('pagebreak');
	});

	it('works inside a list item', () => {
		expect(types(`- item\n\n  ${MARKER}\n\n- next`)).toContain('pagebreak');
	});

	it('interrupts a paragraph', () => {
		const tokens = parse(`before\n${MARKER}\nafter`, MARKER).tokens;
		expect(tokens.map((t) => t.type)).toContain('pagebreak');
	});

	it('ignores a line that merely contains the marker', () => {
		expect(types(`text ${MARKER} more`)).not.toContain('pagebreak');
	});

	it('tolerates surrounding whitespace', () => {
		expect(types(`a\n\n   ${MARKER}   \n\nb`)).toContain('pagebreak');
	});

	it('follows a changed marker', () => {
		expect(types('a\n\n<<<break>>>\n\nb', '<<<break>>>')).toContain('pagebreak');
		// The old marker must stop working once the theme changes it.
		expect(types(`a\n\n${MARKER}\n\nb`, '<<<break>>>')).not.toContain('pagebreak');
	});

	it('re-parses when the marker changes, not returning a cached tree', () => {
		const source = `a\n\n${MARKER}\n\nb`;
		expect(types(source, MARKER)).toContain('pagebreak');
		expect(types(source, '@@@')).not.toContain('pagebreak');
		expect(types(source, MARKER)).toContain('pagebreak');
	});
});

describe('markdown parser configuration', () => {
	it('never lets raw HTML through as an html token with content', () => {
		const tokens = parse('<div>hi</div>\n\n<span>x</span>', MARKER).tokens;
		const html = tokens.filter((t) => t.type === 'html_block');
		expect(html).toHaveLength(0);
	});

	it('linkifies bare URLs', () => {
		const inline = parse('see https://example.com', MARKER).tokens.find((t) => t.type === 'inline');
		expect(inline?.children?.some((c) => c.type === 'link_open')).toBe(true);
	});

	it('does not turn a single newline into a hard break', () => {
		const inline = parse('one\ntwo', MARKER).tokens.find((t) => t.type === 'inline');
		expect(inline?.children?.some((c) => c.type === 'hardbreak')).toBe(false);
		expect(inline?.children?.some((c) => c.type === 'softbreak')).toBe(true);
	});
});
