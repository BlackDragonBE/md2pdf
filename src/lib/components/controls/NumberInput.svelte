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

	const lo = $derived(min ?? -Infinity);
	const hi = $derived(max ?? Infinity);

	/**
	 * What the user is part-way through typing, or null when the field is idle.
	 *
	 * Two problems this solves at once. Clamping on every keystroke makes low
	 * numbers impossible to enter — in a field with min 4, typing "12" clamped
	 * the "1" to "4" and appended the "2", giving 42. And simply *not*
	 * publishing an in-progress value is not enough on its own: the field is
	 * bound to the theme, so any unrelated re-render re-applies the prop and
	 * wipes out what was being typed. Holding a draft keeps the field stable
	 * until focus leaves.
	 */
	let draft = $state<string | null>(null);
	const shown = $derived(draft ?? String(value));

	function typing(raw: string) {
		draft = raw;
		const n = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(n)) return;
		if (n < lo || n > hi) return; // valid but incomplete; publish on settle
		onchange(n);
	}

	/** On blur or Enter the value is settled, so clamp and normalise it. */
	function settle(el: HTMLInputElement) {
		const n = Number(el.value);
		draft = null;
		if (el.value.trim() === '' || !Number.isFinite(n)) {
			el.value = String(value);
			return;
		}
		const clamped = Math.min(hi, Math.max(lo, n));
		el.value = String(clamped);
		if (clamped !== value) onchange(clamped);
	}
</script>

<input
	type="number"
	{min}
	{max}
	{step}
	value={shown}
	oninput={(e) => typing(e.currentTarget.value)}
	onchange={(e) => settle(e.currentTarget)}
	onblur={(e) => settle(e.currentTarget)}
/>
{#if suffix}<span class="suffix">{suffix}</span>{/if}

<style>
	.suffix {
		color: var(--text-faint);
		font-size: 11px;
	}
</style>
