import { describe, expect, it } from 'vitest';
import { parse } from '../../src/lib/markdown/parse';
import { canonicalCallout } from '../../src/lib/markdown/obsidian';
import { coalesce, renderInline, type InlineContext } from '../../src/lib/pdf/inline';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';
import type { Theme } from '../../src/lib/theme/schema';
import type { TextRun } from '../../src/lib/pdf/pdfmake-types';
import { parseOpts } from '../helpers/parseOptions';

function ctx(theme: Theme = cloneDefaultTheme()): InlineContext {
	return {
		theme,
		fonts: { body: 'B', heading: 'H', mono: 'M' },
		warnings: new Set<string>(),
		images: new Map(),
		emojiArt: new Map(),
		contentWidth: 483,
		destinations: new Map(),
		blockAnchors: new Map()
	};
}

function tokens(markdown: string, overrides = {}) {
	return parse(markdown, parseOpts(overrides)).tokens;
}

function runs(markdown: string, theme?: Theme, overrides = {}): TextRun[] {
	const inline = tokens(markdown, overrides).find((t) => t.type === 'inline');
	return coalesce(renderInline(inline?.children, 'paragraph', ctx(theme))) as TextRun[];
}

function text(markdown: string, theme?: Theme, overrides = {}): string {
	return runs(markdown, theme, overrides)
		.map((r) => r.text)
		.join('');
}

describe('wikilinks', () => {
	it('renders the target as styled text, not a hyperlink', () => {
		const [run] = runs('see [[My Note]]').slice(-1);
		expect(run.text).toBe('My Note');
		expect(run.color).toBe('#7048c8');
		expect(run.link).toBeUndefined();
	});

	it('prefers the alias over the target', () => {
		expect(text('[[My Note|the note]]')).toBe('the note');
	});

	it('reads a section as "Target > Section"', () => {
		expect(text('[[My Note#Setup]]')).toBe('My Note > Setup');
	});

	it('strips the caret from a block reference', () => {
		expect(text('[[My Note#^abc123]]')).toBe('My Note > abc123');
	});

	it('falls back to the section when the target is empty', () => {
		expect(text('[[#Setup]]')).toBe('Setup');
	});

	it('can keep the brackets', () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.wikilinks.showBrackets = true;
		expect(text('[[My Note]]', theme)).toBe('[[My Note]]');
	});

	it('leaves an ordinary Markdown link alone', () => {
		const [run] = runs('[text](https://example.com)');
		expect(run.link).toBe('https://example.com');
	});

	it('stays literal when disabled', () => {
		expect(text('[[My Note]]', undefined, { wikilinks: false })).toBe('[[My Note]]');
	});
});

describe('embeds', () => {
	it('renders as an italic reference by default', () => {
		const [run] = runs('![[Diagram.png]]');
		expect(run.text).toBe('Diagram.png');
		expect(run.italics).toBe(true);
	});

	it('can be hidden entirely', () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.embeds.show = false;
		expect(text('before ![[Diagram.png]]', theme)).toBe('before ');
	});

	it('leaves an ordinary Markdown image alone', () => {
		const inline = tokens('![alt](pic.png)').find((t) => t.type === 'inline');
		expect(inline?.children?.map((c) => c.type)).toContain('image');
	});
});

describe('highlights', () => {
	it('paints the theme background behind the run', () => {
		const run = runs('a ==bright== b').find((r) => r.text === 'bright');
		expect(run?.background).toBe('#fff3a3');
	});

	it('composes with bold', () => {
		const run = runs('==**both**==').find((r) => r.text === 'both');
		expect(run?.background).toBe('#fff3a3');
		expect(run?.bold).toBe(true);
	});

	it('stays literal when disabled', () => {
		expect(text('a ==bright== b', undefined, { highlight: false })).toBe('a ==bright== b');
	});
});

describe('comments', () => {
	it('drops an inline comment', () => {
		expect(text('visible %%hidden%% tail')).toBe('visible  tail');
	});

	it('drops a comment spanning a blank line', () => {
		const types = tokens('a\n\n%%\nnote\n\nmore\n%%\n\nb').map((t) => t.type);
		expect(types).toContain('obsidian_comment_block');
		const rendered = tokens('a\n\n%%\nnote\n\nmore\n%%\n\nb')
			.filter((t) => t.type === 'inline')
			.map((t) => t.content);
		expect(rendered).toEqual(['a', 'b']);
	});

	it('can be shown, styled, when the theme asks', () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.comments.show = true;
		const run = runs('visible %%hidden%% tail', theme).find((r) => r.text === 'hidden');
		expect(run?.color).toBe('#8a8a8a');
		expect(run?.italics).toBe(true);
	});

	it('leaves a marker inside a fenced code block literal', () => {
		const fence = tokens('```\n%%not a comment%%\n```').find((t) => t.type === 'fence');
		expect(fence?.content).toBe('%%not a comment%%\n');
	});

	it('leaves an unterminated marker literal', () => {
		expect(text('%% never closed')).toBe('%% never closed');
	});

	it('stays literal when disabled', () => {
		expect(text('visible %%hidden%% tail', undefined, { comments: false })).toBe(
			'visible %%hidden%% tail'
		);
	});
});

