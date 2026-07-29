<script lang="ts">
	import { untrack } from 'svelte';
	import type { ElementStyleT } from '$lib/theme/schema';
	import ColorInput from './ColorInput.svelte';
	import Field from './Field.svelte';
	import MarginInput from './MarginInput.svelte';
	import NumberInput from './NumberInput.svelte';

	interface Props {
		label: string;
		style: ElementStyleT;
		open?: boolean;
		onchange: (patch: Partial<ElementStyleT>) => void;
	}
	let { label, style, open = false, onchange }: Props = $props();

	/**
	 * `open` is an initial value, tracked locally from here on.
	 *
	 * Binding the prop straight to the attribute made Svelte re-apply
	 * `open={false}` on every re-render — and this component re-renders on every
	 * theme edit, so the panel you were editing snapped shut on each keystroke
	 * and silently took the focus with it. No blur fires when that happens, so
	 * the field simply stopped receiving input.
	 */
	let expanded = $state(untrack(() => open));
</script>

<details open={expanded} ontoggle={(e) => (expanded = e.currentTarget.open)}>
	<summary>
		<span>{label}</span>
		<span class="preview" style="font-size:{Math.min(15, style.size)}px;color:{style.color}">
			{style.size}pt
		</span>
	</summary>
	<div class="body">
		<Field label="Font slot">
			<select
				value={style.font}
				onchange={(e) => onchange({ font: e.currentTarget.value as ElementStyleT['font'] })}
			>
				<option value="body">body</option>
				<option value="heading">heading</option>
				<option value="mono">mono</option>
			</select>
		</Field>
		<Field label="Size">
			<NumberInput
				value={style.size}
				min={4}
				max={96}
				step={0.5}
				suffix="pt"
				onchange={(size) => onchange({ size })}
			/>
		</Field>
		<Field label="Colour">
			<ColorInput value={style.color} onchange={(color) => color && onchange({ color })} />
		</Field>
		<Field label="Line height">
			<NumberInput
				value={style.lineHeight}
				min={0.6}
				max={3}
				step={0.05}
				onchange={(lineHeight) => onchange({ lineHeight })}
			/>
		</Field>
		<Field label="Alignment">
			<select
				value={style.alignment}
				onchange={(e) =>
					onchange({ alignment: e.currentTarget.value as ElementStyleT['alignment'] })}
			>
				<option value="left">left</option>
				<option value="center">center</option>
				<option value="right">right</option>
				<option value="justify">justify</option>
			</select>
		</Field>
		<Field label="Margin" hint="left, top, right, bottom (pt)">
			<MarginInput value={style.margin} onchange={(margin) => onchange({ margin })} />
		</Field>
		<Field label="Letter spacing">
			<NumberInput
				value={style.characterSpacing}
				min={-2}
				max={20}
				step={0.1}
				suffix="pt"
				onchange={(characterSpacing) => onchange({ characterSpacing })}
			/>
		</Field>
		<div class="flags">
			<label>
				<input
					type="checkbox"
					checked={style.bold}
					onchange={(e) => onchange({ bold: e.currentTarget.checked })}
				/> Bold
			</label>
			<label>
				<input
					type="checkbox"
					checked={style.italics}
					onchange={(e) => onchange({ italics: e.currentTarget.checked })}
				/> Italic
			</label>
			<label title="Force a page break before this element">
				<input
					type="checkbox"
					checked={style.breakBefore}
					onchange={(e) => onchange({ breakBefore: e.currentTarget.checked })}
				/> Break before
			</label>
			<label title="Never let this element be the last thing on a page">
				<input
					type="checkbox"
					checked={style.keepWithNext}
					onchange={(e) => onchange({ keepWithNext: e.currentTarget.checked })}
				/> Keep with next
			</label>
		</div>
	</div>
</details>

<style>
	details {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 5px;
		background: var(--bg-input);
	}
	summary {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		padding: 5px 8px;
		cursor: pointer;
		user-select: none;
	}
	summary:hover {
		background: var(--bg-raised);
	}
	.preview {
		font-variant-numeric: tabular-nums;
		background: #fff;
		padding: 0 5px;
		border-radius: 3px;
		line-height: 1.4;
	}
	.body {
		padding: 6px 8px 8px;
		border-top: 1px solid var(--border);
	}
	.flags {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3px 10px;
		margin-top: 6px;
	}
	.flags label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-dim);
		cursor: pointer;
	}
</style>
