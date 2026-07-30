<script lang="ts">
	import { base } from '$app/paths';
	import Editor from '$lib/components/Editor.svelte';
	import MetaPanel from '$lib/components/MetaPanel.svelte';
	import Preview from '$lib/components/Preview.svelte';
	import Splitter from '$lib/components/Splitter.svelte';
	import ThemePanel from '$lib/components/ThemePanel.svelte';
	import { appearance, type Appearance } from '$lib/stores/appearance.svelte';
	import { docStore } from '$lib/stores/doc.svelte';
	import { pdfStore } from '$lib/stores/pdf.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { slugify } from '$lib/theme/io';
	import { readJson, writeJson } from '$lib/stores/persist';
	import { lineForPreviewOffset, previewOffsetForLine } from '$lib/preview/scrollSync';

	let zoom = $state(1);

	/**
	 * The PDF is usually what matters, so the split is adjustable and the editor
	 * can be collapsed outright. Persisted: re-dragging it every visit would be
	 * worse than not having it.
	 */
	const layout = readJson<{ editorFraction: number; showEditor: boolean }>('md2pdf:layout', {
		editorFraction: 0.42,
		showEditor: true
	});
	let editorFraction = $state(Math.min(0.75, Math.max(0.15, layout.editorFraction)));
	let showEditor = $state(layout.showEditor !== false);
	let splitTrack = $state<HTMLElement | null>(null);

	function saveLayout() {
		writeJson('md2pdf:layout', { editorFraction, showEditor });
	}

	function setEditorFraction(fraction: number) {
		editorFraction = fraction;
		saveLayout();
	}

	function toggleEditor() {
		showEditor = !showEditor;
		saveLayout();
	}

	/**
	 * Scroll sync. Each pane reports its own scrolls; the other is driven from
	 * the anchor map pdfmake produced, so the correspondence survives page
	 * breaks and tall blocks that a scroll-fraction approach would smear.
	 */
	let syncScroll = $state(readJson<boolean>('md2pdf:syncScroll', true) !== false);
	let editorRef = $state<Editor | null>(null);
	let previewRef = $state<Preview | null>(null);

	/*
	 * No debounce or mute window here on purpose. Each pane already declines to
	 * report the scrolls it performs itself, so a sync cannot echo back — and a
	 * mute window at this level would drop a genuine scroll of the other pane
	 * that happened to arrive right after one, which reads as the sync sticking.
	 */
	function syncFromEditor() {
		if (!syncScroll || !editorRef || !previewRef) return;
		const offset = previewOffsetForLine(
			pdfStore.anchors,
			editorRef.currentLine(),
			previewRef.syncGeometry()
		);
		if (offset !== null) previewRef.scrollToOffset(offset);
	}

	function syncFromPreview() {
		if (!syncScroll || !editorRef || !previewRef) return;
		const line = lineForPreviewOffset(
			pdfStore.anchors,
			previewRef.scrollOffset(),
			previewRef.syncGeometry()
		);
		if (line !== null) editorRef.scrollToLine(line);
	}

	function toggleSync() {
		syncScroll = !syncScroll;
		writeJson('md2pdf:syncScroll', syncScroll);
		if (syncScroll) syncFromEditor();
	}
	/** Zoom at which the page exactly fills the preview pane. */
	let fitZoom = $state(1);
	/** Once the reader picks a zoom, stop re-fitting under them. */
	let zoomIsUsers = false;
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
		} else if (e.key === 'e' && e.shiftKey) {
			e.preventDefault();
			toggleEditor();
		}
	}
</script>

<svelte:window {onkeydown} />

<!--
	Declared explicitly: the About page sets its own title, and without one here
	the browser tab kept saying "md2pdf — about" after navigating back.
