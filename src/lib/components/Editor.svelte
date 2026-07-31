<script lang="ts">
	import { onDestroy } from 'svelte';
	import { LineMetrics } from '$lib/preview/lineMetrics';

	interface Props {
		value: string;
		oninput: (value: string) => void;
		/** Surfaced to the user; currently only for a rejected image paste. */
		onnotice?: (message: string) => void;
		/** Fired when the reader scrolls the editor, for scroll sync. */
		onuserscroll?: () => void;
	}
	let { value, oninput, onnotice, onuserscroll }: Props = $props();

	let textarea = $state<HTMLTextAreaElement | null>(null);
	const metrics = new LineMetrics();

	onDestroy(() => metrics.destroy());

	/**
	 * Scroll-sync surface. Measurement is lazy — the mirror is only built when
	 * sync actually asks for a mapping, so the cost is nil when it is off.
	 */
	export function currentLine(): number {
		if (!textarea) return 0;
		metrics.measure(textarea, value);
		return metrics.lineAt(textarea.scrollTop);
	}
	export function scrollToLine(line: number): void {
		if (!textarea) return;
		metrics.measure(textarea, value);
		// Same rule as the preview: our own scroll is not the reader's.
		programmaticUntil = performance.now() + 200;
		textarea.scrollTop = Math.max(0, metrics.offsetOf(line));
	}

	let programmaticUntil = 0;

	/**
	 * A pasted image is inlined into the Markdown as a data URI, and the document
	 * is persisted to localStorage, which caps out around 5 MB. Base64 inflates
	 * by about a third, so anything past this would cost the user their saved
	 * document rather than just the image.
	 */
	const MAX_PASTED_IMAGE_BYTES = 2 * 1024 * 1024;

	function readAsDataUri(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('could not read the image'));
			reader.readAsDataURL(file);
		});
	}

	/**
	 * Relative image paths cannot be resolved in a static app, so the renderer
	 * tells the user to paste the image instead — this is what makes that
	 * instruction true.
	 */
	async function onpaste(e: ClipboardEvent) {
		const item = [...(e.clipboardData?.items ?? [])].find(
			(i) => i.kind === 'file' && i.type.startsWith('image/')
		);
		const file = item?.getAsFile();
		if (!file) return; // ordinary text paste; leave it alone

		e.preventDefault();
		if (file.size > MAX_PASTED_IMAGE_BYTES) {
			onnotice?.(
				`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Images are embedded in the document, so paste something under 2 MB.`
			);
			return;
		}

		try {
			const dataUri = await readAsDataUri(file);
			const alt = file.name.replace(/\.[^.]+$/, '') || 'pasted image';
			document.execCommand('insertText', false, `![${alt}](${dataUri})`);
		} catch (error) {
			onnotice?.(`Could not read the pasted image: ${(error as Error).message}`);
		}
	}

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
	bind:this={textarea}
	onscroll={() => performance.now() >= programmaticUntil && onuserscroll?.()}
	class="editor"
	spellcheck="false"
	aria-label="Markdown source"
	{value}
	oninput={(e) => oninput(e.currentTarget.value)}
	{onkeydown}
	{onpaste}></textarea>

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
