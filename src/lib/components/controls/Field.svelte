<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		children: import('svelte').Snippet;
	}
	let { label, hint, children }: Props = $props();

	const fieldId = $props.id();

	/**
	 * Point the label at whatever control the caller rendered.
	 *
	 * `<label for={id}>` was here from the start but no call site ever passed an
	 * id, so every field in the theme panel was an unlabelled control. Threading
	 * an id through eighty call sites would be worse than finding the control;
	 * wrapping everything in the <label> instead would make clicking a row open
	 * the nearest colour picker.
	 */
	function labelled(node: HTMLElement, id: string) {
		const control = node.querySelector('input, select, textarea');
		if (control && !control.id) control.id = id;
	}
</script>

<div class="field">
	<label for={fieldId} title={hint}>{label}</label>
	<div class="control" use:labelled={fieldId}>{@render children()}</div>
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