describe('block identifiers', () => {
	it('strips a trailing block id', () => {
		expect(text('A paragraph. ^my-id')).toBe('A paragraph. ');
	});

	it('leaves a caret that is not a block id alone', () => {
		expect(text('x^2 is squared')).toBe('x^2 is squared');
		expect(text('2 ^ 3 is eight')).toBe('2 ^ 3 is eight');
	});

	it('stays literal when disabled', () => {
		expect(text('A paragraph. ^my-id', undefined, { blockIds: false })).toBe('A paragraph. ^my-id');
	});
});

describe('callouts', () => {
	it('tags the blockquote with the canonical type', () => {
		const open = tokens('> [!TIP] Try this\n> body').find((t) => t.type === 'blockquote_open');
		expect(open?.attrGet?.('callout') ?? null).toBe('tip');
	});

	it('folds aliases onto canonical types', () => {
		expect(canonicalCallout('TLDR')).toBe('abstract');
		expect(canonicalCallout('caution')).toBe('warning');
		expect(canonicalCallout('nonsense')).toBe('note');
	});

	it('retypes the title paragraph and keeps its formatting', () => {
		const types = tokens('> [!note] A **bold** title\n> body').map((t) => t.type);
		expect(types).toContain('callout_title_open');
		expect(types).toContain('callout_title_close');
		const title = tokens('> [!note] A **bold** title\n> body').find((t) => t.type === 'inline');
		expect(title?.children?.map((c) => c.type)).toContain('strong_open');
	});

	it('defaults the title to the capitalised type', () => {
		const inline = tokens('> [!warning]\n> mind the gap').find((t) => t.type === 'inline');
		expect(inline?.content).toBe('Warning');
	});

	it('splits the remainder of the first paragraph into its own block', () => {
		const contents = tokens('> [!note] Title\n> body text')
			.filter((t) => t.type === 'inline')
			.map((t) => t.content);
		expect(contents).toEqual(['Title', 'body text']);
	});

	it('records the fold marker', () => {
		const open = tokens('> [!note]- Collapsed\n> body').find((t) => t.type === 'blockquote_open');
		expect(open?.attrGet?.('callout-fold') ?? null).toBe('-');
	});

	it('leaves a plain blockquote untagged', () => {
		const open = tokens('> just a quote').find((t) => t.type === 'blockquote_open');
		expect(open?.attrGet?.('callout') ?? null).toBeNull();
	});

	it('stays a plain blockquote when disabled', () => {
		const out = tokens('> [!note] Title\n> body', { callouts: false });
		expect(out.map((t) => t.type)).not.toContain('callout_title_open');
		expect(out.find((t) => t.type === 'inline')?.content).toContain('[!note]');
	});
});

describe('tags', () => {
	it('styles a tag from the theme, hash included', () => {
		const run = runs('a #project tag').find((r) => r.text === '#project');
		expect(run?.color).toBe('#08787f');
	});

	it('reads a nested tag whole', () => {
		expect(runs('#parent/child here').some((r) => r.text === '#parent/child')).toBe(true);
	});

	it('can drop the hash', () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.tags.showHash = false;
		expect(text('#project', theme)).toBe('project');
	});

	it('can carry a background', () => {
		const theme = cloneDefaultTheme();
		theme.obsidian.tags.background = '#e0f2f1';
		expect(runs('#project', theme).find((r) => r.text === '#project')?.background).toBe('#e0f2f1');
	});

	it('works at the start of a line, where it is not a heading', () => {
		const out = tokens('#project alone');
		expect(out.map((t) => t.type)).not.toContain('heading_open');
		expect(out.find((t) => t.type === 'inline')?.children?.map((c) => c.type)).toContain(
			'obsidian_tag'
		);
	});

	it('leaves a real heading alone', () => {
		expect(tokens('# Heading').map((t) => t.type)).toContain('heading_open');
	});

	// A technical document is full of things that look like tags but are not.
	it.each([
		['a numeric issue reference', 'see #1234 for details', '#1234'],
		['a mid-word hash', 'example.com#fragment', '#fragment'],
		['a hash inside a word', 'a#b'],
		['a bare hash', 'C# is a language']
	])('leaves %s literal', (_label, source, fragment?: string) => {
		const out = text(source);
		expect(out).toBe(source);
		if (fragment) expect(out).toContain(fragment);
	});

	it('leaves a tag inside a code span literal', () => {
		const run = runs('use `#project` here').find((r) => r.style === 'inlineCode');
		expect(run?.text).toBe('#project');
		expect(run?.color).not.toBe('#08787f');
	});

	it('leaves a tag inside a fence literal', () => {
		const fence = tokens('```\n#project\n```').find((t) => t.type === 'fence');
		expect(fence?.content).toBe('#project\n');
	});

	it('keeps a CSS colour looking like a tag, as Obsidian does', () => {
		// #fff really is a tag by Obsidian's rules; documenting the consequence.
		expect(runs('use #fff here').some((r) => r.text === '#fff' && r.color === '#08787f')).toBe(
			true
		);
	});

	it('stays literal when disabled', () => {
		expect(text('a #project tag', undefined, { tags: false })).toBe('a #project tag');
	});
});

describe('footnotes', () => {
	it('renders the reference as a superscript number', () => {
		const run = runs('text[^1]\n\n[^1]: the note').find((r) => r.sup);
		expect(run?.text).toBe('1');
		expect(run?.color).toBe('#0366d6');
	});

	it('appends a footnote block', () => {
		expect(tokens('text[^1]\n\n[^1]: the note').map((t) => t.type)).toContain(
			'footnote_block_open'
		);
	});

	it('stays literal when disabled', () => {
		expect(text('text[^1]', undefined, { footnotes: false })).toBe('text[^1]');
	});
});
