import { base } from '$app/paths';
import { deleteFont, getFont, listFontKeys, putFont } from './cache';
import {
	completeFaces,
	FACE_KEYS,
	type BuiltinFontManifest,
	type FaceBuffers,
	type FaceKey
} from './types';

let manifestPromise: Promise<BuiltinFontManifest> | undefined;

/**
 * Every runtime asset URL is prefixed with `base`, or it 404s on a project-site
 * path like /<repo>/ (§11, pitfall 1).
 */
export function assetUrl(path: string): string {
	return `${base}/${path.replace(/^\//, '')}`;
}

export function loadManifest(): Promise<BuiltinFontManifest> {
	if (!manifestPromise) {
		manifestPromise = fetch(assetUrl('fonts/manifest.json'))
			.then((r) => {
				if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
				return r.json() as Promise<BuiltinFontManifest>;
			})
			.catch((e) => {
				manifestPromise = undefined;
				throw e;
			});
	}
	return manifestPromise;
}

/**
 * Both the cache key and the URL carry the family's content version.
 *
 * Keyed on the path alone, a rebuilt font never reaches anyone who has already
 * visited: IndexedDB returns the old bytes forever, and the service worker's
 * CacheFirst rule returns them again underneath that. Adding box-drawing glyphs
 * to the bundled families shipped and changed nothing for existing users
 * because of exactly this.
 */
async function loadFace(
	id: string,
	face: FaceKey,
	path: string,
	version: string
): Promise<ArrayBuffer> {
	const key = `builtin:${id}:${face}:${version}`;
	const cached = await getFont(key);
	if (cached) return cached;

	// The query string is what busts the service worker's cache entry too.
	const res = await fetch(assetUrl(`fonts/${path}?v=${version}`));
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	const buffer = await res.arrayBuffer();
	await putFont(key, buffer);
	return buffer;
}

const pruned = new Set<string>();

/**
 * Drop a family's superseded entries, so IndexedDB does not accumulate a copy
 * of every font release ever shipped.
 *
 * Runs whether the faces were fetched or served from cache — a hit is exactly
 * the case where an older entry is still sitting there — but only once per
 * family per session, since it has to scan the whole key list.
 */
async function dropStaleVersions(id: string, version: string): Promise<void> {
	if (pruned.has(id)) return;
	pruned.add(id);

	const keys = await listFontKeys();
	for (const key of keys) {
		if (!key.startsWith(`builtin:${id}:`)) continue;
		// Keys written before versioning existed carry no suffix at all.
		const stale = !FACE_KEYS.some((face) => key === `builtin:${id}:${face}:${version}`);
		if (stale) await deleteFont(key);
	}
}

export async function loadBuiltinFaces(
	id: string,
	warnings: string[]
): Promise<FaceBuffers> {
	const manifest = await loadManifest();
	const entry = manifest[id];
	if (!entry) throw new Error(`Unknown built-in font "${id}".`);

	const partial: Partial<FaceBuffers> = {};
	// Faces are deduplicated by path, not by face key: the emoji family points
	// all four at one file, and fetching and caching it four times would cost
	// four downloads and four IndexedDB copies of the same 845 KB.
	const byPath = new Map<string, Promise<ArrayBuffer>>();
	await Promise.all(
		FACE_KEYS.map(async (face) => {
			const path = entry.files[face];
			if (!path) return;
			try {
				let pending = byPath.get(path);
				if (!pending) {
					pending = loadFace(id, face, path, entry.version);
					byPath.set(path, pending);
				}
				partial[face] = await pending;
			} catch (e) {
				warnings.push(`${entry.name} ${face}: ${e instanceof Error ? e.message : String(e)}`);
			}
		})
	);

	// After the faces are resolved, not before: pruning first would delete the
	// very entries this load is about to read.
	void dropStaleVersions(id, entry.version);

	return completeFaces(partial, entry.name, warnings);
}
