import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: '404.html', strict: false }),
		paths: { base: process.env.BASE_PATH ?? '' },
		appDir: 'internal' // avoids the leading-underscore _app dir that Jekyll ignores
	}
};
