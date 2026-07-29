import { describe, expect, it } from 'vitest';
import { extractFrontMatter, mergeMeta } from '../../src/lib/markdown/frontmatter';

describe('extractFrontMatter', () => {
	it('extracts the four known fields', () => {
		const { meta, body } = extractFrontMatter(
			'---\ntitle: T\nsubtitle: S\nauthor: A\ndate: 2024-01-02\n---\n# Body\n'
		);
		expect(meta).toEqual({ title: 'T', subtitle: 'S', author: 'A', date: '2024-01-02' });
		expect(body).toBe('# Body\n');
	});

	it('ignores unknown keys', () => {
		const { meta } = extractFrontMatter('---\ntitle: T\nkeywords: [a, b]\n---\nbody');
		expect(meta).toEqual({ title: 'T' });
	});

	it('leaves a document without front matter alone', () => {
		const source = '# Heading\n\nbody';
		expect(extractFrontMatter(source)).toEqual({ meta: {}, body: source, warnings: [] });
	});

	it('does not treat a horizontal rule mid-document as front matter', () => {
		const source = '# Heading\n\n---\n\nbody';
		expect(extractFrontMatter(source).body).toBe(source);
	});

	it('reports invalid YAML instead of throwing', () => {
		const { meta, warnings } = extractFrontMatter('---\ntitle: [unclosed\n---\nbody');
		expect(meta).toEqual({});
		expect(warnings[0]).toMatch(/not valid YAML/);
	});

	it('handles CRLF line endings', () => {
		const { meta, body } = extractFrontMatter('---\r\ntitle: T\r\n---\r\nbody');
		expect(meta.title).toBe('T');
		expect(body).toBe('body');
	});

	it('coerces scalar numbers and booleans to strings', () => {
		const { meta } = extractFrontMatter('---\ntitle: 2024\nauthor: true\n---\nbody');
		expect(meta.title).toBe('2024');
		expect(meta.author).toBe('true');
	});

	it('warns and ignores a non-scalar field', () => {
		const { meta, warnings } = extractFrontMatter('---\ntitle: {a: 1}\n---\nbody');
		expect(meta.title).toBeUndefined();
		expect(warnings.join(' ')).toMatch(/not a scalar/);
	});

	it('uses JSON_SCHEMA, so custom YAML tags do not construct types', () => {
		// The default schema would resolve !!timestamp into a Date object.
		const { meta } = extractFrontMatter('---\ndate: 2024-01-02\n---\nbody');
		expect(typeof meta.date).toBe('string');
	});

	it('ignores a sequence at the top level', () => {
		const { meta, warnings } = extractFrontMatter('---\n- one\n- two\n---\nbody');
		expect(meta).toEqual({});
		expect(warnings.join(' ')).toMatch(/not a mapping/);
	});
});

describe('mergeMeta', () => {
	it('prefers front matter over the metadata panel', () => {
		expect(mergeMeta({ title: 'FM' }, { title: 'Panel', author: 'Panel' })).toEqual({
			title: 'FM',
			subtitle: '',
			author: 'Panel',
			date: ''
		});
	});

	it('falls through to empty strings', () => {
		expect(mergeMeta({}, {})).toEqual({ title: '', subtitle: '', author: '', date: '' });
	});

	it('treats an explicit empty string in front matter as a value, not a gap', () => {
		expect(mergeMeta({ title: '' }, { title: 'Panel' }).title).toBe('');
	});
});
