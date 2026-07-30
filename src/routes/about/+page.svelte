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

<svelte:head><title>md2pdf — about</title></svelte:head>

<main>
	<p class="back"><a href="{base}/">← back to the editor</a></p>

	<h1>About md2pdf</h1>
	<p class="lead">
		Markdown in, a deeply themeable PDF out — entirely inside your browser. There is no server, no
		upload and no account. Your document never leaves the machine you are typing on.
	</p>

	<h2>How it works</h2>
	<p>
		Markdown is parsed to a token stream, turned into a document definition, and rendered to PDF by
		<a href="https://github.com/bpampuch/pdfmake" rel="noreferrer">pdfmake</a> in a Web Worker. The
		preview you see is that exact PDF, rasterised by
		<a href="https://github.com/mozilla/pdf.js" rel="noreferrer">pdf.js</a>. Preview and download are
		the same bytes — there is no second renderer for them to disagree about.
	</p>
	<p>
		Everything visual is a theme field: page geometry, three font slots, per-element typography and
		spacing, background colour and image, watermark, cover page, running header and footer, and
		page-break behaviour. Themes are portable JSON; a partial or hand-edited file is merged over the
		defaults, and a malformed one degrades with warnings rather than breaking the render.
	</p>
	<p>
		The document, your theme and any fonts you use are stored locally — <code>localStorage</code> for
		text and settings, IndexedDB for font binaries — so it works offline after the first visit and
		installs as an app.
	</p>

	<h2>Fonts</h2>
	<p>
		Twelve text families are bundled as subsetted <em>static</em> instances, four real faces each.
		You can also upload your own TTF or OTF, or pull a family from Google Fonts.
	</p>
	<p>
		A thirteenth, Noto Emoji, is never a font slot you can pick. pdfmake binds one font per run of
		text and pdfkit has no glyph fallback, so an emoji in a Latin-subset family is a blank box.
		Runs containing emoji are cut out and pointed at this family instead, and it is fetched only
		for a document that has emoji in it.
	</p>

	<p>
		Most of these families are published upstream only as variable fonts, which pdfkit renders at
		their default instance — a "Bold" request would silently come out Regular — so each face is
		instanced to a fixed weight at build time. Several ship no ballot-box, bullet or box-drawing
		glyphs at all, so those are grafted in from Source Sans 3 and JetBrains Mono, scaled to the host
		family's units-per-em. Every font involved is OFL-1.1, so the merged output stays correctly
		licensed.
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

	<h2>Emoji</h2>
	<p>
		Emoji render in <strong>colour</strong>, as vector artwork rather than glyphs. A PDF cannot
		carry a colour font at all — the format has no such concept, and pdfkit embeds outlines only
		— so each emoji is drawn into the page as a small picture instead. That also means they stay
		sharp at any zoom or print size, and the document embeds no raster images.
	</p>
	<p>
		The artwork is
		<a href="https://github.com/jdecked/twemoji" rel="noreferrer">Twemoji</a>, 3,720 emoji packed
		into a single ~1.4 MB archive that is fetched the first time you use one and then cached. A
		document with no emoji never downloads it. Where a sequence has no artwork — or on a first
		visit while offline — the monochrome Noto Emoji font above is used instead, so emoji never
		fall back to blank boxes.
	</p>
	<p class="attribution">
		Twemoji artwork is © Twitter and the Twemoji contributors, licensed
		<a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC-BY 4.0</a>.
	</p>

	<h2>Built with</h2>
	<ul>
		<li><a href="https://svelte.dev" rel="noreferrer">Svelte 5 &amp; SvelteKit</a> — MIT</li>
		<li><a href="https://github.com/bpampuch/pdfmake" rel="noreferrer">pdfmake</a> — MIT</li>
		<li><a href="https://github.com/mozilla/pdf.js" rel="noreferrer">pdf.js</a> — Apache-2.0</li>
		<li>
			<a href="https://github.com/markdown-it/markdown-it" rel="noreferrer">markdown-it</a> — MIT
		</li>
		<li>
			<a href="https://github.com/highlightjs/highlight.js" rel="noreferrer">highlight.js</a> —
			BSD-3-Clause
		</li>
		<li><a href="https://github.com/fontello/wawoff2" rel="noreferrer">wawoff2</a> — MIT</li>
		<li><a href="https://github.com/101arrowz/fflate" rel="noreferrer">fflate</a> — MIT</li>
		<li><a href="https://github.com/fonttools/fonttools" rel="noreferrer">fontTools</a> — MIT</li>
	</ul>

	<h2>Source</h2>
	<p>
		Inspired by
		<a href="https://github.com/LapchienSun/Markdown-To-PDF" rel="noreferrer">Markdown-To-PDF</a>.
		The code is on
		<a href="https://github.com/BlackDragonBE/md2pdf" rel="noreferrer">GitHub</a>; application code
		is MIT, and the bundled fonts keep their own licences as listed above.
	</p>
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 32px 20px 60px;
		height: 100vh;
		height: 100dvh;
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
	.lead {
		color: var(--text);
		font-size: 14px;
	}
	p {
		color: var(--text-dim);
		line-height: 1.6;
	}
	.back {
		margin: 0 0 20px;
		font-size: 12px;
	}
	.attribution {
		font-size: 0.9em;
		color: var(--text-dim);
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
	li {
		color: var(--text-dim);
		line-height: 1.7;
	}
	code {
		font-family: var(--mono);
		font-size: 12px;
		background: var(--bg-raised);
		padding: 1px 4px;
		border-radius: 3px;
	}
</style>
