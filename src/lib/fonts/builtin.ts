import { base } from '$app/paths';
import { getFont, putFont } from './cache';
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

async function loadFace(id: string, face: FaceKey, path: string): Promise<ArrayBuffer> {
	const key = `builtin:${id}:${face}`;
	const cached = await getFont(key);
	if (cached) return cached;

	const res = await fetch(assetUrl(`fonts/${path}`));
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	const buffer = await res.arrayBuffer();
	await putFont(key, buffer);
	return buffer;
}

export async function loadBuiltinFaces(
	id: string,
	warnings: string[]
): Promise<FaceBuffers> {
	const manifest = await loadManifest();
	const entry = manifest[id];
	if (!entry) throw new Error(`Unknown built-in font "${id}".`);

	const partial: Partial<FaceBuffers> = {};
	await Promise.all(
		FACE_KEYS.map(async (face) => {
			const path = entry.files[face];
			if (!path) return;
			try {
				partial[face] = await loadFace(id, face, path);
			} catch (e) {
				warnings.push(`${entry.name} ${face}: ${e instanceof Error ? e.message : String(e)}`);
			}
		})
	);

	return completeFaces(partial, entry.name, warnings);
}
