<script lang="ts">
	import { onMount } from 'svelte';
	import { appearance } from '$lib/stores/appearance.svelte';
	import '../app.css';

	let { children } = $props();

	/**
	 * Keeps <html data-theme> in step when the preference or the OS setting
	 * changes. The *initial* value is set by an inline script in app.html —
	 * `ssr = false` means this component only runs after first paint, so doing it
	 * here alone would flash the wrong palette.
	 */
	$effect(() => appearance.apply());

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
