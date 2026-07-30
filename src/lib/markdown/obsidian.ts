import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';

/**
 * Obsidian Flavored Markdown — https://obsidian.md/help/obsidian-flavored-markdown
 *
 * Strikethrough, tables and task lists are already GFM and handled elsewhere;
 * highlights (`==`) and footnotes come from markdown-it-mark and
 * markdown-it-footnote. What is left needs custom rules, and lives here:
 * wikilinks, embeds, comments, block identifiers and callouts.
 *
 * There is no vault, so a wikilink cannot resolve to anything — it renders as
 * styled text, not a hyperlink. Every rule is opt-out through the theme so a
 * document that uses `[[`, `%%` or `^id` for something else stays literal.
 */
export interface ObsidianOptions {
	wikilinks: boolean;
	callouts: boolean;
	comments: boolean;
	blockIds: boolean;
}

/** Canonical callout types. Aliases below fold into these. */
export const CALLOUT_TYPES = [
	'note',
	'abstract',
	'info',
	'todo',
	'tip',
	'success',
	'question',
	'warning',
	'failure',
	'danger',
	'bug',
	'example',
	'quote'
] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

const CALLOUT_ALIASES: Record<string, CalloutType> = {
	summary: 'abstract',
	tldr: 'abstract',
	hint: 'tip',
	important: 'tip',
	check: 'success',
	done: 'success',
	help: 'question',
	faq: 'question',
	caution: 'warning',
	attention: 'warning',
	fail: 'failure',
	missing: 'failure',
	error: 'danger',
	cite: 'quote'
};

/** An unrecognised type still renders as a callout, styled as a note. */
export function canonicalCallout(raw: string): CalloutType {
	const key = raw.trim().toLowerCase();
	if ((CALLOUT_TYPES as readonly string[]).includes(key)) return key as CalloutType;
	return CALLOUT_ALIASES[key] ?? 'note';
}

// --- inline rules -----------------------------------------------------------

const WIKILINK = /^!?\[\[([^[\]\n|]*)(?:\|([^[\]\n]*))?\]\]/;
const COMMENT = /^%%([\s\S]*?)%%/;
const BLOCK_ID = /^\^([A-Za-z0-9-]+)$/;

/** `Note#Heading` / `Note#^blockid` → target plus the section, `^` stripped. */
function splitSection(raw: string): [string, string] {
	const hash = raw.indexOf('#');
	if (hash < 0) return [raw.trim(), ''];
	return [raw.slice(0, hash).trim(), raw.slice(hash + 1).replace(/^\^/, '').trim()];
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
	const start = state.pos;
	const embed = state.src.charCodeAt(start) === 0x21; /* ! */
	const bracket = embed ? start + 1 : start;
	if (state.src.charCodeAt(bracket) !== 0x5b /* [ */) return false;
	if (state.src.charCodeAt(bracket + 1) !== 0x5b) return false;

	const m = WIKILINK.exec(state.src.slice(start, state.posMax));
	if (!m) return false;

	if (!silent) {
		const [target, section] = splitSection(m[1]);
		const token = state.push('wikilink', '', 0);
		token.content = m[0];
		token.attrSet('target', target);
		token.attrSet('section', section);
		token.attrSet('alias', (m[2] ?? '').trim());
		if (embed) token.attrSet('embed', '1');
	}
	state.pos = start + m[0].length;
	return true;
}

function commentRule(state: StateInline, silent: boolean): boolean {
	if (state.src.charCodeAt(state.pos) !== 0x25 /* % */) return false;
	if (state.src.charCodeAt(state.pos + 1) !== 0x25) return false;

	const m = COMMENT.exec(state.src.slice(state.pos, state.posMax));
	if (!m) return false;

	if (!silent) state.push('obsidian_comment', '', 0).content = m[1];
	state.pos += m[0].length;
	return true;
}

/**
 * A block identifier is only one at the very end of a block and after
 * whitespace, so `x^2` and `2 ^ 3` are left alone.
 */
function blockIdRule(state: StateInline, silent: boolean): boolean {
	if (state.src.charCodeAt(state.pos) !== 0x5e /* ^ */) return false;

	const prev = state.pos === 0 ? 0x20 : state.src.charCodeAt(state.pos - 1);
	if (prev !== 0x20 && prev !== 0x09 && prev !== 0x0a) return false;

	const m = BLOCK_ID.exec(state.src.slice(state.pos, state.posMax));
	if (!m) return false;

	if (!silent) state.push('block_id', '', 0).content = m[1];
	state.pos = state.posMax;
	return true;
}

