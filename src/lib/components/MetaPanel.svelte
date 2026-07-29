<script lang="ts">
	import type { DocMeta } from '$lib/markdown/frontmatter';
	import Field from './controls/Field.svelte';

	interface Props {
		meta: Partial<DocMeta>;
		onchange: (patch: Partial<DocMeta>) => void;
	}
	let { meta, onchange }: Props = $props();
</script>

<div class="meta">
	<p class="hint">Front matter in the document overrides these.</p>
	<Field label="Title">
		<input type="text" value={meta.title ?? ''} onchange={(e) => onchange({ title: e.currentTarget.value })} />
	</Field>
	<Field label="Subtitle">
		<input
			type="text"
			value={meta.subtitle ?? ''}
			onchange={(e) => onchange({ subtitle: e.currentTarget.value })}
		/>
	</Field>
	<Field label="Author">
		<input type="text" value={meta.author ?? ''} onchange={(e) => onchange({ author: e.currentTarget.value })} />
	</Field>
	<Field label="Date" hint="Empty means today, at render time">
		<input type="date" value={meta.date ?? ''} onchange={(e) => onchange({ date: e.currentTarget.value })} />
	</Field>
</div>

<style>
	.meta {
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-panel);
	}
	.hint {
		margin: 0 0 8px;
		font-size: 11px;
		color: var(--text-faint);
	}
</style>
