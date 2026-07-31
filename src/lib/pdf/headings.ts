import type Token from 'markdown-it/lib/token.mjs';

/** One heading in the source, with everything the TOC, outline and links need. */
export interface HeadingInfo {
	/** 0-based source line, which is also the node id (`L<line>`) it renders with. */
	line: number;
	level: number;
	/** Plain text, markers stripped. Used for the outline and for the slug. */
	text: string;
	/** GitHub-style anchor, unique within the document. */
	slug: string;
	/** `1.2.3`, or empty when heading numbering is off. */
	number: string;
}

export interface HeadingIndex {
	list: HeadingInfo[];
	/** Source line → heading, for the renderer. */
	byLine: Map<number, HeadingInfo>;
	/**
	 * Anchor → pdfmake destination id. Keyed by GitHub slug *and* by normalised
	 * heading text, because the two ecosystems write the same link differently:
	 * `[x](#my-heading)` on GitHub, `[[#My Heading]]` in Obsidian.
	 */
	destinations: Map<string, string>;
	/** `^block-id` → destination id, for `[[#^block-id]]`. */
	blockAnchors: Map<string, string>;
}

/** Case and spacing are not significant in an Obsidian heading reference. */
export function normalizeAnchor(anchor: string): string {
	return anchor.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The one place an anchor of either flavour turns into a destination. */
export function destinationFor(
	index: Pick<HeadingIndex, 'destinations' | 'blockAnchors'>,
	anchor: string,
	block = false
): string | undefined {
	if (block) return index.blockAnchors.get(normalizeAnchor(anchor));
	return index.destinations.get(anchor) ?? index.destinations.get(normalizeAnchor(anchor));
}

/**
 * GitHub's anchor rules: lowercase, punctuation dropped, spaces to hyphens.
 * Letters outside ASCII are kept — `\p{L}` rather than `[a-z]`, so a heading in
 * any script still gets a usable anchor instead of an empty one.
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]+/gu, '')
		.trim()
		.replace(/\s+/g, '-');
}

/** The visible text of an inline token: every child's content, markers excluded. */
function plainText(inline: Token | undefined): string {
	if (!inline) return '';
	const children = inline.children;
	if (!children || children.length === 0) return inline.content;
	return children.map((c) => c.content).join('');
}

/**
 * Walk the token stream once and record everything the document can be linked
 * to: every heading, and every `^block-id`.
 *
 * Numbering lives here rather than in the renderer so the TOC entry, the PDF
 * outline and the heading itself cannot disagree: all three read this table.
 */
export function scanHeadings(tokens: Token[], numbered: boolean): HeadingIndex {
	const list: HeadingInfo[] = [];
	const byLine = new Map<number, HeadingInfo>();
	const destinations = new Map<string, string>();
	const blockAnchors = new Map<string, string>();
	const seen = new Map<string, number>();
	const counters = [0, 0, 0, 0, 0, 0];

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i];

		// A block identifier belongs to the block it closes, which is the node
		// that carries the `L<line>` id. With the feature off the parser emits no
		// such token, so nothing here needs to check the theme.
		if (tok.type === 'inline' && tok.map) {
			for (const child of tok.children ?? []) {
				if (child.type !== 'block_id' || !child.content) continue;
				const key = normalizeAnchor(child.content);
				if (!blockAnchors.has(key)) blockAnchors.set(key, `L${tok.map[0]}`);
			}
		}

		if (tok.type !== 'heading_open') continue;
		const line = tok.map?.[0];
		if (line == null) continue;

		const level = Math.min(6, Math.max(1, Number(tok.tag.slice(1)) || 1));
		const text = plainText(tokens[i + 1]).trim();

		const base = slugify(text) || `section-${list.length + 1}`;
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		const slug = count === 0 ? base : `${base}-${count}`;

		let number = '';
		if (numbered) {
			counters[level - 1]++;
			for (let deeper = level; deeper < 6; deeper++) counters[deeper] = 0;
			const parts = counters.slice(0, level);
			// A document whose top level is h2 or h3 numbers from 1, not 0.0.1.
			// A level skipped *below* one that was used keeps its zero, because
			// there really is a missing rung there.
			while (parts.length > 1 && parts[0] === 0) parts.shift();
			number = parts.join('.');
		}

		const info: HeadingInfo = { line, level, text, slug, number };
		list.push(info);
		byLine.set(line, info);
		destinations.set(slug, `L${line}`);
		// First one wins, matching the slug suffixes: `#notes` is the first
		// "Notes", and the later ones are reachable as `#notes-1` and `#notes-2`.
		const byText = normalizeAnchor(text);
		if (byText && !destinations.has(byText)) destinations.set(byText, `L${line}`);
	}

	return { list, byLine, destinations, blockAnchors };
}
