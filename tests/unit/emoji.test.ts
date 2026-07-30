import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { artworkKey, clusters, emojiText, hasEmoji, splitEmojiRuns } from '../../src/lib/pdf/emoji';
import type { TextRun } from '../../src/lib/pdf/pdfmake-types';

const EMOJI = 'E';

function parts(text: string): [string, boolean][] {
	return clusters(text).map((c) => [c.text, c.emoji]);
}

describe('clustering', () => {
	it('keeps plain text in one non-emoji cluster', () => {
		expect(parts('hello world')).toEqual([['hello world', false]]);
	});

	it('separates emoji from the surrounding text', () => {
		expect(parts('a 🔥 b')).toEqual([
			['a ', false],
			['🔥', true],
			[' b', false]
		]);
	});

	it('keeps a variation selector with its base', () => {
		expect(parts('⚠️')).toEqual([['⚠️', true]]);
	});

	it('keeps a ZWJ family whole', () => {
		expect(parts('👨‍👩‍👧')).toEqual([['👨‍👩‍👧', true]]);
	});

	it('keeps a skin-tone modifier with its base', () => {
		expect(parts('👍🏽')).toEqual([['👍🏽', true]]);
	});

	it('keeps a regional-indicator flag pair whole', () => {
		expect(parts('🇧🇪')).toEqual([['🇧🇪', true]]);
	});

	it('keeps a keycap sequence whole, digit included', () => {
		expect(parts('1️⃣')).toEqual([['1️⃣', true]]);
	});

	it('merges adjacent emoji into one run', () => {
		expect(parts('🔥💡')).toEqual([['🔥💡', true]]);
	});

	it('honours an explicit text-presentation selector', () => {
		expect(parts('⚠︎')).toEqual([['⚠︎', false]]);
	});
});

/**
 * The theme draws bullets, checkboxes and tree diagrams from the text font.
 * Routing any of them to the emoji font would change how ordinary documents
 * look, and the emoji font has no glyph for most of them.
 */
describe('characters that must stay in the text font', () => {
	it.each(['•', '◦', '▪', '☐', '☑', '✓', '✔', '─│┌┐└┘├┤┬┴┼', '→←↑↓', '©®™', '±×÷', '§¶'])(
		'%s',
		(text) => {
			expect(hasEmoji(text)).toBe(false);
		}
	);
});

describe('hasEmoji', () => {
	it.each(['🏋️', '📊', '✅', '🎯', '👍', '🇧🇪', '⚠️', '🔥', '💡', '📝', '🚀', '✨'])(
		'%s is emoji',
		(text) => {
			expect(hasEmoji(text)).toBe(true);
		}
	);

	it('is false for an ordinary document', () => {
		expect(hasEmoji('# Heading\n\nSome text with `code` and a [link](x).')).toBe(false);
	});
});

/**
 * Twemoji's filename convention. Getting this wrong does not throw — every
 * lookup just misses and the document silently falls back to monochrome.
 */
describe('artworkKey', () => {
	it.each([
		['🔥', '1f525'],
		['📊', '1f4ca'],
		['⚠️', '26a0'], // the presentation selector is stripped
		['🏋️', '1f3cb'],
		['👨‍👩‍👧', '1f468-200d-1f469-200d-1f467'], // ZWJ is kept
		['👍🏽', '1f44d-1f3fd'], // skin tone is kept
		['🇧🇪', '1f1e7-1f1ea'], // flags are a pair of regional indicators
		['1️⃣', '31-20e3'] // keycap keeps the base digit and 20e3
	])('%s → %s', (cluster, key) => {
		expect(artworkKey(cluster)).toBe(key);
	});

	it('matches the archive that ships in static/emoji', () => {
		// The real set, so a rebuild that changed the naming fails here.
		const set = JSON.parse(
			Buffer.from(
				gunzipSync(readFileSync(join(import.meta.dirname, '..', '..', 'static', 'emoji', 'twemoji.bin')))
			).toString('utf8')
		) as Record<string, string>;

		for (const emoji of ['🔥', '📊', '⚠️', '🏋️', '👨‍👩‍👧', '👍🏽', '🇧🇪', '1️⃣', '✅', '🎯']) {
			expect(set[artworkKey(emoji)], `${emoji} has no artwork`).toBeTruthy();
		}
	});
});

describe('splitEmojiRuns', () => {
	const run = (text: string, extra: Partial<TextRun> = {}): TextRun => ({ text, ...extra });

	it('returns the input untouched without an emoji family', () => {
		const input = [run('a 🔥 b')];
		expect(splitEmojiRuns(input, undefined)).toBe(input);
	});

	it('leaves an emoji-free run as the same object', () => {
		const input = [run('plain')];
		expect(splitEmojiRuns(input, EMOJI)[0]).toBe(input[0]);
	});

	it('splits and fonts only the emoji piece', () => {
		expect(splitEmojiRuns([run('a 🔥 b')], EMOJI)).toEqual([
			{ text: 'a ' },
			{ text: '🔥', font: EMOJI },
			{ text: ' b' }
		]);
	});

	it('carries the run formatting onto every piece', () => {
		const out = splitEmojiRuns([run('bold 🔥', { bold: true, color: '#f00' })], EMOJI);
		expect(out).toHaveLength(2);
		for (const piece of out) {
			expect(piece.bold).toBe(true);
			expect(piece.color).toBe('#f00');
		}
		expect(out[1].font).toBe(EMOJI);
	});

	it('never overrides a run that already names a font', () => {
		const input = [run('🔥', { font: 'Mono' })];
		expect(splitEmojiRuns(input, EMOJI)[0].font).toBe('Mono');
	});
});

describe('emojiText', () => {
	it('stays a plain string when there is nothing to route', () => {
		expect(emojiText('Chapter one', EMOJI)).toBe('Chapter one');
	});

	it('becomes runs when it holds emoji', () => {
		expect(emojiText('Done ✅', EMOJI)).toEqual([{ text: 'Done ' }, { text: '✅', font: EMOJI }]);
	});
});
