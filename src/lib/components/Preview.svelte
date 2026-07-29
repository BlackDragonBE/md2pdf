<script lang="ts">
	import { PreviewDocument, VIRTUALISE_ABOVE, type PageGeometry } from '$lib/preview/renderer';
	import { capture, restore, type ScrollAnchor } from '$lib/preview/scrollAnchor';

	interface Props {
		buffer: ArrayBuffer | null;
		zoom: number;
		busy: boolean;
	}
	let { buffer, zoom, busy }: Props = $props();

	const GAP = 16;

	let container = $state<HTMLElement | null>(null);
	let pages = $state<PageGeometry[]>([]);
	let canvases = $state<(HTMLCanvasElement | null)[]>([]);
	let visiblePage = $state(1);
	let renderError = $state<string | null>(null);

	let doc: PreviewDocument | null = null;
	/** Guards against two swaps racing; only the newest may commit. */
	let swapToken = 0;
	let lastKey = '';

	const pageTops = $derived(
		pages.reduce<number[]>((acc, p, i) => {
			acc.push(i === 0 ? GAP : acc[i - 1] + pages[i - 1].height + GAP);
			return acc;
		}, [])
	);

	$effect(() => {
		const key = `${buffer ? bufferKey(buffer) : 'none'}:${zoom}`;
		if (key === lastKey) return;
		lastKey = key;
		void swap(buffer, zoom);
	});

	$effect(() => () => doc?.destroy());

	function bufferKey(b: ArrayBuffer): string {
		// Identity would be ideal, but the store hands out a new buffer each render;
		// byteLength plus a rolling id is enough to detect a genuine change.
		return `${b.byteLength}:${bufferIds.get(b) ?? register(b)}`;
	}

	const bufferIds = new WeakMap<ArrayBuffer, number>();
	let nextBufferId = 1;
	function register(b: ArrayBuffer): number {
		const id = nextBufferId++;
		bufferIds.set(b, id);
		return id;
	}

	async function swap(source: ArrayBuffer | null, scale: number) {
		const token = ++swapToken;
		if (!source) {
			doc?.destroy();
			doc = null;
			pages = [];
			canvases = [];
			return;
		}

		const anchor: ScrollAnchor | null = container ? capture(container, pageTops) : null;

		let next: PreviewDocument;
		try {
			next = await PreviewDocument.open(source, scale);
		} catch (e) {
			if (token === swapToken) renderError = e instanceof Error ? e.message : String(e);
			return;
		}
		if (token !== swapToken) {
			next.destroy();
			return;
		}

		const geometry = next.geometry;
		const target = anchor ? Math.min(anchor.page, geometry.length) : 1;

		// Rasterise offscreen first, then swap in one go — never clear the
		// container before the new render resolves (§9 requirement 2).
		const rendered = await Promise.all(
			geometry.map(async (_, i) =>
				next.shouldRender(i, target) ? await next.renderPage(i, scale).catch(() => null) : null
			)
		);
		if (token !== swapToken) {
			next.destroy();
			return;
		}

		const previous = doc;
		doc = next;
		renderError = null;
		pages = geometry;
		canvases = rendered;
		visiblePage = target;

		// pdf.js documents leak without this (§9 item 5).
		previous?.destroy();

		if (anchor && container) {
			await Promise.resolve();
			restore(container, anchor, pageTopsFor(geometry));
		}
	}

	function pageTopsFor(geometry: PageGeometry[]): number[] {
		const tops: number[] = [];
		for (let i = 0; i < geometry.length; i++) {
			tops.push(i === 0 ? GAP : tops[i - 1] + geometry[i - 1].height + GAP);
		}
		return tops;
	}

	let scrollTimer: ReturnType<typeof setTimeout> | undefined;
	function onscroll() {
		if (!container) return;
		const top = container.scrollTop + container.clientHeight / 3;
		let page = 1;
		for (let i = 0; i < pageTops.length; i++) {
			if (pageTops[i] <= top) page = i + 1;
			else break;
		}
		visiblePage = page;
		if (pages.length <= VIRTUALISE_ABOVE) return;
		clearTimeout(scrollTimer);
		scrollTimer = setTimeout(() => void fillNeighbourhood(page), 120);
	}

	/** Rasterise pages that scrolled into the neighbourhood and drop those that left. */
	async function fillNeighbourhood(page: number) {
		const active = doc;
		if (!active) return;
		const token = swapToken;
		const next = [...canvases];
		let changed = false;

		await Promise.all(
			pages.map(async (_, i) => {
				const wanted = active.shouldRender(i, page);
				if (wanted && !next[i]) {
					const canvas = await active.renderPage(i, zoom).catch(() => null);
					if (token !== swapToken) return;
					next[i] = canvas;
					changed = true;
				} else if (!wanted && next[i]) {
					next[i] = null;
					changed = true;
				}
			})
		);

		if (token === swapToken && changed) canvases = next;
	}

	function attach(node: HTMLElement, canvas: HTMLCanvasElement | null) {
		const set = (c: HTMLCanvasElement | null) => {
			node.replaceChildren();
			if (c) node.appendChild(c);
		};
		set(canvas);
		return { update: set };
	}
</script>

<div class="wrap">
	<div class="viewport" bind:this={container} {onscroll} role="document" tabindex="-1">
		{#if renderError}
			<p class="error">Preview failed: {renderError}</p>
		{:else if pages.length === 0}
			<p class="empty">{busy ? 'Generating…' : 'Nothing to preview yet.'}</p>
		{:else}
			{#each pages as page, i (i)}
				<div
					class="page"
					style="width:{page.width}px;height:{page.height}px;margin-bottom:{GAP}px"
					use:attach={canvases[i]}
				></div>
			{/each}
		{/if}
	</div>
	{#if pages.length}
		<div class="status">page {visiblePage} / {pages.length}</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		height: 100%;
		background: #0f1116;
	}
	.viewport {
		height: 100%;
		overflow: auto;
		padding: 16px 0;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.viewport:focus-visible {
		outline: none;
	}
	.page {
		background: #fff;
		box-shadow: 0 2px 14px rgb(0 0 0 / 0.5);
		flex: none;
	}
	.page :global(canvas) {
		display: block;
	}
	.empty,
	.error {
		margin: 40px;
		color: var(--text-faint);
	}
	.error {
		color: var(--error);
	}
	.status {
		position: absolute;
		right: 12px;
		bottom: 12px;
		background: rgb(20 23 29 / 0.9);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 3px 10px;
		font-size: 11px;
		color: var(--text-dim);
		pointer-events: none;
	}
</style>
