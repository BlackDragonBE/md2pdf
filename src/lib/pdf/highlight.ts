import hljs from 'highlight.js/lib/common';
import type { Theme } from '../theme/schema';
import type { TextRun } from './pdfmake-types';

export interface HighlightSpan {
	text: string;
	scope: string | null;
}

const TAG = /<span class="hljs-([a-z0-9_-]+)">|<\/span>|&(amp|lt|gt|quot|#x27|#39);|[^<&]+/gi;

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	'#x27': "'",
	'#39': "'"
};

/**
 * highlight.js emits an HTML string. Scanning it with a class stack keeps this
 * working inside a Web Worker, where there is no DOM to parse with.
 *
 * ponytail: regex scan of hljs's own output, not a general HTML parser. It is
 * safe because the only producer is hljs; swap for a custom hljs emitter if
 * that ever stops being true.
 */
export function highlightToSpans(code: string, language: string | null): HighlightSpan[] {
	let html: string;
	try {
		html =
			language && hljs.getLanguage(language)
				? hljs.highlight(code, { language, ignoreIllegals: true }).value
				: hljs.highlightAuto(code).value;
	} catch {
		return [{ text: code, scope: null }];
	}

	const spans: HighlightSpan[] = [];
	const stack: string[] = [];
	let m: RegExpExecArray | null;
	TAG.lastIndex = 0;

	while ((m = TAG.exec(html)) !== null) {
		if (m[1] !== undefined) {
			stack.push(m[1]);
		} else if (m[0] === '</span>') {
			stack.pop();
		} else if (m[2] !== undefined) {
			emit(spans, ENTITIES[m[2].toLowerCase()] ?? m[0], stack);
		} else {
			emit(spans, m[0], stack);
		}
	}

	return spans;
}

function emit(spans: HighlightSpan[], text: string, stack: string[]): void {
	if (!text) return;
	// Innermost scope wins; it is the most specific colour the theme can key on.
	const scope = stack.length ? stack[stack.length - 1] : null;
	const prev = spans[spans.length - 1];
	if (prev && prev.scope === scope) prev.text += text;
	else spans.push({ text, scope });
}

/** Resolve a hljs scope to a theme colour, walking `a.b.c` → `a.b` → `a`. */
export function scopeColor(scope: string | null, t: Theme): string | undefined {
	if (!scope) return undefined;
	const colors = t.code.tokenColors;
	let key = scope;
	for (;;) {
		if (colors[key]) return colors[key];
		const dot = key.lastIndexOf('.');
		if (dot < 0) return undefined;
		key = key.slice(0, dot);
	}
}

export function highlightRuns(code: string, language: string | null, t: Theme): TextRun[] {
	return highlightToSpans(code, language).map((s) => {
		const color = scopeColor(s.scope, t);
		return color ? { text: s.text, color } : { text: s.text };
	});
}
