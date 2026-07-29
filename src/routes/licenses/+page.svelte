<script lang="ts">
	import { base } from '$app/paths';
	import { assetUrl, loadManifest } from '$lib/fonts/builtin';
	import type { BuiltinFontManifest } from '$lib/fonts/types';

	let manifest = $state<BuiltinFontManifest>({});
	let error = $state<string | null>(null);

	$effect(() => {
		loadManifest()
			.then((m) => (manifest = m))
			.catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
	});

	/** The licence file sits next to the family's faces (§12.4). */
	function licenceHref(id: string): string {
		return assetUrl(`fonts/${id}/OFL.txt`);
	}
</script>

<svelte:head><title>md2pdf — font licences</title></svelte:head>

<main>
	<p class="back"><a href="{base}/">← back to the editor</a></p>
	<h1>Font licences</h1>
	<p>
		md2pdf bundles the twelve families below. Each is redistributed under its own licence, a copy of
		which is committed next to the font files in this repository.
	</p>

	{#if error}
		<p class="error">Could not load the font manifest: {error}</p>
	{/if}

	<table>
		<thead>
			<tr><th>Family</th><th>Category</th><th>Licence</th><th>Upstream</th></tr>
		</thead>
		<tbody>
			{#each Object.entries(manifest) as [id, entry] (id)}
				<tr>
					<td>{entry.name}</td>
					<td>{entry.category}</td>
					<td><a href={licenceHref(id)}>{entry.license}</a></td>
					<td>
						{#if entry.url}<a href={entry.url} rel="noreferrer">source</a>{:else}—{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>Grafted glyphs</h2>
	<p>
		Most of these families ship no ballot-box or white-bullet glyphs upstream, so the build step
		merges those few symbols in from Source Sans 3 and scales them to the host family's
		units-per-em. Both sides of every such merge are OFL-1.1. See
		<code>scripts/subset-fonts.md</code>.
	</p>

	<h2>Software</h2>
	<ul>
		<li><a href="https://github.com/bpampuch/pdfmake" rel="noreferrer">pdfmake</a> — MIT</li>
		<li><a href="https://github.com/mozilla/pdf.js" rel="noreferrer">pdf.js</a> — Apache-2.0</li>
		<li>
			<a href="https://github.com/markdown-it/markdown-it" rel="noreferrer">markdown-it</a> — MIT
		</li>
		<li>
			<a href="https://github.com/highlightjs/highlight.js" rel="noreferrer">highlight.js</a> — BSD-3-Clause
		</li>
		<li><a href="https://svelte.dev" rel="noreferrer">Svelte / SvelteKit</a> — MIT</li>
	</ul>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 32px 20px 60px;
		height: 100vh;
		overflow-y: auto;
	}
	h1 {
		font-size: 22px;
		margin: 0 0 12px;
	}
	h2 {
		font-size: 15px;
		margin: 28px 0 8px;
	}
	.back {
		margin: 0 0 20px;
		font-size: 12px;
	}
	.error {
		color: var(--error);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 12px;
	}
	th,
	td {
		text-align: left;
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
	}
	th {
		color: var(--text-dim);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	code {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--bg-raised);
		padding: 1px 4px;
		border-radius: 3px;
	}
</style>
