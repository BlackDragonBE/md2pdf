import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, cloneDefaultTheme } from '../../src/lib/theme/defaults';
import {
	exportTheme,
	importMdTheme,
	importTheme,
	importThemeJson,
	serialiseTheme,
	slugify
} from '../../src/lib/theme/io';

const PNG_1x1 =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('importTheme', () => {
	it('turns {} into DEFAULT_THEME without crashing', () => {
		const { theme } = importTheme({});
		expect(theme).toEqual(DEFAULT_THEME);
	});

	it('warns about an unknown extra field but still succeeds', () => {
		const { theme, warnings } = importTheme({ version: 1, madeUpField: 7 });
		expect(theme.name).toBe(DEFAULT_THEME.name);
		expect(warnings.some((w) => w.includes('madeUpField'))).toBe(true);
	});

	it('deep-merges a partial theme over the defaults', () => {
		const { theme } = importTheme({ version: 1, page: { size: 'A5' } });
		expect(theme.page.size).toBe('A5');
		// Untouched siblings survive the merge.
		expect(theme.page.margins).toEqual(DEFAULT_THEME.page.margins);
		expect(theme.elements.h1.size).toBe(DEFAULT_THEME.elements.h1.size);
	});

	it('falls back to defaults with readable issues when a field is the wrong type', () => {
		const { theme, warnings } = importTheme({ version: 1, page: { size: 'A0' } });
		expect(theme).toEqual(DEFAULT_THEME);
		expect(warnings.join(' ')).toMatch(/page\.size/);
	});

	it('never throws on malformed JSON', () => {
		const { theme, warnings } = importThemeJson('{ not json');
		expect(theme).toEqual(DEFAULT_THEME);
		expect(warnings[0]).toMatch(/Could not parse JSON/);
	});

	it('rejects a non-image data URI', () => {
		const { theme, warnings } = importTheme({
			version: 1,
			background: { image: { dataUri: 'data:text/html,<script>', fit: 'cover', opacity: 1 } }
		});
		expect(theme.background.image).toBeNull();
		expect(warnings.join(' ')).toMatch(/not an image/);
	});

	it('rejects a data URI over 4 MB', () => {
		const big = `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}`;
		const { theme, warnings } = importTheme({
			version: 1,
			background: { image: { dataUri: big, fit: 'cover', opacity: 1 } }
		});
		expect(theme.background.image).toBeNull();
		expect(warnings.join(' ')).toMatch(/exceeds 4 MB/);
	});

	it('resets a page-break marker that collides with Markdown syntax', () => {
		const { theme, warnings } = importTheme({ version: 1, pagebreak: { marker: '## break' } });
		expect(theme.pagebreak.marker).toBe('\\pagebreak');
		expect(warnings.join(' ')).toMatch(/collides with Markdown/);
	});

	it.each(['---', '> quote', '- item', '1. item', '```', '~~~'])(
		'rejects the colliding marker %p',
		(marker) => {
			const { warnings } = importTheme({ version: 1, pagebreak: { marker } });
			expect(warnings.join(' ')).toMatch(/collides with Markdown/);
		}
	);

	it('accepts a marker that is not Markdown syntax', () => {
		const { theme, warnings } = importTheme({ version: 1, pagebreak: { marker: '<<<break>>>' } });
		expect(theme.pagebreak.marker).toBe('<<<break>>>');
		expect(warnings.join(' ')).not.toMatch(/collides/);
	});

	it('warns when a header offset would collide with body text', () => {
		const { warnings } = importTheme({
			version: 1,
			page: { margins: [56, 40, 56, 40] },
			header: { enabled: true, offset: 60 },
			footer: { enabled: true, offset: 60 }
		});
		expect(warnings.join(' ')).toMatch(/header\.offset/);
		expect(warnings.join(' ')).toMatch(/footer\.offset/);
	});
});

describe('exportTheme', () => {
	it('round-trips export → import byte-identically', async () => {
		const theme = cloneDefaultTheme();
		theme.name = 'Round Trip';
		theme.page.size = 'LETTER';
		theme.elements.h1.size = 31;

		const out = exportTheme(theme);
		expect(out.kind).toBe('json');
		const text = await out.blob.text();

		const { theme: back, warnings } = importThemeJson(text);
		expect(warnings).toEqual([]);
		expect(back).toEqual(theme);
		expect(serialiseTheme(back)).toBe(text);
	});

	it('stays JSON for builtin and google font sources', () => {
		const theme = cloneDefaultTheme();
		theme.fonts.body = {
			source: { kind: 'google', family: 'Inter', weights: [400, 700] },
			fallback: 'inter'
		};
		expect(exportTheme(theme).kind).toBe('json');
	});

	it('switches to a .mdtheme ZIP when a font slot is an upload', () => {
		const theme = cloneDefaultTheme();
		theme.fonts.body = {
			source: { kind: 'upload', hash: 'abc123', family: 'Mine' },
			fallback: 'inter'
		};
		const out = exportTheme(theme, [
			{ hash: 'abc123', family: 'Mine', face: 'normal', bytes: new Uint8Array([1, 2, 3, 4]) }
		]);
		expect(out.kind).toBe('mdtheme');
		expect(out.filename.endsWith('.mdtheme')).toBe(true);
	});

	it('round-trips a .mdtheme with an uploaded font and a large image', async () => {
		const theme = cloneDefaultTheme();
		theme.name = 'Zipped';
		theme.fonts.body = {
			source: { kind: 'upload', hash: 'deadbeef', family: 'Mine' },
			fallback: 'inter'
		};
		// Over the 256 KB inline limit, so it must be externalised into assets/.
		const big = `data:image/png;base64,${'QUJDRA=='.replace('=', '').slice(0, 4).repeat(100_000)}`;
		theme.background.image = { dataUri: big, fit: 'contain', opacity: 0.5 };

		const out = exportTheme(theme, [
			{ hash: 'deadbeef', family: 'Mine', face: 'normal', bytes: new Uint8Array([0, 1, 0, 0]) }
		]);
		expect(out.kind).toBe('mdtheme');

		const bytes = new Uint8Array(await out.blob.arrayBuffer());
		const back = importMdTheme(bytes);
		expect(back.theme.name).toBe('Zipped');
		expect(back.theme.fonts.body.source).toEqual({
			kind: 'upload',
			hash: 'deadbeef',
			family: 'Mine'
		});
		expect(back.theme.background.image?.fit).toBe('contain');
		expect(back.theme.background.image?.dataUri.startsWith('data:image/png;base64,')).toBe(true);
		expect(back.fonts.get('deadbeef-normal.ttf')).toEqual(new Uint8Array([0, 1, 0, 0]));
	});

	it('reports a corrupt archive instead of throwing', () => {
		const back = importMdTheme(new Uint8Array([1, 2, 3, 4, 5]));
		expect(back.theme).toEqual(DEFAULT_THEME);
		expect(back.warnings[0]).toMatch(/readable \.mdtheme|theme\.json/);
	});
});

describe('slugify', () => {
	it.each([
		['Technical Report', 'technical-report'],
		['  Spaces  ', 'spaces'],
		['!!!', 'theme'],
		['Ünïcodé 42', 'n-cod-42']
	])('%p → %p', (input, expected) => {
		expect(slugify(input)).toBe(expected);
	});
});
