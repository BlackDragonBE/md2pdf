import { describe, expect, it } from 'vitest';
import {
	ADAPTER_FALLBACK,
	WEB_MANIFEST,
	transformPrecacheManifest,
	type PrecacheEntry
} from '../../build-config/precacheTransform';

/** A realistic slice of what workbox globs out of .svelte-kit/output. */
const RAW: PrecacheEntry[] = [
	{ url: 'prerendered/pages/index.html', revision: 'a', size: 1 },
	{ url: 'prerendered/pages/licenses/index.html', revision: 'b', size: 1 },
	{ url: 'client/internal/immutable/entry/app.js', revision: null, size: 1 },
	{ url: 'client/internal/immutable/assets/0.css', revision: null, size: 1 },
	{ url: 'client/fonts/manifest.json', revision: 'c', size: 1 },
	{ url: 'client/icons/icon-192.png', revision: 'd', size: 1 },
	{ url: 'client/manifest.webmanifest', revision: 'e', size: 1 },
	{ url: 'prerendered/dependencies/something.json', revision: 'f', size: 1 },
	{ url: ADAPTER_FALLBACK, revision: 'g', size: 1 }
];

function urls(entries: PrecacheEntry[]): string[] {
	return transformPrecacheManifest(entries).manifest.map((entry) => entry.url);
}

describe('precache manifest transform', () => {
	/**
	 * The one that matters: a root-absolute entry makes the navigation fallback
	 * resolve to the domain root, and the worker then answers every in-scope
	 * navigation with a different site's page.
	 */
	it('never emits a root-absolute URL', () => {
		const out = urls([...RAW, { url: '/', revision: 'x', size: 1 },
			{ url: '/nested/thing.js', revision: null, size: 1 }]);
		expect(out.filter((url) => url.startsWith('/'))).toEqual([]);
	});

	it('strips the SvelteKit output-layout prefixes', () => {
		const out = urls(RAW);
		expect(out).toContain('index.html');
		expect(out).toContain('licenses/index.html');
		expect(out).toContain('internal/immutable/entry/app.js');
		expect(out).toContain('fonts/manifest.json');
		expect(out).toContain('something.json');
		expect(out.some((url) => url.startsWith('client/'))).toBe(false);
		expect(out.some((url) => url.startsWith('prerendered/'))).toBe(false);
	});

	it('keeps the navigation fallback target in the list', () => {
		// `navigateFallback: 'index.html'` binds a handler to this exact URL;
		// if it is absent workbox throws at install time.
		expect(urls(RAW)).toContain('index.html');
	});

	it('drops the adapter fallback', () => {
		expect(urls(RAW)).not.toContain(ADAPTER_FALLBACK);
		expect(urls(RAW)).not.toContain('fallback.html');
	});

	/**
	 * vite-plugin-pwa appends its own webmanifest entry after transforms run.
	 * Leaving the globbed copy in gives two entries for one URL at different
	 * revisions, which workbox rejects — the worker registers but its precache
	 * silently never populates, so the app looks installed and is not offline-capable.
	 */
	it('drops the globbed webmanifest so the appended one cannot conflict', () => {
		expect(urls(RAW)).not.toContain(WEB_MANIFEST);
	});

	it('emits no duplicate URLs', () => {
		const out = urls(RAW);
		expect(new Set(out).size).toBe(out.length);
	});

	it('preserves revisions and passes null through for hashed assets', () => {
		const { manifest } = transformPrecacheManifest(RAW);
		expect(manifest.find((e) => e.url === 'index.html')?.revision).toBe('a');
		expect(manifest.find((e) => e.url === 'internal/immutable/entry/app.js')?.revision).toBeNull();
	});

	it('does not mutate its input', () => {
		const input: PrecacheEntry[] = [{ url: 'client/a.js', revision: '1', size: 1 }];
		transformPrecacheManifest(input);
		expect(input[0].url).toBe('client/a.js');
	});

	it('returns no warnings', () => {
		expect(transformPrecacheManifest(RAW).warnings).toEqual([]);
	});

	it('handles an empty list', () => {
		expect(transformPrecacheManifest([])).toEqual({ manifest: [], warnings: [] });
	});
});
