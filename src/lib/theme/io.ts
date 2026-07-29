import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { bytesToDataUri, dataUriToBytes } from '../util/base64';
import { cloneDefaultTheme } from './defaults';
import { migrate } from './migrate';
import { MARKER_COLLISION, ThemeSchema, type Theme } from './schema';

export interface ImportResult {
	theme: Theme;
	warnings: string[];
}

const MAX_DATA_URI_BYTES = 4 * 1024 * 1024;
const EXPORT_INLINE_LIMIT = 256 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merge `source` over `base`. Objects recurse; arrays and primitives replace.
 * Keys absent from `base` are copied through so schema validation can report
 * them rather than them vanishing silently.
 */
function deepMerge(base: unknown, source: unknown): unknown {
	if (!isRecord(source)) return source === undefined ? base : source;
	if (!isRecord(base)) return { ...source };
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(source)) {
		if (v === undefined) continue;
		out[k] = k in base ? deepMerge(base[k], v) : v;
	}
	return out;
}

/** data: URIs are the only image transport (§5.1). Size and MIME are checked here. */
function checkDataUris(node: unknown, path: string, warnings: string[]): void {
	if (Array.isArray(node)) {
		node.forEach((v, i) => checkDataUris(v, `${path}[${i}]`, warnings));
		return;
	}
	if (!isRecord(node)) return;
	for (const [k, v] of Object.entries(node)) {
		const p = path ? `${path}.${k}` : k;
		if (k === 'dataUri' && typeof v === 'string') {
			const mime = /^data:([^;,]*)/.exec(v)?.[1] ?? '';
			if (!mime.startsWith('image/')) {
				warnings.push(`${p}: not an image (${mime || 'no MIME type'}) — image dropped.`);
				node.dataUri = '';
			} else if (approxDataUriBytes(v) > MAX_DATA_URI_BYTES) {
				warnings.push(`${p}: image exceeds 4 MB — image dropped.`);
				node.dataUri = '';
			}
		} else {
			checkDataUris(v, p, warnings);
		}
	}
}

/** Byte length of a base64 data: URI payload, without decoding it. */
export function approxDataUriBytes(uri: string): number {
	const comma = uri.indexOf(',');
	if (comma < 0) return 0;
	const payload = uri.length - comma - 1;
	return uri.slice(0, comma).includes(';base64') ? Math.floor((payload * 3) / 4) : payload;
}

/** Strip nodes whose dataUri we blanked out above. */
function dropBlankedImages(node: unknown): void {
	if (Array.isArray(node)) {
		node.forEach(dropBlankedImages);
		return;
	}
	if (!isRecord(node)) return;
	for (const [k, v] of Object.entries(node)) {
		if (isRecord(v) && v.dataUri === '') node[k] = null;
		else dropBlankedImages(v);
	}
}

/** Checks that cannot be expressed in the Zod schema because they span fields. */
function crossFieldWarnings(theme: Theme): string[] {
	const w: string[] = [];

	if (MARKER_COLLISION.test(theme.pagebreak.marker)) {
		w.push(
			`pagebreak.marker "${theme.pagebreak.marker}" collides with Markdown syntax — reset to the default.`
		);
		theme.pagebreak.marker = '\\pagebreak';
	}

	if (theme.header.enabled && theme.header.offset >= theme.page.margins[1]) {
		w.push(
			`header.offset (${theme.header.offset}pt) must be less than the top margin (${theme.page.margins[1]}pt) or the header collides with body text.`
		);
	}
	if (theme.footer.enabled && theme.footer.offset >= theme.page.margins[3]) {
		w.push(
			`footer.offset (${theme.footer.offset}pt) must be less than the bottom margin (${theme.page.margins[3]}pt) or the footer collides with body text.`
		);
	}
	return w;
}

/**
 * migrate → deep-merge over defaults → validate. Never throws into the render
 * path: a malformed theme degrades to DEFAULT_THEME plus warnings (§5.2).
 */
export function importTheme(raw: unknown): ImportResult {
	const warnings: string[] = [];

	const migrated = migrate(raw);

	if (isRecord(raw)) {
		const known = new Set(Object.keys(cloneDefaultTheme()));
		for (const k of Object.keys(raw)) {
			if (!known.has(k)) warnings.push(`Unknown top-level field "${k}" ignored.`);
		}
	} else {
		warnings.push('Theme was not an object — defaults used.');
	}

	checkDataUris(migrated, '', warnings);
	dropBlankedImages(migrated);

	const merged = deepMerge(cloneDefaultTheme(), migrated);
	const parsed = ThemeSchema.safeParse(merged);

	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			warnings.push(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
		}
		return { theme: cloneDefaultTheme(), warnings };
	}

	warnings.push(...crossFieldWarnings(parsed.data));
	return { theme: parsed.data, warnings };
}

/** Parse a JSON string. Malformed JSON is a warning, never an exception (§5.2). */
export function importThemeJson(text: string): ImportResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return {
			theme: cloneDefaultTheme(),
			warnings: [`Could not parse JSON: ${e instanceof Error ? e.message : String(e)}`]
		};
	}
	return importTheme(raw);
}

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'theme'
	);
}

/**
 * Serialise in canonical (schema-declaration) key order.
 *
 * Import always returns a Zod-rebuilt object, so exporting the in-memory theme
 * verbatim would emit a different key order than the one that comes back —
 * export → import → export would not be byte-identical. Round-tripping through
 * the schema here makes it so by construction.
 */
