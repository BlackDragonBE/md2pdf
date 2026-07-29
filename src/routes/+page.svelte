<script lang="ts">
	import { base } from '$app/paths';
	import Editor from '$lib/components/Editor.svelte';
	import MetaPanel from '$lib/components/MetaPanel.svelte';
	import Preview from '$lib/components/Preview.svelte';
	import ThemePanel from '$lib/components/ThemePanel.svelte';
	import { docStore } from '$lib/stores/doc.svelte';
	import { pdfStore } from '$lib/stores/pdf.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { slugify } from '$lib/theme/io';

	let zoom = $state(1);
	/** Transient editor notice, e.g. an image paste that was too large. */
	let notice = $state<string | null>(null);
	let showMeta = $state(false);
	let showThemePanel = $state(true);
	let firstRender = true;

	// Any of these changing re-renders; the store debounces and discards stale ids.
	$effect(() => {
		const input = {
			source: docStore.source,
			theme: themeStore.snapshot(),
			metaOverrides: { ...docStore.meta }
		};
		if (firstRender) {
			firstRender = false;
			pdfStore.renderNow(input);
		} else {
			pdfStore.schedule(input);
		}
	});

	function download() {
		const blob = pdfStore.blob();
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		// Front matter first, then the metadata panel, then the theme name.
		a.download = `${slugify(pdfStore.meta.title || docStore.meta.title || themeStore.current.name)}.pdf`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.key === 's') {
			e.preventDefault();
			download();
		} else if (e.key === 'b' && e.shiftKey) {
			e.preventDefault();
			showThemePanel = !showThemePanel;
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="app" class:no-panel={!showThemePanel}>
	<header>
		<strong>md2pdf</strong>
		<span
			class="state"
			data-state={pdfStore.state}
			data-render={pdfStore.completedId}
			aria-live="polite"
		>
			{pdfStore.state === 'generating'
				? 'generating…'
				: pdfStore.state === 'error'
					? 'error'
					: `${pdfStore.pageCount} page${pdfStore.pageCount === 1 ? '' : 's'}`}
		</span>
		<div class="spacer"></div>
		<label class="zoom">
			zoom
			<input type="range" min="0.4" max="2" step="0.1" bind:value={zoom} />
			<span>{Math.round(zoom * 100)}%</span>
		</label>
		<button onclick={() => (showMeta = !showMeta)} aria-pressed={showMeta}>Metadata</button>
		<button onclick={() => (showThemePanel = !showThemePanel)} aria-pressed={showThemePanel}>
			Theme
		</button>
		<button class="primary" onclick={download} disabled={!pdfStore.buffer}>Download PDF</button>
	</header>

	{#if pdfStore.error}
		<div class="banner error">Generation failed: {pdfStore.error}</div>
	{/if}
	{#if pdfStore.usingMainThread}
		<div class="banner warn">
			The PDF worker could not start; generating on the main thread. Typing may stutter on long
			documents.
		</div>
	{/if}
	{#if notice}
		<div class="banner warn">
			{notice}
			<button class="dismiss" onclick={() => (notice = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}
	{#if pdfStore.warnings.length}
		<details class="banner warn">
			<summary>{pdfStore.warnings.length} warning{pdfStore.warnings.length === 1 ? '' : 's'}</summary>
			<ul>
				{#each pdfStore.warnings as w (w)}
					<li>{w}</li>
				{/each}
			</ul>
		</details>
	{/if}

	<main>
		<section class="editor-pane">
			{#if showMeta}
				<MetaPanel meta={docStore.meta} onchange={(patch) => docStore.setMeta(patch)} />
			{/if}
			<Editor
				value={docStore.source}
				oninput={(v) => docStore.setSource(v)}
				onnotice={(message) => (notice = message)}
			/>
		</section>

		<section class="preview-pane">
			<Preview buffer={pdfStore.buffer} {zoom} busy={pdfStore.state === 'generating'} />
		</section>

		{#if showThemePanel}
			<aside><ThemePanel /></aside>
		{/if}
	</main>

	<footer>
		<span>Everything runs in your browser. Nothing is uploaded.</span>
		<a href="{base}/licenses/">Font licences</a>
	</footer>
</div>

<style>
	/*
	 * Flex column, not a grid with fixed rows: the number of banner elements
	 * varies from zero to three, and positional grid rows put <main> on whichever
	 * track happens to line up — with no banners it landed on an `auto` track and
	 * grew to its content height.
	 */
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
	}
	header,
	footer,
	.banner {
		flex: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.state {
		font-size: 11.5px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.state[data-state='generating'] {
		color: var(--accent);
	}
	.state[data-state='error'] {
		color: var(--error);
	}
	.spacer {
		flex: 1;
	}
	.zoom {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		color: var(--text-dim);
	}
	.zoom input {
		width: 96px;
		padding: 0;
	}
	.zoom span {
		width: 34px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.banner {
		padding: 6px 12px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
	.banner.error {
		background: #3a1f26;
		color: var(--error);
	}
	.banner.warn {
		background: #3a2f1c;
		color: var(--warn);
	}
	.banner ul {
		margin: 6px 0 2px;
		padding-left: 18px;
	}
	.banner summary {
		cursor: pointer;
	}
	.dismiss {
		float: right;
		padding: 0 6px;
		line-height: 1.2;
		background: transparent;
		border-color: transparent;
		color: inherit;
	}
	main {
		flex: 1 1 auto;
		display: grid;
		grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.15fr) 340px;
		min-height: 0;
		position: relative; /* containing block for the narrow-screen theme panel */
	}
	.app.no-panel main {
		grid-template-columns: minmax(280px, 1fr) minmax(320px, 1.15fr);
	}
	/*
	 * `min-height: 0` on every pane is what actually makes the inner
	 * `overflow: auto` work. Grid and flex items default to `min-height: auto`,
	 * so without it a pane grows to its content height, overflows its track, and
	 * no descendant ever becomes a scroll container — the editor, the preview and
	 * the theme panel were all unscrollable for this reason.
	 */
	.editor-pane,
	.preview-pane,
	aside {
		min-width: 0;
		min-height: 0;
		height: 100%;
	}
	.editor-pane {
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
	}
	aside {
		overflow: hidden;
	}
	footer {
		display: flex;
		justify-content: space-between;
		padding: 5px 12px;
		border-top: 1px solid var(--border);
		background: var(--bg-panel);
		font-size: 11px;
		color: var(--text-faint);
	}

	/*
	 * Below this width the panel becomes an overlay rather than disappearing.
	 * It used to be `display: none` while the Theme button carried on reporting
	 * aria-pressed="true" — a control that lies about its own state and does
	 * nothing when clicked.
	 */
	@media (max-width: 1100px) {
		main,
		.app.no-panel main {
			grid-template-columns: 1fr 1fr;
		}
		aside {
			position: absolute;
			inset: 0 0 0 auto;
			width: min(340px, 92vw);
			z-index: 5;
			box-shadow: -8px 0 24px rgb(0 0 0 / 0.45);
		}
	}

	@media (max-width: 720px) {
		main,
		.app.no-panel main {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
