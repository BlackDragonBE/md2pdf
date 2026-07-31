import { describe, expect, it } from 'vitest';
import { parse } from '../../src/lib/markdown/parse';
import { parseOpts } from '../helpers/parseOptions';
import { scanHeadings, slugify } from '../../src/lib/pdf/headings';

function scan(markdown: string, numbered = false) {
	return scanHeadings(parse(markdown, parseOpts()).tokens, numbered);
}

describe('slugify', () => {
	it('lowercases and hyphenates', () => {
		expect(slugify('Getting Started')).toBe('getting-started');
	});

	it('drops punctuation', () => {
		expect(slugify('What’s new? (v2)')).toBe('whats-new-v2');
	});

	it('keeps letters outside ASCII rather than emptying the anchor', () => {
		expect(slugify('Übersicht')).toBe('übersicht');
		expect(slugify('日本語')).toBe('日本語');
	});

	it('collapses runs of whitespace', () => {
		expect(slugify('a   b')).toBe('a-b');
	});
});

describe('scanHeadings', () => {
	it('records level, line and text', () => {
		const { list } = scan('# One\n\ntext\n\n## Two\n');
		expect(list).toEqual([
			{ line: 0, level: 1, text: 'One', slug: 'one', number: '' },
			{ line: 4, level: 2, text: 'Two', slug: 'two', number: '' }
		]);
	});

	it('takes the visible text, not the markup', () => {
		const { list } = scan('# **Bold** and `code`\n');
		expect(list[0].text).toBe('Bold and code');
		expect(list[0].slug).toBe('bold-and-code');
	});

	it('disambiguates repeated headings the way GitHub does', () => {
		const { list } = scan('# Notes\n\n# Notes\n\n# Notes\n');
		expect(list.map((h) => h.slug)).toEqual(['notes', 'notes-1', 'notes-2']);
	});

	it('gives a heading with no usable text a positional slug', () => {
		const { list } = scan('# ***\n');
		expect(list[0].slug).toBe('section-1');
	});

	it('maps every slug to the node id the heading renders with', () => {
		const { destinations } = scan('# One\n\n## Two\n');
		expect(destinations.get('one')).toBe('L0');
		expect(destinations.get('two')).toBe('L2');
	});

	it('leaves numbers empty when numbering is off', () => {
		expect(scan('# One\n\n## Two\n').list.map((h) => h.number)).toEqual(['', '']);
	});

	it('numbers by level and resets deeper counters', () => {
		const md = '# A\n\n## A1\n\n### A1a\n\n## A2\n\n# B\n\n## B1\n';
		expect(scan(md, true).list.map((h) => h.number)).toEqual([
			'1',
			'1.1',
			'1.1.1',
			'1.2',
			'2',
			'2.1'
		]);
	});

	it('numbers from 1 when the document never uses a top level', () => {
		expect(scan('### Deep\n\n### Deeper\n', true).list.map((h) => h.number)).toEqual(['1', '2']);
	});

	it('keeps the zero for a rung skipped under one that was used', () => {
		expect(scan('# A\n\n### Deep\n', true).list.map((h) => h.number)).toEqual(['1', '1.0.1']);
	});
});
