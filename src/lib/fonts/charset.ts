/**
 * Characters a Google-tier font is asked to cover.
 *
 * `css2` normally answers with a dozen `@font-face` blocks split by
 * `unicode-range`, and pdfkit can embed exactly one file — take the wrong block
 * and every Latin character renders as tofu. Passing `text=` instead returns a
 * single subset covering precisely what was asked for, which sidesteps the
 * split entirely.
 *
 * The request is a fixed base plus whatever else the document actually uses, so
 * ordinary English typing never changes the set and never re-fetches the font.
 */

function range(from: number, to: number): string {
	let out = '';
	for (let code = from; code <= to; code++) out += String.fromCodePoint(code);
	return out;
}

const BASE_RANGES = [
	range(0x20, 0x7e), // printable ASCII
	range(0xa0, 0xff), // Latin-1 supplement
	range(0x100, 0x17f), // Latin Extended-A
	'‐‑‒–—―‖‗‘’‚‛“”„†‡•‣․‥…‰′″‹›‼‽⁄⁰', // general punctuation
	'₠₡₢₣₤₥₦₧₨₩₪₫€₭₮₯₰₱₲₳₴₵₹₺₽', // currency
	'™©®°±×÷µ¶§', // symbols
	'←↑→↓↔↕⇐⇒', // arrows
	'─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋═║╔╗╚╝╠╣╦╩╬', // box drawing, for tree diagrams
	'■□▪▫▬▭▮▯▲△▶▷▼▽◀◁◆◇○●◦◘◙', // geometric shapes, for list bullets
	'☐☑☒✓✔✕✖✗✘', // ballot boxes and check marks, for task lists
	'⌘⌥⇧⌃⏎⌫' // keyboard glyphs, common in technical documents
].join('');

/** Deduplicated, sorted, so the same document always yields the same key. */
function normalise(characters: Iterable<string>): string {
	return [...new Set(characters)].sort().join('');
}

const BASE = normalise(BASE_RANGES);

/**
 * The base set plus every other character the document uses. Control
 * characters and anything outside the BMP are dropped: they cannot appear in a
 * `text=` query usefully and pdfkit would not render them anyway.
 */
export function documentCharset(source: string): string {
	const extra: string[] = [];
	for (const character of source) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code > 0xffff) continue;
		if (BASE.includes(character)) continue;
		extra.push(character);
	}
	return extra.length === 0 ? BASE : normalise([...BASE, ...extra]);
}

/** Short, stable key for cache lookups; the charset itself is far too long. */
export function charsetKey(charset: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < charset.length; i++) {
		hash ^= charset.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${charset.length.toString(36)}-${hash.toString(36)}`;
}
