import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

/**
 * Deliberately not the SvelteKit config: the unit and golden suites exercise
 * pure modules and a Node-side pdfmake printer, so pulling in the Kit plugin
 * (and its $app/* virtual modules) would only add failure surface.
 */
export default defineConfig({
	plugins: [svelte({ hot: false })],
	test: {
		include: ['tests/unit/**/*.test.ts', 'tests/golden/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 30000
	}
});
