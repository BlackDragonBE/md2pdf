<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	/**
	 * Registered by hand. `injectRegister` is off in vite.config.ts because
	 * SvelteKit owns app.html, so nothing injects the registration for us —
	 * leave this out and the build ships a sw.js that nothing ever loads.
	 * The manifest link lives in app.html, which is prerendered; this cannot,
	 * because it needs a browser.
	 */
	onMount(async () => {
		const { registerSW } = await import('virtual:pwa-register');
		registerSW({ immediate: true });
	});
</script>

{@render children()}
