<script lang="ts">
	interface Props {
		value: string;
		oninput: (value: string) => void;
	}
	let { value, oninput }: Props = $props();

	let textarea = $state<HTMLTextAreaElement | null>(null);

	/** Tab indents instead of leaving the editor; Shift+Tab outdents. */
	function onkeydown(e: KeyboardEvent) {
		const el = e.currentTarget as HTMLTextAreaElement;
		if (e.key !== 'Tab') return;
		e.preventDefault();
		const { selectionStart: start, selectionEnd: end } = el;
		if (e.shiftKey) {
			const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
			if (el.value.slice(lineStart, lineStart + 1) === '\t') {
				const next = el.value.slice(0, lineStart) + el.value.slice(lineStart + 1);
				oninput(next);
				queueMicrotask(() => el.setSelectionRange(start - 1, end - 1));
			}
			return;
		}
		const next = `${el.value.slice(0, start)}\t${el.value.slice(end)}`;
		oninput(next);
		queueMicrotask(() => el.setSelectionRange(start + 1, start + 1));
	}
</script>

<textarea
	bind:this={textarea}
	class="editor"
	spellcheck="false"
	aria-label="Markdown source"
	{value}
	oninput={(e) => oninput(e.currentTarget.value)}
	{onkeydown}
></textarea>

<style>
	.editor {
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: 0;
		resize: none;
		padding: 14px 16px;
		font-family: var(--mono);
		font-size: 12.5px;
		line-height: 1.6;
		tab-size: 4;
		background: var(--bg);
		color: var(--text);
	}
	.editor:focus-visible {
		outline: none;
	}
</style>