-->
<svelte:head><title>md2pdf</title></svelte:head>

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
			<input
				type="range"
				min="0.4"
				max="2"
				step="0.05"
				value={zoom}
				oninput={(e) => {
					zoomIsUsers = true;
					zoom = Number(e.currentTarget.value);
				}}
			/>
			<span>{Math.round(zoom * 100)}%</span>
		</label>
		<button
			onclick={() => {
				zoomIsUsers = true;
				zoom = fitZoom;
			}}
			title="Fit the page to the preview width">Fit</button
		>
		<label class="appearance">
			<span class="visually-hidden">Appearance</span>
			<select
				value={appearance.preference}
				title="Light, dark or follow the system setting"
				onchange={(e) => appearance.set(e.currentTarget.value as Appearance)}
			>
				<option value="system">Auto</option>
				<option value="light">Light</option>
				<option value="dark">Dark</option>
			</select>
		</label>
		<button
			onclick={toggleSync}
			aria-pressed={syncScroll}
			title="Keep the editor and the preview scrolled to the same place"
		>
			Sync
		</button>
		<!-- A fixed label, not "Hide editor"/"Show editor": the checkbox already
		     reports the state, and a ticked box labelled "Hide editor" says the
		     opposite of what it means. -->
		<button onclick={toggleEditor} aria-pressed={showEditor} title="Show or hide the Markdown editor">
			Editor
		</button>
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
		<div class="split" bind:this={splitTrack}>
			{#if showEditor}
				<section class="editor-pane" style="flex-basis: {editorFraction * 100}%">
					{#if showMeta}
						<MetaPanel meta={docStore.meta} onchange={(patch) => docStore.setMeta(patch)} />
					{/if}
					<Editor
						bind:this={editorRef}
						value={docStore.source}
						oninput={(v) => docStore.setSource(v)}
						onnotice={(message) => (notice = message)}
						onuserscroll={syncFromEditor}
					/>
				</section>

				<Splitter
					value={editorFraction}
					track={splitTrack}
					onchange={(fraction) => setEditorFraction(fraction)}
				/>
			{/if}

			<section class="preview-pane">
				<Preview
					bind:this={previewRef}
					buffer={pdfStore.buffer}
					{zoom}
					busy={pdfStore.state === 'generating'}
					onuserscroll={syncFromPreview}
					onfit={(ratio) => {
						fitZoom = Math.min(2, Math.max(0.4, Math.round(ratio * 20) / 20));
						if (!zoomIsUsers) zoom = fitZoom;
					}}
				/>
			</section>
		</div>

		{#if showThemePanel}
			<aside><ThemePanel /></aside>
		{/if}
	</main>

	<footer>
		<span></span>
		<a href="{base}/about/">About</a>
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
	.appearance select {
		padding: 4px 6px;
		font-size: 12px;
	}
	.banner {
		padding: 6px 12px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
	.banner.error {
		background: var(--banner-error-bg);
		color: var(--error);
	}
	.banner.warn {
		background: var(--banner-warn-bg);
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
		display: flex;
		min-height: 0;
		position: relative; /* containing block for the narrow-screen theme panel */
	}
	/* The resizable pair. The theme panel sits outside it, so dragging the
	   splitter divides editor against preview and never against the panel. */
	.split {
		flex: 1 1 auto;
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.editor-pane {
		flex: 0 0 auto;
	}
	.preview-pane {
		flex: 1 1 auto;
	}
	aside {
		flex: 0 0 340px;
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
	}
	aside {
		overflow: hidden;
		border-left: 1px solid var(--border);
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
		aside {
			position: absolute;
			inset: 0 0 0 auto;
			width: min(340px, 92vw);
			z-index: 5;
			box-shadow: -8px 0 24px rgb(0 0 0 / 0.45);
		}
	}

	/* Stacked, so a horizontal splitter would make no sense; the editor can
	   still be collapsed from the toolbar. */
	@media (max-width: 720px) {
		.split {
			flex-direction: column;
		}
		/* `height: 100%` is right for a row split and wrong for a column one:
		   both panes would demand the full height and fight the flex sizing,
		   collapsing the editor to a couple of rows. */
		.editor-pane,
		.preview-pane {
			height: auto;
		}
		.editor-pane {
			flex: 1 1 0 !important;
			border-bottom: 1px solid var(--border);
		}
		.preview-pane {
			flex: 1 1 0;
		}
		.split :global(.splitter) {
			display: none;
		}
	}
</style>
