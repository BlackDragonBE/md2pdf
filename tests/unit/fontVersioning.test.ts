import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuiltinFontManifest } from '../../src/lib/fonts/types';

const FONT_DIR = join(import.meta.dirname, '..', '..', 'static', 'fonts');
const manifest = JSON.parse(
	readFileSync(join(FONT_DIR, 'manifest.json'), 'utf8')
) as BuiltinFontManifest;

/**
 * Font files keep their names across rebuilds, so nothing about the URL or the
 * cache key changes when their contents do. Without a content version, a
 * rebuilt font is never fetched again by anyone who has already visited: it
 * shipped once with box-drawing glyphs missing and stayed that way in every
 * existing browser.
 */
describe('bundled font versioning', () => {
	const ids = Object.keys(manifest);

	it('gives every family a version', () => {
		for (const id of ids) {
			expect(manifest[id].version, `${id} has no version`).toMatch(/^[0-9a-f]{8}$/);
		}
	});

	it('derives the version from the actual bytes', () => {
		for (const id of ids) {
			const digest = createHash('sha256');
			// The distinct files the manifest points at, in face order. Not the
			// four face *names*: the emoji family aims all four at one file.
			for (const path of [...new Set(Object.values(manifest[id].files))]) {
				digest.update(readFileSync(join(FONT_DIR, path)));
			}
			expect(manifest[id].version, `${id} version is stale`).toBe(
				digest.digest('hex').slice(0, 8)
			);
		}
	});

	it('gives families with different content different versions', () => {
		const versions = ids.map((id) => manifest[id].version);
		expect(new Set(versions).size).toBe(versions.length);
	});
});
