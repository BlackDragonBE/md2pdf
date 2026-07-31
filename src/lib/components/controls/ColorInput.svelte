<script lang="ts">
	interface Props {
		value: string | null;
		nullable?: boolean;
		onchange: (value: string | null) => void;
	}
	let { value, nullable = false, onchange }: Props = $props();

	/** <input type="color"> only accepts #rrggbb; #rgb and #rrggbbaa need widening/trimming. */
	function toPicker(v: string | null): string {
		if (!v) return '#000000';
		if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
		if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7);
		return /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
	}
</script>

<input
	type="color"
	aria-label="Colour picker"
	value={toPicker(value)}
	disabled={nullable && value === null}
	oninput={(e) => onchange(e.currentTarget.value)}
/>
<input
	type="text"
	spellcheck="false"
	aria-label="Colour hex value"
	value={value ?? ''}
	placeholder={nullable ? 'none' : '#000000'}
	disabled={nullable && value === null}
	onchange={(e) => {
		const v = e.currentTarget.value.trim();
		if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) onchange(v);
		else e.currentTarget.value = value ?? '';
	}}
/>
{#if nullable}
	<input
		type="checkbox"
		title="Enabled"
		aria-label="Enable this colour"
		checked={value !== null}
		onchange={(e) => onchange(e.currentTarget.checked ? '#cccccc' : null)}
	/>
{/if}
