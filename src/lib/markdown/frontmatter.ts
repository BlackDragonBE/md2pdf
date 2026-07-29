import { JSON_SCHEMA, load } from 'js-yaml';

export interface DocMeta {
	title: string;
	subtitle: string;
	author: string;
	/** ISO 8601, or '' to mean "today at render time". */
	date: string;
}

export const EMPTY_META: DocMeta = { title: '', subtitle: '', author: '', date: '' };

export interface FrontMatterResult {
	meta: Partial<DocMeta>;
	/** Source with the front matter block removed, line count preserved. */
	body: string;
	warnings: string[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function asString(v: unknown): string | undefined {
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return undefined;
}

/**
 * Strip a leading `---\n…\n---` block and read title/subtitle/author/date.
 * Parsed with JSON_SCHEMA, not the default schema: the default one constructs
 * arbitrary types from tags, which we have no use for and do not want (§6.2).
 */
export function extractFrontMatter(source: string): FrontMatterResult {
	const m = FRONT_MATTER.exec(source);
	if (!m) return { meta: {}, body: source, warnings: [] };

	const body = source.slice(m[0].length);
	const warnings: string[] = [];
	let parsed: unknown;

	try {
		parsed = load(m[1], { schema: JSON_SCHEMA });
	} catch (e) {
		return {
			meta: {},
			body,
			warnings: [`Front matter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`]
		};
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return { meta: {}, body, warnings: ['Front matter is not a mapping — ignored.'] };
	}

	const src = parsed as Record<string, unknown>;
	const meta: Partial<DocMeta> = {};
	for (const key of ['title', 'subtitle', 'author', 'date'] as const) {
		if (!(key in src)) continue;
		const v = asString(src[key]);
		if (v === undefined) warnings.push(`Front matter "${key}" is not a scalar — ignored.`);
		else meta[key] = v;
	}

	return { meta, body, warnings };
}

/** Front matter wins, then the metadata panel, then '' (§6.2). */
export function mergeMeta(fromSource: Partial<DocMeta>, overrides: Partial<DocMeta>): DocMeta {
	return {
		title: fromSource.title ?? overrides.title ?? '',
		subtitle: fromSource.subtitle ?? overrides.subtitle ?? '',
		author: fromSource.author ?? overrides.author ?? '',
		date: fromSource.date ?? overrides.date ?? ''
	};
}
