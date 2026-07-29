<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		id?: string;
		children: import('svelte').Snippet;
	}
	let { label, hint, id, children }: Props = $props();
</script>

<div class="field">
	<label for={id} title={hint}>{label}</label>
	<div class="control">{@render children()}</div>
</div>

<style>
	.field {
		display: grid;
		grid-template-columns: 1fr minmax(0, 1.2fr);
		gap: 8px;
		align-items: center;
		margin-bottom: 5px;
	}
	label {
		color: var(--text-dim);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.control {
		display: flex;
		gap: 4px;
		align-items: center;
		min-width: 0;
	}
	.control :global(input:not([type='color']):not([type='checkbox'])),
	.control :global(select) {
		width: 100%;
		min-width: 0;
	}
</style>
