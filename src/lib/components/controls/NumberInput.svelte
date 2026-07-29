<script lang="ts">
	interface Props {
		value: number;
		min?: number;
		max?: number;
		step?: number;
		suffix?: string;
		onchange: (value: number) => void;
	}
	let { value, min, max, step = 1, suffix, onchange }: Props = $props();

	function commit(raw: string, el: HTMLInputElement) {
		const n = Number(raw);
		if (!Number.isFinite(n)) {
			el.value = String(value);
			return;
		}
		const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
		if (clamped !== n) el.value = String(clamped);
		onchange(clamped);
	}
</script>

<input
	type="number"
	{min}
	{max}
	{step}
	{value}
	oninput={(e) => commit(e.currentTarget.value, e.currentTarget)}
/>
{#if suffix}<span class="suffix">{suffix}</span>{/if}

<style>
	.suffix {
		color: var(--text-faint);
		font-size: 11px;
	}
</style>
