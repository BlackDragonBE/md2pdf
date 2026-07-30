import { gunzipSync, strFromU8 } from 'fflate';
import { assetUrl } from '../fonts/builtin';
import { getAsset, listAssetKeys, putAsset, removeAsset } from '../fonts/cache';
import { artworkKey, clusters } from '../pdf/emoji';

/**
 * Colour emoji artwork.
 *
 * PDF has no colour-font concept, so the monochrome Noto Emoji family can never
 * be coloured — the only route is drawing each emoji as artwork inline with the
 * text, which `patches/pdfmake+0.2.23.patch` makes possible.
 *
 * The set is one gzipped JSON blob (~1.4 MB, 3,720 emoji) built by
 * `scripts/build_emoji.py`, fetched only for a document that actually contains
 * an emoji and cached in IndexedDB like a font. If it cannot be fetched — a
 * first visit while offline — nothing here throws and the caller falls back to
 * the monochrome font.
 */
export interface EmojiManifest {
	file: string;
	version: string;
	count: number;
	name: string;
	license: string;
	url?: string;
}

let manifestPromise: Promise<EmojiManifest> | undefined;

export function loadEmojiManifest(): Promise<EmojiManifest> {
	if (!manifestPromise) {
		manifestPromise = fetch(assetUrl('emoji/manifest.json'))
			.then((r) => {
				if (!r.ok) throw new Error(`emoji/manifest.json: HTTP ${r.status}`);
				return r.json() as Promise<EmojiManifest>;
			})
			.catch((e) => {
				manifestPromise = undefined;
				throw e;
			});
	}
	return manifestPromise;
}

/**
 * Decompressed once per session, not once per render. The compressed bytes are
 * what lives in IndexedDB — 1.4 MB rather than the 8 MB they expand to.
 */
let setPromise: Promise<Map<string, string>> | undefined;

async function loadArchive(manifest: EmojiManifest): Promise<Uint8Array> {
	const key = `emoji:${manifest.version}`;
	const cached = await getAsset<ArrayBuffer>(key);
	if (cached) return new Uint8Array(cached);

	// The query string busts the service worker's CacheFirst entry too; see
	// loadFace in fonts/builtin.ts for why both halves are needed.
	const res = await fetch(assetUrl(`emoji/${manifest.file}?v=${manifest.version}`));
	if (!res.ok) throw new Error(`${manifest.file}: HTTP ${res.status}`);
	const buffer = await res.arrayBuffer();
	await putAsset(key, buffer);
	void dropStaleVersions(manifest.version);
	return new Uint8Array(buffer);
}

/** Drop superseded archives, so a rebuild does not leave 1.4 MB behind forever. */
async function dropStaleVersions(version: string): Promise<void> {
	for (const key of await listAssetKeys()) {
		if (key.startsWith('emoji:') && key !== `emoji:${version}`) await removeAsset(key);
	}
}

function loadSet(): Promise<Map<string, string>> {
	if (!setPromise) {
		setPromise = (async () => {
			const manifest = await loadEmojiManifest();
			const bytes = await loadArchive(manifest);
			// The archive is gzipped JSON, but a server that recognises it as
			// pre-compressed content sets Content-Encoding and the browser hands
			// back plain bytes. Sniff the gzip magic rather than assume — that is
			// also why the file is not named `.gz`.
			const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
			// fflate can hand back a view over a larger pool; see theme/io.ts.
			const json = strFromU8(gzipped ? gunzipSync(bytes).slice() : bytes);
			return new Map(Object.entries(JSON.parse(json) as Record<string, string>));
		})().catch((e) => {
			setPromise = undefined;
			throw e;
		});
	}
	return setPromise;
}

/**
 * Artwork for every emoji in `source`, keyed by cluster.
 *
 * Resolved on the main thread and handed to the worker, exactly like images:
 * `buildDocDefinition` is synchronous by construction so it can run worker-side.
 * Returns an empty map rather than throwing — emoji then render from the
 * monochrome font, which is what happened before colour existed.
 */
export async function resolveEmojiArtwork(
	source: string,
	warnings: string[]
): Promise<Map<string, string>> {
	const wanted = new Set(
		clusters(source)
			.filter((c) => c.emoji)
			.map((c) => c.text)
	);
	if (wanted.size === 0) return new Map();

	let set: Map<string, string>;
	try {
		set = await loadSet();
	} catch (e) {
		warnings.push(
			`Colour emoji unavailable — ${(e instanceof Error ? e.message : String(e)).replace(/\.$/, '')}. Falling back to monochrome.`
		);
		return new Map();
	}

	const out = new Map<string, string>();
	for (const cluster of wanted) {
		const svg = set.get(artworkKey(cluster));
		if (svg) out.set(cluster, svg);
	}
	return out;
}