export function serialiseTheme(theme: Theme): string {
	const parsed = ThemeSchema.safeParse(theme);
	return JSON.stringify(parsed.success ? parsed.data : theme, null, 2);
}

/** Collect every `dataUri` in the theme, with the JSON path that holds it. */
function collectDataUris(node: unknown, path: string, out: { path: string; uri: string }[]): void {
	if (Array.isArray(node)) {
		node.forEach((v, i) => collectDataUris(v, `${path}[${i}]`, out));
		return;
	}
	if (!isRecord(node)) return;
	for (const [k, v] of Object.entries(node)) {
		const p = path ? `${path}.${k}` : k;
		if (k === 'dataUri' && typeof v === 'string') out.push({ path: p, uri: v });
		else collectDataUris(v, p, out);
	}
}

export interface UploadedFontBytes {
	hash: string;
	family: string;
	face: string;
	bytes: Uint8Array;
}

export type ThemeExport =
	| { kind: 'json'; filename: string; blob: Blob }
	| { kind: 'mdtheme'; filename: string; blob: Blob };

/**
 * Plain JSON unless the theme carries binaries — an uploaded font slot, or an
 * image over 256 KB — in which case a `.mdtheme` ZIP (§5.4).
 * `builtin` and `google` sources always export as identifiers only.
 */
export function exportTheme(theme: Theme, uploads: UploadedFontBytes[] = []): ThemeExport {
	const slug = slugify(theme.name);
	const usesUpload = Object.values(theme.fonts).some((s) => s.source.kind === 'upload');

	const images: { path: string; uri: string }[] = [];
	collectDataUris(theme, '', images);
	const heavy = images.filter((i) => approxDataUriBytes(i.uri) > EXPORT_INLINE_LIMIT);

	if (!usesUpload && heavy.length === 0) {
		return {
			kind: 'json',
			filename: `${slug}.theme.json`,
			blob: new Blob([serialiseTheme(theme)], { type: 'application/json' })
		};
	}

	const files: Record<string, Uint8Array> = {};
	const packed = structuredClone(theme) as unknown as Record<string, unknown>;

	heavy.forEach((img, i) => {
		const ext = /^data:image\/([a-z0-9+.-]+)/.exec(img.uri)?.[1]?.replace('jpeg', 'jpg') ?? 'bin';
		const name = `assets/image-${i}.${ext}`;
		files[name] = dataUriToBytes(img.uri).bytes;
		setByPath(packed, img.path, `asset:${name}`);
	});

	for (const u of uploads) {
		files[`fonts/${u.hash}-${u.face}.ttf`] = u.bytes;
	}

	files['theme.json'] = strToU8(JSON.stringify(packed, null, 2));

	const zipped = zipSync(files, { level: 6 });
	return {
		kind: 'mdtheme',
		filename: `${slug}.mdtheme`,
		// Copy into a fresh buffer: fflate may hand back a view over a larger pool.
		blob: new Blob([zipped.slice()], { type: 'application/zip' })
	};
}

export interface MdThemeImport extends ImportResult {
	fonts: Map<string, Uint8Array>;
}

/** Read a `.mdtheme` ZIP back into a theme with its assets re-inlined. */
export function importMdTheme(zip: Uint8Array): MdThemeImport {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(zip);
	} catch (e) {
		return {
			theme: cloneDefaultTheme(),
			warnings: [`Not a readable .mdtheme archive: ${e instanceof Error ? e.message : String(e)}`],
			fonts: new Map()
		};
	}

	const themeFile = files['theme.json'];
	if (!themeFile) {
		return {
			theme: cloneDefaultTheme(),
			warnings: ['Archive contains no theme.json.'],
			fonts: new Map()
		};
	}

	let raw: unknown;
	try {
		raw = JSON.parse(strFromU8(themeFile));
	} catch (e) {
		return {
			theme: cloneDefaultTheme(),
			warnings: [`theme.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
			fonts: new Map()
		};
	}

	const warnings: string[] = [];
	if (isRecord(raw)) rehydrateAssets(raw, files, warnings);

	const fonts = new Map<string, Uint8Array>();
	for (const [name, bytes] of Object.entries(files)) {
		if (name.startsWith('fonts/')) fonts.set(name.slice('fonts/'.length), bytes);
	}

	const result = importTheme(raw);
	return { ...result, warnings: [...warnings, ...result.warnings], fonts };
}

function rehydrateAssets(
	node: Record<string, unknown> | unknown[],
	files: Record<string, Uint8Array>,
	warnings: string[]
): void {
	const entries = Array.isArray(node) ? node.entries() : Object.entries(node);
	for (const [k, v] of entries as Iterable<[string | number, unknown]>) {
		if (typeof v === 'string' && v.startsWith('asset:')) {
			const name = v.slice('asset:'.length);
			const bytes = files[name];
			if (!bytes) {
				warnings.push(`Archive is missing ${name}.`);
				continue;
			}
			const ext = name.split('.').pop() ?? 'png';
			const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
			(node as Record<string, unknown>)[k] = bytesToDataUri(mime, bytes);
		} else if (typeof v === 'object' && v !== null) {
			rehydrateAssets(v as Record<string, unknown>, files, warnings);
		}
	}
}

function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== '');
	let cur: Record<string, unknown> = root;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = cur[parts[i]];
		if (typeof next !== 'object' || next === null) return;
		cur = next as Record<string, unknown>;
	}
	cur[parts[parts.length - 1]] = value;
}
