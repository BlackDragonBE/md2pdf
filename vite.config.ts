import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import { transformPrecacheManifest } from './build-config/precacheTransform';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			// SvelteKit owns app.html, so nothing auto-injects the manifest link or
			// the registration script — without this being explicit, the generated
			// sw.js and manifest.webmanifest ship but are never referenced, and the
			// app silently is not a PWA. Both are wired up in +layout.svelte.
			injectRegister: null,
			manifest: {
				name: 'md2pdf',
				short_name: 'md2pdf',
				description: 'Markdown to themeable PDF, entirely in your browser.',
				theme_color: '#1c1f26',
				background_color: '#1c1f26',
				display: 'standalone',
				icons: [
					{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'icons/icon-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// App shell + the default family only. The other eleven are lazy-fetched (§11).
				// `webmanifest` is deliberately absent: the plugin adds its own entry
				// for it, and globbing it too yields two entries for the same URL with
				// different revisions, which makes workbox refuse to install.
				// The emoji archive is deliberately absent: it is ~1.4 MB and only a
				// document that actually contains an emoji ever needs it. Its
				// manifest is tiny, so that one is precached.
				globPatterns: [
					'**/*.{js,css,html,ico,png,svg}',
					'**/fonts/manifest.json',
					'**/emoji/manifest.json'
				],
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				// See build-config/precacheTransform.ts for why this is necessary.
				manifestTransforms: [(entries) => transformPrecacheManifest(entries)],
				// Relative, so it resolves against the worker's scope, not the origin.
				navigateFallback: 'index.html',
				// Never hand the HTML shell to a request for an actual file.
				navigateFallbackDenylist: [/\.[a-z0-9]+$/i],
				runtimeCaching: [
					{
						urlPattern: /\/fonts\/inter\/.*\.ttf$/,
						handler: 'CacheFirst',
						options: { cacheName: 'md2pdf-default-font' }
					},
					{
						urlPattern: /\/fonts\/(?!inter\/).*\.ttf$/,
						handler: 'CacheFirst',
						options: { cacheName: 'md2pdf-fonts', expiration: { maxEntries: 60 } }
					},
					{
						urlPattern: /\/emoji\/.*\.bin$/,
						handler: 'CacheFirst',
						options: { cacheName: 'md2pdf-emoji', expiration: { maxEntries: 2 } }
					},
					{
						urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
						handler: 'NetworkFirst',
						options: { cacheName: 'md2pdf-google-fonts' }
					}
				]
			}
		})
	],
	worker: { format: 'es' },
	// wawoff2's Emscripten binding is loaded verbatim as a classic script via
	// `?url` (see src/lib/fonts/google.ts); pre-bundling it to ESM is exactly
	// what breaks it.
	optimizeDeps: { exclude: ['wawoff2'] }
});
