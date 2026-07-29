/** Matches workbox's `ManifestEntry & { size: number }`. */
export interface PrecacheEntry {
	url: string;
	revision: string | null;
	integrity?: string;
	size: number;
}

/** Name vite-plugin-pwa appends its own webmanifest entry under, after transforms. */
export const WEB_MANIFEST = 'manifest.webmanifest';

/** The adapter fallback (404.html) is not part of the app shell. */
export const ADAPTER_FALLBACK = 'prerendered/fallback.html';

/**
 * Rewrites the workbox precache list for a SvelteKit static build.
 *
 * Replaces @vite-pwa/sveltekit's own transform, which derives its prefix from
 * Vite's `base` — and SvelteKit leaves that at `/` while serving the app from
 * `paths.base`. On a project site the result is an app shell precached as the
 * root-absolute `/`, with the navigation fallback bound to it, so the worker
 * answers *every* in-scope navigation with whatever lives at the domain root.
 * The app loads once and is then permanently replaced by someone else's page.
 *
 * Three rules, each of which cost real debugging:
 *
 * 1. **Strip the output-layout prefixes.** Supplying `manifestTransforms`
 *    overrides the plugin's rather than running alongside it, so `client/` and
 *    `prerendered/*` have to be handled here too.
 * 2. **Emit scope-relative URLs.** Workbox resolves them against sw.js's own
 *    location, so one build is correct at `/` and at `/<repo>/`.
 * 3. **Drop the globbed webmanifest.** vite-plugin-pwa appends its own entry
 *    afterwards; two entries for one URL at different revisions makes workbox
 *    reject the list, leaving a registered worker whose precache silently never
 *    populates and an app that is not actually offline-capable.
 */
export function transformPrecacheManifest(entries: PrecacheEntry[]): {
	manifest: PrecacheEntry[];
	warnings: string[];
} {
	const manifest = entries
		.filter(({ url }) => url !== ADAPTER_FALLBACK)
		.map((entry) => ({
			...entry,
			url: entry.url
				.replace(/^client\//, '')
				.replace(/^prerendered\/dependencies\//, '')
				.replace(/^prerendered\/pages\//, '')
				.replace(/^\//, '')
		}))
		.filter(({ url }) => url !== WEB_MANIFEST);

	return { manifest, warnings: [] };
}
