import type { TextRun } from './pdfmake-types';

/**
 * pdfmake binds one font per text run and pdfkit has no glyph fallback, so an
 * emoji in a Latin-subset family is a blank box and nothing warns about it.
 * The fix is to cut every run at emoji boundaries and point the emoji pieces at
 * the bundled Noto Emoji family (`noto-emoji`, built by scripts/build_fonts.py).
 *
 * Routing has to be conservative in one direction: the theme draws its own list
 * bullets, task checkboxes and tree diagrams from the *text* font (•, ☑, ─, ✓),
 * and sending those to the emoji font would change how an ordinary document
 * looks. So only characters that are unambiguously emoji move.
 */

/** Codepoints that are emoji even without a variation selector (Emoji_Presentation=Yes, BMP). */
const PRESENTATION: readonly [number, number][] = [
	[0x231a, 0x231b],
	[0x23e9, 0x23ec],
	[0x23f0, 0x23f0],
	[0x23f3, 0x23f3],
	[0x25fd, 0x25fe],
	[0x2614, 0x2615],
	[0x2648, 0x2653],
	[0x267f, 0x267f],
	[0x2693, 0x2693],
	[0x26a1, 0x26a1],
	[0x26aa, 0x26ab],
	[0x26bd, 0x26be],
	[0x26c4, 0x26c5],
	[0x26ce, 0x26ce],
	[0x26d4, 0x26d4],
	[0x26ea, 0x26ea],
	[0x26f2, 0x26f3],
	[0x26f5, 0x26f5],
	[0x26fa, 0x26fa],
	[0x26fd, 0x26fd],
	[0x2705, 0x2705],
	[0x270a, 0x270b],
	[0x2728, 0x2728],
	[0x274c, 0x274c],
	[0x274e, 0x274e],
	[0x2753, 0x2755],
	[0x2757, 0x2757],
	[0x2795, 0x2797],
	[0x27b0, 0x27b0],
	[0x27bf, 0x27bf],
	[0x2b1b, 0x2b1c],
	[0x2b50, 0x2b50],
	[0x2b55, 0x2b55]
];

const VS16 = 0xfe0f; // emoji presentation
const VS15 = 0xfe0e; // text presentation — an explicit request *not* to use emoji
const ZWJ = 0x200d;
const KEYCAP = 0x20e3;

function isPictographic(cp: number): boolean {
	// The astral emoji blocks. 0x1FB00+ is Symbols for Legacy Computing, which
	// is not emoji and which no bundled family carries either way.
	if (cp >= 0x1f000 && cp <= 0x1faff) return true;
	for (const [lo, hi] of PRESENTATION) if (cp >= lo && cp <= hi) return true;
	return false;
}

function isModifier(cp: number): boolean {
	return (
		cp === VS16 ||
		cp === VS15 ||
		cp === KEYCAP ||
		(cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin tone
		(cp >= 0xe0020 && cp <= 0xe007f) // tag characters, for subdivision flags
	);
}

interface Cluster {
	text: string;
	emoji: boolean;
}

/**
 * Split into grapheme-ish clusters, keeping every sequence whole: a ZWJ family,
 * a skin-toned hand, a flag pair, a keycap. Cutting `1️⃣` after the `1` would
 * send the base digit to one font and its enclosing box to another.
 */
export function clusters(text: string): Cluster[] {
	const cps = [...text].map((c) => c.codePointAt(0) as number);
	const out: Cluster[] = [];

	for (let i = 0; i < cps.length; ) {
		const start = i;
		let sawVs16 = false;
		let sawVs15 = false;
		let sawKeycap = false;
		let pictographic = isPictographic(cps[i]);
		i++;

		// Trailing modifiers, then any number of ZWJ-joined segments.
		for (;;) {
			while (i < cps.length && isModifier(cps[i])) {
				if (cps[i] === VS16) sawVs16 = true;
				if (cps[i] === VS15) sawVs15 = true;
				if (cps[i] === KEYCAP) sawKeycap = true;
				i++;
			}
			if (i + 1 < cps.length && cps[i] === ZWJ) {
				if (isPictographic(cps[i + 1])) pictographic = true;
				i += 2;
				continue;
			}
			break;
		}

		// Regional indicators pair into one flag.
		if (
			cps[start] >= 0x1f1e6 &&
			cps[start] <= 0x1f1ff &&
			i === start + 1 &&
			i < cps.length &&
			cps[i] >= 0x1f1e6 &&
			cps[i] <= 0x1f1ff
		) {
			i++;
		}

		const emoji = !sawVs15 && (pictographic || sawVs16 || sawKeycap);
		const text_ = String.fromCodePoint(...cps.slice(start, i));
		const previous = out[out.length - 1];
		if (previous && previous.emoji === emoji) previous.text += text_;
		else out.push({ text: text_, emoji });
	}

	return out;
}

export function hasEmoji(text: string): boolean {
	return clusters(text).some((c) => c.emoji);
}

/**
 * Text for a node that binds a single font of its own — a header, footer or
 * cover block. Stays a plain string unless it actually holds emoji, so the
 * common case adds no nodes.
 */
export function emojiText(text: string, font: string | undefined): string | TextRun[] {
	if (!font) return text;
	const parts = clusters(text);
	if (!parts.some((p) => p.emoji)) return text;
	return parts.map((p) => (p.emoji ? { text: p.text, font } : { text: p.text }));
}

/**
 * Re-cut runs so emoji pieces carry `font`. A run that already names a font is
 * left alone, and with no emoji family resolved the input is returned as-is —
 * the document still renders, just with the boxes it has today.
 */
export function splitEmojiRuns<T extends TextRun>(runs: T[], font: string | undefined): T[] {
	if (!font) return runs;
	const out: T[] = [];
	for (const run of runs) {
		if (run.font !== undefined || !run.text) {
			out.push(run);
			continue;
		}
		const parts = clusters(run.text);
		if (parts.length === 1 && !parts[0].emoji) {
			out.push(run);
			continue;
		}
		for (const part of parts) {
			out.push(part.emoji ? { ...run, text: part.text, font } : { ...run, text: part.text });
		}
	}
	return out;
}
