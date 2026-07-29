<script lang="ts">
	interface Props {
		value: string;
		oninput: (value: string) => void;
	}
	let { value, oninput }: Props = $props();

	/** Leading whitespace on the line containing `index`. */
	function lineIndent(text: string, index: number): { start: number; length: number } {
		const start = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
		const match = /^[\t ]{1,4}/.exec(text.slice(start));
		if (!match) return { start, length: 0 };
		// A tab counts as one unit; spaces outdent up to four at a time.
		const length = match[0][0] === '\t' ? 1 : match[0].replace(/[^ ]/g, '').length;
		return { start, length };
	}

	/**
	 * Tab indents instead of leaving the editor; Shift+Tab outdents.
	 *
	 * Edits go through `execCommand`, not by rewriting the whole textarea value:
	 * replacing `value` wholesale discards the browser's native undo stack, so a
	 * single Tab used to make Ctrl+Z unable to step back through anything typed
	 * before it. It is deprecated but it is still the only way to edit a textarea
	 * without destroying undo, and every target browser supports it.
	 */
	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const el = e.currentTarget as HTMLTextAreaElement;
		e.preventDefault();

		if (!e.shiftKey) {
			document.execCommand('insertText', false, '\t');
			return;
		}

		const { start, length } = lineIndent(el.value, el.selectionStart);
		if (length === 0) return;
		const caret = el.selectionStart;
		el.setSelectionRange(start, start + length);
		document.execCommand('delete');
		const moved = Math.max(start, caret - length);
		el.setSelectionRange(moved, moved);
	}
</script>

<textarea
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
		/* Flex child of .editor-pane: `flex: 1` + `min-height: 0` rather than
		   `height: 100%`, so the metadata panel can appear above it without
		   pushing the textarea past the bottom of the pane. */
		flex: 1 1 auto;
		min-height: 0;
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
