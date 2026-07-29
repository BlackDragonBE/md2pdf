<script lang="ts">
	import ColorInput from './controls/ColorInput.svelte';
	import ElementStyleEditor from './controls/ElementStyleEditor.svelte';
	import Field from './controls/Field.svelte';
	import FontPicker from './controls/FontPicker.svelte';
	import MarginInput from './controls/MarginInput.svelte';
	import NumberInput from './controls/NumberInput.svelte';
	import Section from './controls/Section.svelte';
	import { PRESETS } from '$lib/theme/presets';
	import { approxDataUriBytes } from '$lib/theme/io';
	import type { ElementKey, ElementStyleT, FontRole, ImageSpecT, Theme } from '$lib/theme/schema';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { pdfStore } from '$lib/stores/pdf.svelte';

	const t = $derived(themeStore.current);

	const ELEMENTS: [ElementKey, string][] = [
		['h1', 'Heading 1'],
		['h2', 'Heading 2'],
		['h3', 'Heading 3'],
		['h4', 'Heading 4'],
		['h5', 'Heading 5'],
		['h6', 'Heading 6'],
		['paragraph', 'Paragraph'],
		['listItem', 'List item'],
		['blockquote', 'Blockquote'],
		['codeBlock', 'Code block'],
		['inlineCode', 'Inline code'],
		['tableHeader', 'Table header'],
		['tableCell', 'Table cell']
	];

	const TEMPLATE_HINT = '{{page}} {{pages}} {{title}} {{subtitle}} {{author}} {{date}}';

	const ROLES: FontRole[] = ['body', 'heading', 'mono'];
	const ROLE_LABEL: Record<FontRole, string> = {
		body: 'Body',
		heading: 'Heading',
		mono: 'Monospace'
	};

	function edit(mutate: (d: Theme) => void) {
		themeStore.update(mutate);
	}

	function editElement(key: ElementKey, patch: Partial<ElementStyleT>) {
		edit((d) => Object.assign(d.elements[key], patch));
	}

	function failureFor(role: FontRole): string | null {
		return pdfStore.fontFailures.find((f) => f.role === role)?.reason ?? null;
	}

	async function pickImage(apply: (spec: ImageSpecT | null) => void) {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const dataUri = await new Promise<string>((resolve, reject) => {
				const fr = new FileReader();
				fr.onload = () => resolve(String(fr.result));
				fr.onerror = () => reject(fr.error);
				fr.readAsDataURL(file);
			});
			if (approxDataUriBytes(dataUri) > 4 * 1024 * 1024) {
				imageError = `${file.name} is over 4 MB — pick a smaller image.`;
				return;
			}
			imageError = null;
			apply({ dataUri, fit: 'cover', opacity: 1 });
		};
		input.click();
	}

	let imageError = $state<string | null>(null);

	function importFile(accept: string, handler: (file: File) => void) {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.onchange = () => {
			const file = input.files?.[0];
			if (file) handler(file);
		};
		input.click();
	}

	async function importTheme() {
		importFile('.json,.mdtheme,application/json', async (file) => {
			if (file.name.endsWith('.mdtheme')) {
				const { importMdTheme } = await import('$lib/theme/io');
				const bytes = new Uint8Array(await file.arrayBuffer());
				const result = importMdTheme(bytes);
				const { putUpload } = await import('$lib/fonts/cache');
				for (const [name, data] of result.fonts) {
					const m = /^(.+)-(normal|bold|italics|bolditalics)\.ttf$/.exec(name);
					if (!m) continue;
					const buffer = new ArrayBuffer(data.byteLength);
					new Uint8Array(buffer).set(data);
					await putUpload(`${m[1]}:${m[2]}`, {
						bytes: buffer,
						family: result.theme.name,
						face: m[2],
						name
					});
				}
				pdfStore.invalidateFonts();
				themeStore.set(result.theme, result.warnings);
				themeStore.remember(result.theme);
				return;
			}
			themeStore.loadJson(await file.text());
			pdfStore.invalidateFonts();
		});
	}

	async function exportThemeFile() {
		const uploads: { hash: string; family: string; face: string; bytes: Uint8Array }[] = [];
		const snapshot = themeStore.snapshot();
		const uploadSlots = Object.values(snapshot.fonts).filter((s) => s.source.kind === 'upload');
		if (uploadSlots.length) {
			const { getUpload } = await import('$lib/fonts/cache');
			for (const s of uploadSlots) {
				if (s.source.kind !== 'upload') continue;
				for (const face of ['normal', 'bold', 'italics', 'bolditalics']) {
					const rec = await getUpload(`${s.source.hash}:${face}`);
					if (rec)
						uploads.push({
							hash: s.source.hash,
							family: s.source.family,
							face,
							bytes: new Uint8Array(rec.bytes)
						});
				}
			}
		}
		const out = themeStore.export(uploads);
		const url = URL.createObjectURL(out.blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = out.filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<div class="panel">
	<div class="toolbar">
		<input
			class="name"
			type="text"
			value={t.name}
			aria-label="Theme name"
			onchange={(e) => edit((d) => (d.name = e.currentTarget.value || 'Untitled'))}
		/>
		<button onclick={importTheme} title="Import a .theme.json or .mdtheme">Import</button>
		<button onclick={exportThemeFile} title="Export this theme">Export</button>
		<button
			onclick={() => {
				themeStore.reset();
				pdfStore.invalidateFonts();
			}}>Reset</button
		>
	</div>

	{#if themeStore.warnings.length}
		<ul class="warnings">
			{#each themeStore.warnings as w (w)}
				<li>{w}</li>
			{/each}
		</ul>
	{/if}
	{#if themeStore.persistError}
		<ul class="warnings"><li>{themeStore.persistError}</li></ul>
	{/if}
	{#if imageError}
		<ul class="warnings"><li>{imageError}</li></ul>
	{/if}

	<Section title="Presets">
		<div class="presets">
			{#each PRESETS as preset (preset.name)}
				<button
					onclick={() => {
						themeStore.loadObject(preset.theme);
						pdfStore.invalidateFonts();
					}}>{preset.name}</button
				>
			{/each}
		</div>
		{#if themeStore.recent.length}
			<Field label="Recent">
				<select
					onchange={(e) => {
						const hit = themeStore.recent[Number(e.currentTarget.value)];
						if (hit) {
							themeStore.loadJson(hit.json);
							pdfStore.invalidateFonts();
						}
					}}
				>
					<option value="-1">—</option>
					{#each themeStore.recent as r, i (r.json)}
						<option value={i}>{r.name}</option>
					{/each}
				</select>
			</Field>
		{/if}
	</Section>

	<Section title="Page" open>
		<Field label="Size">
			<select
				value={t.page.size}
				onchange={(e) =>
					edit((d) => (d.page.size = e.currentTarget.value as Theme['page']['size']))}
			>
				{#each ['A3', 'A4', 'A5', 'LETTER', 'LEGAL', 'TABLOID'] as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</Field>
		<Field label="Orientation">
			<select
				value={t.page.orientation}
				onchange={(e) =>
					edit(
						(d) =>
							(d.page.orientation = e.currentTarget.value as Theme['page']['orientation'])
					)}
			>
				<option value="portrait">portrait</option>
				<option value="landscape">landscape</option>
			</select>
		</Field>
		<Field label="Margins" hint="left, top, right, bottom (pt)">
			<MarginInput
				value={t.page.margins}
				min={0}
				onchange={(margins) => edit((d) => (d.page.margins = margins))}
			/>
		</Field>
		<Field label="Locale" hint="Used to format {'{{date}}'}">
			<input
				type="text"
				spellcheck="false"
				value={t.locale}
				onchange={(e) => edit((d) => (d.locale = e.currentTarget.value || 'en-GB'))}
			/>
		</Field>
		<Field label="Page-break marker">
			<input
				type="text"
				spellcheck="false"
				value={t.pagebreak.marker}
				onchange={(e) => edit((d) => (d.pagebreak.marker = e.currentTarget.value))}
			/>
		</Field>
	</Section>

	<Section title="Fonts">
		{#each ROLES as role (role)}
			<FontPicker
				label={ROLE_LABEL[role]}
				slot={t.fonts[role]}
				failure={failureFor(role)}
				onchange={(next) =>
					edit((d) => {
						d.fonts[role] = next;
						pdfStore.invalidateFonts();
					})}
			/>
		{/each}
	</Section>

	<Section title="Background">
		<Field label="Colour">
			<ColorInput
				value={t.background.color}
				onchange={(c) => c && edit((d) => (d.background.color = c))}
			/>
		</Field>
		<Field label="Image">
			<button onclick={() => pickImage((spec) => edit((d) => (d.background.image = spec)))}>
				{t.background.image ? 'Replace' : 'Choose'}
			</button>
			{#if t.background.image}
				<button onclick={() => edit((d) => (d.background.image = null))}>Clear</button>
			{/if}
		</Field>
		{#if t.background.image}
			<Field label="Fit">
				<select
					value={t.background.image.fit}
					onchange={(e) =>
						edit((d) => {
							if (d.background.image)
								d.background.image.fit = e.currentTarget.value as ImageSpecT['fit'];
						})}
				>
					{#each ['cover', 'contain', 'stretch', 'tile'] as f (f)}
						<option value={f}>{f}</option>
					{/each}
				</select>
			</Field>
			<Field label="Opacity">
				<NumberInput
					value={t.background.image.opacity}
					min={0}
					max={1}
					step={0.05}
					onchange={(o) =>
						edit((d) => {
							if (d.background.image) d.background.image.opacity = o;
						})}
				/>
			</Field>
		{/if}
	</Section>

	<Section title="Watermark">
		<Field label="Enabled">
			<input
				type="checkbox"
				checked={t.watermark.enabled}
				onchange={(e) => edit((d) => (d.watermark.enabled = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Text">
			<input
				type="text"
				maxlength="40"
				value={t.watermark.text}
				onchange={(e) => edit((d) => (d.watermark.text = e.currentTarget.value))}
			/>
		</Field>
		<Field label="Angle">
			<NumberInput
				value={t.watermark.angle}
				min={-90}
				max={90}
				suffix="°"
				onchange={(v) => edit((d) => (d.watermark.angle = v))}
			/>
		</Field>
		<Field label="Opacity">
			<NumberInput
				value={t.watermark.opacity}
				min={0}
				max={1}
				step={0.01}
				onchange={(v) => edit((d) => (d.watermark.opacity = v))}
			/>
		</Field>
		<Field label="Size">
			<NumberInput
				value={t.watermark.size}
				min={8}
				max={200}
				suffix="pt"
				onchange={(v) => edit((d) => (d.watermark.size = v))}
			/>
		</Field>
		<Field label="Colour">
			<ColorInput
				value={t.watermark.color}
				onchange={(c) => c && edit((d) => (d.watermark.color = c))}
			/>
		</Field>
		<Field label="Font slot">
			<select
				value={t.watermark.font}
				onchange={(e) => edit((d) => (d.watermark.font = e.currentTarget.value as FontRole))}
			>
				{#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
			</select>
		</Field>
	</Section>

	<Section title="Cover page">
		<Field label="Enabled">
			<input
				type="checkbox"
				checked={t.cover.enabled}
				onchange={(e) => edit((d) => (d.cover.enabled = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Exclude from page count">
			<input
				type="checkbox"
				checked={t.cover.excludeFromPageCount}
				onchange={(e) => edit((d) => (d.cover.excludeFromPageCount = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Background">
			<ColorInput
				value={t.cover.background.color}
				onchange={(c) => c && edit((d) => (d.cover.background.color = c))}
			/>
		</Field>
		<Field label="Image">
			<button onclick={() => pickImage((spec) => edit((d) => (d.cover.background.image = spec)))}>
				{t.cover.background.image ? 'Replace' : 'Choose'}
			</button>
			{#if t.cover.background.image}
				<button onclick={() => edit((d) => (d.cover.background.image = null))}>Clear</button>
			{/if}
		</Field>

		<div class="blocks">
			{#each t.cover.blocks as block, i (i)}
				<div class="block">
					<div class="block-head">
						<select
							aria-label="Cover block {i + 1} content"
							value={block.field}
							onchange={(e) =>
								edit(
									(d) =>
										(d.cover.blocks[i].field = e.currentTarget
											.value as (typeof block)['field'])
								)}
						>
							{#each ['title', 'subtitle', 'author', 'date', 'literal'] as f (f)}
								<option value={f}>{f}</option>
							{/each}
						</select>
						<button
							title="Remove this block"
							aria-label="Remove cover block {i + 1}"
							onclick={() => edit((d) => d.cover.blocks.splice(i, 1))}>×</button
						>
					</div>
					{#if block.field === 'literal'}
						<Field label="Text">
							<input
								type="text"
								value={block.literal}
								onchange={(e) => edit((d) => (d.cover.blocks[i].literal = e.currentTarget.value))}
							/>
						</Field>
					{/if}
					<Field label="Y position" hint="Percentage of page height">
						<input
							type="text"
							value={block.y}
							onchange={(e) => {
								const v = e.currentTarget.value.trim();
								if (/^\d{1,3}(\.\d+)?%$/.test(v)) edit((d) => (d.cover.blocks[i].y = v));
								else e.currentTarget.value = block.y;
							}}
						/>
					</Field>
					<Field label="Size">
						<NumberInput
							value={block.size}
							min={6}
							max={120}
							suffix="pt"
							onchange={(v) => edit((d) => (d.cover.blocks[i].size = v))}
						/>
					</Field>
					<Field label="Colour">
						<ColorInput
							value={block.color}
							onchange={(c) => c && edit((d) => (d.cover.blocks[i].color = c))}
						/>
					</Field>
					<Field label="Alignment">
						<select
							value={block.alignment}
							onchange={(e) =>
								edit(
									(d) =>
										(d.cover.blocks[i].alignment = e.currentTarget
											.value as (typeof block)['alignment'])
								)}
						>
							<option value="left">left</option>
							<option value="center">center</option>
							<option value="right">right</option>
						</select>
					</Field>
					<Field label="Font slot">
						<select
							value={block.font}
							onchange={(e) =>
								edit((d) => (d.cover.blocks[i].font = e.currentTarget.value as FontRole))}
						>
							{#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
						</select>
					</Field>
					<Field label="Bold">
						<input
							type="checkbox"
							checked={block.bold}
							onchange={(e) => edit((d) => (d.cover.blocks[i].bold = e.currentTarget.checked))}
						/>
					</Field>
				</div>
			{/each}
			<button
				onclick={() =>
					edit((d) =>
						d.cover.blocks.push({
							field: 'literal',
							literal: 'New block',
							y: '50%',
							alignment: 'center',
							font: 'heading',
							size: 14,
							bold: false,
							color: '#111111'
						})
					)}>Add cover block</button
			>
		</div>
	</Section>

	{#snippet band(which: 'header' | 'footer')}
		<Field label="Enabled">
			<input
				type="checkbox"
				checked={t[which].enabled}
				onchange={(e) => edit((d) => (d[which].enabled = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Template" hint={TEMPLATE_HINT}>
			<input
				type="text"
				spellcheck="false"
				value={t[which].template}
				onchange={(e) => edit((d) => (d[which].template = e.currentTarget.value))}
			/>
		</Field>
		<Field label="Alignment">
			<select
				value={t[which].alignment}
				onchange={(e) =>
					edit(
						(d) =>
							(d[which].alignment = e.currentTarget.value as Theme['header']['alignment'])
					)}
			>
				<option value="left">left</option>
				<option value="center">center</option>
				<option value="right">right</option>
			</select>
		</Field>
		<Field label="Font slot">
			<select
				value={t[which].font}
				onchange={(e) => edit((d) => (d[which].font = e.currentTarget.value as FontRole))}
			>
				{#each ROLES as r (r)}<option value={r}>{r}</option>{/each}
			</select>
		</Field>
		<Field label="Size">
			<NumberInput
				value={t[which].size}
				min={4}
				max={40}
				step={0.5}
				suffix="pt"
				onchange={(v) => edit((d) => (d[which].size = v))}
			/>
		</Field>
		<Field label="Colour">
			<ColorInput value={t[which].color} onchange={(c) => c && edit((d) => (d[which].color = c))} />
		</Field>
		<Field label="Offset" hint="Distance from the page edge, must be inside the margin">
			<NumberInput
				value={t[which].offset}
				min={0}
				max={200}
				suffix="pt"
				onchange={(v) => edit((d) => (d[which].offset = v))}
			/>
		</Field>
		<Field label="Show on first page">
			<input
				type="checkbox"
				checked={t[which].showOnFirstContentPage}
				onchange={(e) => edit((d) => (d[which].showOnFirstContentPage = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Rule line">
			<input
				type="checkbox"
				checked={t[which].rule.enabled}
				onchange={(e) => edit((d) => (d[which].rule.enabled = e.currentTarget.checked))}
			/>
		</Field>
		{#if t[which].rule.enabled}
			<Field label="Rule colour">
				<ColorInput
					value={t[which].rule.color}
					onchange={(c) => c && edit((d) => (d[which].rule.color = c))}
				/>
			</Field>
			<Field label="Rule width">
				<NumberInput
					value={t[which].rule.width}
					min={0}
					max={10}
					step={0.25}
					suffix="pt"
					onchange={(v) => edit((d) => (d[which].rule.width = v))}
				/>
			</Field>
		{/if}
	{/snippet}

	<Section title="Header">{@render band('header')}</Section>
	<Section title="Footer">{@render band('footer')}</Section>

	<Section title="Code blocks">
		<Field label="Background">
			<ColorInput value={t.code.background} onchange={(c) => c && edit((d) => (d.code.background = c))} />
		</Field>
		<Field label="Border colour">
			<ColorInput
				value={t.code.borderColor}
				onchange={(c) => c && edit((d) => (d.code.borderColor = c))}
			/>
		</Field>
		<Field label="Border width">
			<NumberInput
				value={t.code.borderWidth}
				min={0}
				max={8}
				step={0.25}
				suffix="pt"
				onchange={(v) => edit((d) => (d.code.borderWidth = v))}
			/>
		</Field>
		<Field label="Padding">
			<MarginInput
				value={t.code.padding}
				min={0}
				onchange={(p) => edit((d) => (d.code.padding = p))}
			/>
		</Field>
		<Field label="Line numbers">
			<input
				type="checkbox"
				checked={t.code.showLineNumbers}
				onchange={(e) => edit((d) => (d.code.showLineNumbers = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Line number colour">
			<ColorInput
				value={t.code.lineNumberColor}
				onchange={(c) => c && edit((d) => (d.code.lineNumberColor = c))}
			/>
		</Field>
		<Field label="Syntax highlighting">
			<input
				type="checkbox"
				checked={t.code.syntaxHighlight}
				onchange={(e) => edit((d) => (d.code.syntaxHighlight = e.currentTarget.checked))}
			/>
		</Field>
		{#if t.code.syntaxHighlight}
			<div class="tokens">
				{#each Object.entries(t.code.tokenColors) as [scope, color] (scope)}
					<Field label={scope}>
						<ColorInput
							value={color}
							onchange={(c) => c && edit((d) => (d.code.tokenColors[scope] = c))}
						/>
					</Field>
				{/each}
			</div>
		{/if}
	</Section>

	<Section title="Tables">
		<Field label="Header fill">
			<ColorInput value={t.table.headerFill} onchange={(c) => c && edit((d) => (d.table.headerFill = c))} />
		</Field>
		<Field label="Header colour">
			<ColorInput
				value={t.table.headerColor}
				onchange={(c) => c && edit((d) => (d.table.headerColor = c))}
			/>
		</Field>
		<Field label="Header bold">
			<input
				type="checkbox"
				checked={t.table.headerBold}
				onchange={(e) =>
					edit((d) => {
						d.table.headerBold = e.currentTarget.checked;
						d.elements.tableHeader.bold = e.currentTarget.checked;
					})}
			/>
		</Field>
		<Field label="Border colour">
			<ColorInput
				value={t.table.borderColor}
				onchange={(c) => c && edit((d) => (d.table.borderColor = c))}
			/>
		</Field>
		<Field label="Border width">
			<NumberInput
				value={t.table.borderWidth}
				min={0}
				max={5}
				step={0.25}
				suffix="pt"
				onchange={(v) => edit((d) => (d.table.borderWidth = v))}
			/>
		</Field>
		<Field label="Zebra rows">
			<ColorInput
				value={t.table.zebra}
				nullable
				onchange={(c) => edit((d) => (d.table.zebra = c))}
			/>
		</Field>
		<Field label="Cell padding">
			<MarginInput
				value={t.table.cellPadding}
				min={0}
				onchange={(p) => edit((d) => (d.table.cellPadding = p))}
			/>
		</Field>
		<Field label="Repeat header">
			<input
				type="checkbox"
				checked={t.table.repeatHeader}
				onchange={(e) => edit((d) => (d.table.repeatHeader = e.currentTarget.checked))}
			/>
		</Field>
	</Section>

	<Section title="Blockquotes, rules, lists, links">
		<Field label="Quote bar colour">
			<ColorInput
				value={t.blockquote.barColor}
				onchange={(c) => c && edit((d) => (d.blockquote.barColor = c))}
			/>
		</Field>
		<Field label="Quote bar width">
			<NumberInput
				value={t.blockquote.barWidth}
				min={0}
				max={20}
				step={0.5}
				suffix="pt"
				onchange={(v) => edit((d) => (d.blockquote.barWidth = v))}
			/>
		</Field>
		<Field label="Quote indent">
			<NumberInput
				value={t.blockquote.indent}
				min={0}
				max={80}
				suffix="pt"
				onchange={(v) => edit((d) => (d.blockquote.indent = v))}
			/>
		</Field>
		<Field label="Quote background">
			<ColorInput
				value={t.blockquote.background}
				nullable
				onchange={(c) => edit((d) => (d.blockquote.background = c))}
			/>
		</Field>
		<hr />
		<Field label="Rule colour">
			<ColorInput value={t.hr.color} onchange={(c) => c && edit((d) => (d.hr.color = c))} />
		</Field>
		<Field label="Rule width">
			<NumberInput
				value={t.hr.width}
				min={0}
				max={10}
				step={0.25}
				suffix="pt"
				onchange={(v) => edit((d) => (d.hr.width = v))}
			/>
		</Field>
		<Field label="Rule margin">
			<MarginInput value={t.hr.margin} onchange={(m) => edit((d) => (d.hr.margin = m))} />
		</Field>
		<hr />
		<Field label="Bullet characters" hint="One per nesting depth, comma separated">
			<input
				type="text"
				value={t.list.bulletChars.join(', ')}
				onchange={(e) =>
					edit((d) => {
						const chars = e.currentTarget.value
							.split(',')
							.map((c) => c.trim())
							.filter(Boolean);
						if (chars.length) d.list.bulletChars = chars;
					})}
			/>
		</Field>
		<Field label="List indent">
			<NumberInput
				value={t.list.indent}
				min={0}
				max={100}
				suffix="pt"
				onchange={(v) => edit((d) => (d.list.indent = v))}
			/>
		</Field>
		<Field label="Item spacing">
			<NumberInput
				value={t.list.itemSpacing}
				min={0}
				max={40}
				suffix="pt"
				onchange={(v) => edit((d) => (d.list.itemSpacing = v))}
			/>
		</Field>
		<Field label="Task checked">
			<input
				type="text"
				value={t.list.taskChecked}
				onchange={(e) => edit((d) => (d.list.taskChecked = e.currentTarget.value))}
			/>
		</Field>
		<Field label="Task unchecked">
			<input
				type="text"
				value={t.list.taskUnchecked}
				onchange={(e) => edit((d) => (d.list.taskUnchecked = e.currentTarget.value))}
			/>
		</Field>
		<hr />
		<Field label="Link colour">
			<ColorInput value={t.link.color} onchange={(c) => c && edit((d) => (d.link.color = c))} />
		</Field>
		<Field label="Link underline">
			<input
				type="checkbox"
				checked={t.link.underline}
				onchange={(e) => edit((d) => (d.link.underline = e.currentTarget.checked))}
			/>
		</Field>
	</Section>

	<Section title="Images">
		<Field label="Max width" hint="Fraction of the content column">
			<NumberInput
				value={t.image.maxWidth}
				min={0.1}
				max={1}
				step={0.05}
				onchange={(v) => edit((d) => (d.image.maxWidth = v))}
			/>
		</Field>
		<Field label="Alignment">
			<select
				value={t.image.alignment}
				onchange={(e) =>
					edit(
						(d) => (d.image.alignment = e.currentTarget.value as Theme['image']['alignment'])
					)}
			>
				<option value="left">left</option>
				<option value="center">center</option>
				<option value="right">right</option>
			</select>
		</Field>
		<Field label="Margin">
			<MarginInput value={t.image.margin} onchange={(m) => edit((d) => (d.image.margin = m))} />
		</Field>
		<Field label="Captions">
			<input
				type="checkbox"
				checked={t.image.caption.enabled}
				onchange={(e) => edit((d) => (d.image.caption.enabled = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Caption size">
			<NumberInput
				value={t.image.caption.size}
				min={4}
				max={30}
				step={0.5}
				suffix="pt"
				onchange={(v) => edit((d) => (d.image.caption.size = v))}
			/>
		</Field>
		<Field label="Caption italic">
			<input
				type="checkbox"
				checked={t.image.caption.italics}
				onchange={(e) => edit((d) => (d.image.caption.italics = e.currentTarget.checked))}
			/>
		</Field>
		<Field label="Caption colour">
			<ColorInput
				value={t.image.caption.color}
				onchange={(c) => c && edit((d) => (d.image.caption.color = c))}
			/>
		</Field>
	</Section>

	<Section title="Elements" open>
		{#each ELEMENTS as [key, label] (key)}
			<ElementStyleEditor
				{label}
				style={t.elements[key]}
				onchange={(patch) => editElement(key, patch)}
			/>
		{/each}
	</Section>
</div>

<style>
	.panel {
		height: 100%;
		overflow-y: auto;
		background: var(--bg-panel);
		border-left: 1px solid var(--border);
	}
	.toolbar {
		display: flex;
		gap: 5px;
		padding: 8px;
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		background: var(--bg-panel);
		z-index: 2;
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.warnings {
		margin: 0;
		padding: 8px 12px 8px 28px;
		background: var(--banner-warn-bg);
		border-bottom: 1px solid var(--border);
		color: var(--warn);
		font-size: 11.5px;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-bottom: 6px;
	}
	.blocks {
		margin-top: 6px;
	}
	.block {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 6px 8px;
		margin-bottom: 6px;
		background: var(--bg-input);
	}
	.block-head {
		display: flex;
		gap: 5px;
		margin-bottom: 4px;
	}
	.block-head select {
		flex: 1;
	}
	.tokens {
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 6px;
	}
	hr {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 10px 0;
	}
</style>
