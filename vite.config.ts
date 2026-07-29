import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
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
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}', '**/fonts/manifest.json'],
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
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
