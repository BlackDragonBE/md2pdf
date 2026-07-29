<script lang="ts">
	interface Props {
		title: string;
		open?: boolean;
		children: import('svelte').Snippet;
	}
	let { title, open = false, children }: Props = $props();
</script>

<details {open}>
	<summary>{title}</summary>
	<div class="body">{@render children()}</div>
</details>

<style>
	details {
		border-bottom: 1px solid var(--border);
	}
	summary {
		cursor: pointer;
		padding: 8px 12px;
		font-weight: 600;
		font-size: 12px;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-dim);
		user-select: none;
	}
	summary:hover {
		color: var(--text);
		background: var(--bg-raised);
	}
	.body {
		padding: 4px 12px 12px;
	}
</style>
