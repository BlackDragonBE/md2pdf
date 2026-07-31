import bindingUrl from 'wawoff2/build/decompress_binding.js?url';
import { getFont, putFont } from './cache';
import { charsetKey } from './charset';
import { completeFaces, type FaceBuffers, type FaceKey } from './types';
import { sniffFont } from './upload';

const CSS2 = 'https://fonts.googleapis.com/css2';

/** style:weight → the gstatic URL css2 handed back. */
type FaceUrls = Map<string, string>;

interface Woff2Binding {
	calledRun?: boolean;
	onRuntimeInitialized?: () => void;
	decompress(input: Uint8Array): Uint8Array | false;
}

const BINDING_TIMEOUT_MS = 20_000;

let bindingPromise: Promise<Woff2Binding> | undefined;

/**
 * Loaded as a classic <script>, not imported as a module.
 *
 * `wawoff2` is an Emscripten build that assigns `module.exports` **only** under
 * `ENVIRONMENT_IS_NODE`. In a browser it relies on its top-level `var Module`
 * becoming a global — which is exactly what bundling to ESM takes away, so
 * `import` yields an empty object and every `decompress()` await hangs forever
 * with no error to catch. (Its own `index.js` wrapper additionally races its
 * `onRuntimeInitialized` assignment against a runtime that may already have
 * finished.)
 *
 * A classic script restores the global, so the WASM — inlined as a data: URI,
 * nothing extra to fetch — initialises the way Emscripten intended.
 * Main-thread only, which is where font resolution runs.
 */
function loadWoff2Binding(): Promise<Woff2Binding> {
	if (bindingPromise) return bindingPromise;

	bindingPromise = new Promise<Woff2Binding>((resolve, reject) => {
		if (typeof document === 'undefined') {
			reject(new Error('WOFF2 decoding needs a document; it cannot run in a worker.'));
			return;
		}

		const globals = globalThis as { Module?: Woff2Binding };
		const ready = () => {
			const binding = globals.Module;
			if (binding && typeof binding.decompress === 'function') resolve(binding);
			else reject(new Error('WOFF2 decoder loaded but exposed no decompress().'));
		};

		if (globals.Module?.calledRun) {
			ready();
			return;
		}

		const timer = setTimeout(
			() => reject(new Error('WOFF2 decoder did not start in time.')),
			BINDING_TIMEOUT_MS
		);

		// The binding reads a pre-existing `Module` and calls this once embind has
		// registered decompress().
		globals.Module = {
			onRuntimeInitialized: () => {
				clearTimeout(timer);
				ready();
			}
		} as Woff2Binding;

		const script = document.createElement('script');
		script.src = bindingUrl;
		script.async = true;
		script.onerror = () => {
			clearTimeout(timer);
			reject(new Error('Could not load the WOFF2 decoder.'));
		};
		document.head.appendChild(script);
	}).catch((e: unknown) => {
		bindingPromise = undefined;
		throw e instanceof Error ? e : new Error(String(e));
	});

	return bindingPromise;
}

/**
 * `fetch()` cannot override User-Agent, so css2 always answers a browser with
 * `format('woff2')`. Decoding is therefore the only path, not a fallback (§7.4).
 *
 * Verified against the live endpoint: the decompressed output carries the
 * `0x00010000` TrueType tag and pdfkit embeds it as `/FontFile2`. The
 * already-a-font short circuit covers the `truetype` src css2 hands to older
 * user agents.
 */
async function decodeFont(downloaded: ArrayBuffer): Promise<ArrayBuffer> {
	if (sniffFont(downloaded).ok) return downloaded;
	const binding = await loadWoff2Binding();
	const out = binding.decompress(new Uint8Array(downloaded));
	if (out === false) throw new Error('WOFF2 decoding failed.');
	const bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBufferLike);
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseCss(css: string): FaceUrls {
	const urls: FaceUrls = new Map();
	const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
	for (const block of blocks) {
		const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
		const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400';
		const url = /src:[^;]*url\((https:\/\/[^)]+)\)/.exec(block)?.[1];
		if (!url) continue;
		const key = `${style}:${weight}`;
		// With `text=` there is exactly one block per face, so first wins is safe.
		if (!urls.has(key)) urls.set(key, url);
	}
	return urls;
}

/**
 * A single pinned weight maximises the chance of a static cut. A range
 * (`wght@400..700`) reliably returns a variable file, which pdfkit renders as
 * its default instance (§7.4).
 *
 * `text=` is what makes the tier usable at all. Without it css2 answers with a
 * dozen `@font-face` blocks split by `unicode-range` — Cyrillic first, Latin
 * last — and since pdfkit can embed only one file, picking a block meant every
 * Latin character rendered as tofu. Asking for the document's characters
 * returns a single subset that covers exactly them.
 */
