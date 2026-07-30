import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `patches/pdfmake+0.2.23.patch` teaches pdfmake to flow an image or SVG inline
 * with text. Colour emoji and mid-sentence images both depend on it entirely.
 *
 * It is applied by `postinstall`, which a hardened CI can skip with
 * `--ignore-scripts`, and it is destroyed by any pdfmake version bump. Both
 * failures are silent — the app would simply go back to dropping the artwork.
 * These tests are the alarm.
 *
 * The bundle check matters most: the browser loads `pdfmake/build/pdfmake`
 * while every other test in this suite loads `pdfmake/src/printer.js`. Nothing
 * else in the Node suite reads the bundle, so without this a bundle-only
 * regression would ship with a completely green test run.
 */
const PDFMAKE = join(import.meta.dirname, '..', '..', 'node_modules', 'pdfmake');
/** One per hunk. The opening comment is not countable — it appears twice per hunk. */
const MARKER = 'md2pdf patch end';

/**
 * `survives` is the *unpatched* behaviour each hunk must leave intact —
 * measuring an ordinary word, and drawing ordinary text.
 */
const COPIES: [label: string, path: string, hunks: number, survives: string[]][] = [
	['src/textTools.js', join(PDFMAKE, 'src', 'textTools.js'), 1, ['widthOfString(item.text']],
	['src/printer.js', join(PDFMAKE, 'src', 'printer.js'), 1, ['pdfKitDoc.text(inline.text']],
	[
		'build/pdfmake.js (browser)',
		join(PDFMAKE, 'build', 'pdfmake.js'),
		2,
		['widthOfString(item.text', 'pdfKitDoc.text(inline.text']
	]
];

describe('pdfmake inline-artwork patch', () => {
	it('is pinned to an exact version', () => {
		const pkg = JSON.parse(
			readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')
		) as { dependencies: Record<string, string> };
		// A caret range would let `npm install` pull a version the patch does not
		// match, silently un-patching the browser while these tests stay green.
		expect(pkg.dependencies.pdfmake).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it.each(COPIES)('%s carries the patch', (_label, path, hunks) => {
		const source = readFileSync(path, 'utf8');
		expect(source.split(MARKER).length - 1).toBe(hunks);
	});

	/**
	 * Presence of the marker is not enough, and this is not hypothetical: an
	 * early version of the script that copies the hunks into the bundle matched
	 * on a trailing code line, truncated hunk A at the end of its `if` branch and
	 * dropped the `else` that measures every ordinary word. The marker was still
	 * there, every Node test passed — and the app could not lay out any text at
	 * all, because nothing had a width. Assert the branch, not the comment.
	 */
	it.each(COPIES)('%s leaves ordinary text alone', (_label, path, _hunks, survives) => {
		const source = readFileSync(path, 'utf8');
		for (const needle of survives) expect(source).toContain(needle);
	});

	it('reserves width for an inline node instead of collapsing it to zero', async () => {
		// The defect the patch fixes: measure() overwrote the caller's width with
		// widthOfString('') === 0, so nothing wrapped around the artwork.
		const { default: TextTools } = await import('pdfmake/src/textTools.js');
		const font = {
			widthOfString: () => 10,
			lineHeight: () => 12,
			ascender: 800
		};
		const tools = new TextTools({ provideFont: () => font });
		const { items } = tools.buildInlines(
			[{ text: 'a' }, { svg: '<svg viewBox="0 0 1 1"/>', width: 17, height: 17 }],
			null
		);

		const artwork = items.find((i) => 'svg' in i) as { width: number; _inlineH?: number };
		expect(artwork).toBeDefined();
		expect(artwork.width).toBe(17);
		expect(artwork._inlineH).toBe(17);
	});
});