// --- block rule -------------------------------------------------------------

/**
 * `%% … %%` spanning blank lines. The single-line and single-paragraph forms
 * are already covered by the inline rule; this exists for the case where the
 * comment swallows a blank line, which no inline rule can see. Registered
 * after `fence` so a marker inside a code block stays literal.
 */
function commentBlockRule(
	state: StateBlock,
	startLine: number,
	endLine: number,
	silent: boolean
): boolean {
	if (state.sCount[startLine] - state.blkIndent >= 4) return false;

	const pos = state.bMarks[startLine] + state.tShift[startLine];
	if (state.src.charCodeAt(pos) !== 0x25 /* % */) return false;
	if (state.src.charCodeAt(pos + 1) !== 0x25) return false;

	let last = startLine;
	if (!state.src.slice(pos + 2, state.eMarks[startLine]).includes('%%')) {
		last = -1;
		for (let line = startLine + 1; line < endLine; line++) {
			const from = state.bMarks[line] + state.tShift[line];
			if (state.src.slice(from, state.eMarks[line]).includes('%%')) {
				last = line;
				break;
			}
		}
		// Unterminated: not a comment at all. Let the paragraph rule have it.
		if (last < 0) return false;
	}

	if (silent) return true;

	const token = state.push('obsidian_comment_block', '', 0);
	token.block = true;
	token.map = [startLine, last + 1];
	token.content = state
		.getLines(startLine, last + 1, state.blkIndent, false)
		.trim()
		.replace(/^%%/, '')
		.replace(/%%$/, '')
		.trim();
	state.line = last + 1;
	return true;
}

// --- callouts ---------------------------------------------------------------

const CALLOUT_HEAD = /^\[!([^\]\n]+)\]([+-]?)[ \t]*(.*)$/;

/**
 * `> [!note]- Title` is a blockquote as far as markdown-it is concerned, so
 * this runs *before* the `inline` core rule — the first paragraph still holds
 * raw text at that point, which is what lets the title keep its formatting:
 * it is retyped into `callout_title_*` and tokenised normally afterwards.
 */
function calloutRule(state: StateCore): boolean {
	const tokens = state.tokens;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type !== 'blockquote_open') continue;
		if (tokens[i + 1]?.type !== 'paragraph_open') continue;
		const inline = tokens[i + 2];
		if (inline?.type !== 'inline' || tokens[i + 3]?.type !== 'paragraph_close') continue;

		const newline = inline.content.indexOf('\n');
		const first = newline < 0 ? inline.content : inline.content.slice(0, newline);
		const m = CALLOUT_HEAD.exec(first);
		if (!m) continue;

		const rest = newline < 0 ? '' : inline.content.slice(newline + 1);
		const label = m[1].trim();

		tokens[i].attrSet('callout', canonicalCallout(label));
		tokens[i].attrSet('callout-fold', m[2]);
		tokens[i + 1].type = 'callout_title_open';
		tokens[i + 3].type = 'callout_title_close';
		inline.content = m[3].trim() || defaultTitle(label);

		if (!rest.trim()) continue;

		// What followed the title line on the same paragraph becomes its own
		// paragraph, one source line further down for scroll sync.
		const open = new state.Token('paragraph_open', 'p', 1);
		open.block = true;
		open.level = tokens[i + 1].level;
		if (inline.map) open.map = [inline.map[0] + 1, inline.map[1]];

		const body = new state.Token('inline', '', 0);
		body.content = rest;
		body.children = [];
		body.level = inline.level;
		if (open.map) body.map = [...open.map];

		const close = new state.Token('paragraph_close', 'p', -1);
		close.block = true;
		close.level = open.level;

		tokens.splice(i + 4, 0, open, body, close);
		i += 3;
	}
	return true;
}

function defaultTitle(label: string): string {
	return label.charAt(0).toUpperCase() + label.slice(1);
}

// --- registration -----------------------------------------------------------

export function obsidianPlugin(md: MarkdownIt, options: ObsidianOptions): void {
	if (options.wikilinks) md.inline.ruler.before('link', 'wikilink', wikilinkRule);
	if (options.comments) {
		md.inline.ruler.before('link', 'obsidian_comment', commentRule);
		md.block.ruler.before('paragraph', 'obsidian_comment_block', commentBlockRule, {
			alt: ['paragraph', 'blockquote', 'list']
		});
	}
	if (options.blockIds) md.inline.ruler.before('link', 'block_id', blockIdRule);
	if (options.callouts) md.core.ruler.before('inline', 'obsidian_callout', calloutRule);
}
