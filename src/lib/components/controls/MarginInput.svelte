<script lang="ts">
	type Quad = [number, number, number, number];

	interface Props {
		value: Quad;
		min?: number;
		onchange: (value: Quad) => void;
	}
	let { value, min = -200, onchange }: Props = $props();

	const LABELS = ['left', 'top', 'right', 'bottom'];

	function set(i: number, raw: string) {
		const n = Number(raw);
		if (!Number.isFinite(n)) return;
		const next = [...value] as Quad;
		next[i] = Math.max(min, n);
		onchange(next);
	}
</script>

<div class="quad">
	{#each value as v, i (i)}
		<input
			type="number"
			step="1"
			{min}
			value={v}
			title={LABELS[i]}
			aria-label={LABELS[i]}
			oninput={(e) => set(i, e.currentTarget.value)}
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