async function fetchWeight(
	family: string,
	weight: number,
	italic: boolean,
	charset: string
): Promise<string> {
	const spec = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
	const url =
		`${CSS2}?family=${encodeURIComponent(family)}:${spec}` +
		`&text=${encodeURIComponent(charset)}&display=swap`;
	const face = italic ? `${weight} italic` : `${weight}`;

	let res: Response;
	try {
		res = await fetch(url);
	} catch {
		// css2 answers an unknown family — or a weight/style the family does not
		// have — with a 400 that carries no CORS headers, so the browser rejects
		// the request outright and the status never reaches us. Being genuinely
		// offline looks identical from here, hence the explicit check.
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			throw new Error(`Cannot reach Google Fonts — this browser is offline.`);
		}
		throw new Error(
			`Google Fonts has no "${family}" at weight ${face} — check the spelling and the available weights.`
		);
	}

	if (res.status === 400 || res.status === 404) {
		throw new Error(
			`Google Fonts has no "${family}" at weight ${face} — check the spelling and the available weights.`
		);
	}
	if (!res.ok) throw new Error(`Google Fonts responded ${res.status} for "${family}".`);
	const css = await res.text();
	const urls = parseCss(css);
	const hit = urls.get(`${italic ? 'italic' : 'normal'}:${weight}`) ?? [...urls.values()][0];
	if (!hit) throw new Error(`No usable face in the Google Fonts response for "${family}".`);
	return hit;
}

/** A decoded font that still carries an `fvar` table is variable; warn loudly (§7.4). */
export function hasVariationAxes(buffer: ArrayBuffer): boolean {
	if (buffer.byteLength < 12) return false;
	const view = new DataView(buffer);
	const numTables = view.getUint16(4, false);
	if (12 + numTables * 16 > buffer.byteLength) return false;
	for (let i = 0; i < numTables; i++) {
		const off = 12 + i * 16;
		const tag = String.fromCharCode(
			view.getUint8(off),
			view.getUint8(off + 1),
			view.getUint8(off + 2),
			view.getUint8(off + 3)
		);
		if (tag === 'fvar') return true;
	}
	return false;
}

const FACE_SPEC: Record<FaceKey, { weight: 'regular' | 'bold'; italic: boolean }> = {
	normal: { weight: 'regular', italic: false },
	bold: { weight: 'bold', italic: false },
	italics: { weight: 'regular', italic: true },
	bolditalics: { weight: 'bold', italic: true }
};

export interface GoogleLoadResult {
	faces: FaceBuffers;
	/** True when nothing came from the network — every face was an IndexedDB hit. */
	fromCache: boolean;
}

export async function loadGoogleFaces(
	family: string,
	weights: number[],
	warnings: string[],
	charset: string
): Promise<GoogleLoadResult> {
	const subset = charsetKey(charset);
	const regular = weights.find((w) => w <= 500) ?? weights[0] ?? 400;
	const bold = weights.find((w) => w > 500) ?? 700;

	const partial: Partial<FaceBuffers> = {};
	let networkUsed = false;
	let variableSeen = false;
	let anyNetworkError: string | null = null;

	await Promise.all(
		(Object.keys(FACE_SPEC) as FaceKey[]).map(async (face) => {
			const spec = FACE_SPEC[face];
			const weight = spec.weight === 'bold' ? bold : regular;
			// The cache key carries the subset: a different document may need
			// characters this file does not have.
			const key = `google:${family}:${weight}:${spec.italic ? 'italic' : 'normal'}:${subset}`;

			const cached = await getFont(key);
			if (cached) {
				partial[face] = cached;
				if (hasVariationAxes(cached)) variableSeen = true;
				return;
			}

			try {
				const url = await fetchWeight(family, weight, spec.italic, charset);
				const downloaded = await fetch(url).then((r) => {
					if (!r.ok) throw new Error(`gstatic responded ${r.status}`);
					return r.arrayBuffer();
				});
				const ttf = await decodeFont(downloaded);
				networkUsed = true;
				if (hasVariationAxes(ttf)) variableSeen = true;
				partial[face] = ttf;
				await putFont(key, ttf);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				// Missing italics are routine — many families have none (§7.4).
				if (spec.italic) warnings.push(`${family}: no ${face} face available.`);
				else anyNetworkError = message;
			}
		})
	);

	if (!partial.normal && !partial.bold) {
		throw new Error(anyNetworkError ?? `Could not load "${family}" from Google Fonts.`);
	}

	if (variableSeen) {
		warnings.push(
			`${family} is a variable font. pdfkit renders it at its default instance, so bold and italic weights may look wrong.`
		);
	}

	return { faces: completeFaces(partial, family, warnings), fromCache: !networkUsed };
}
