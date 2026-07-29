<script lang="ts">
	type Quad = [number, number, number, number];

	interface Props {
		value: Quad;
		min?: number;
		onchange: (value: Quad) => void;
	}
	let { value, min = -200, onchange }: Props = $props();

	const LABELS = ['left', 'top', 'right', 'bottom'];

	/** Per-field draft; see NumberInput for why an uncontrolled buffer is needed. */
	let drafts = $state<(string | null)[]>([null, null, null, null]);
	const shown = $derived(value.map((v, i) => drafts[i] ?? String(v)));

	function publish(i: number, n: number) {
		const next = [...value] as Quad;
		next[i] = n;
		onchange(next);
	}

	function typing(i: number, raw: string) {
		drafts[i] = raw;
		const n = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(n) || n < min) return;
		publish(i, n);
	}

	function settle(i: number, el: HTMLInputElement) {
		const n = Number(el.value);
		drafts[i] = null;
		if (el.value.trim() === '' || !Number.isFinite(n)) {
			el.value = String(value[i]);
			return;
		}
		const clamped = Math.max(min, n);
		el.value = String(clamped);
		if (clamped !== value[i]) publish(i, clamped);
	}
</script>

<div class="quad">
	{#each shown as v, i (i)}
		<input
			type="number"
			step="1"
			{min}
			value={v}
			title={LABELS[i]}
			aria-label={LABELS[i]}
			oninput={(e) => typing(i, e.currentTarget.value)}
			onchange={(e) => settle(i, e.currentTarget)}
			onblur={(e) => settle(i, e.currentTarget)}
		/>
	{/each}
</div>

<style>
	.quad {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 3px;
		width: 100%;
	}
	.quad input {
		width: 100%;
		min-width: 0;
		padding: 4px 2px;
		text-align: center;
		font-size: 11px;
	}
</style>
