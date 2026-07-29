<script lang="ts">
	interface Props {
		/** Current editor width as a fraction of the split area. */
		value: number;
		min?: number;
		max?: number;
		onchange: (fraction: number) => void;
		/** Measured to convert a pointer position into a fraction. */
		track: HTMLElement | null;
	}
	let { value, min = 0.15, max = 0.75, onchange, track }: Props = $props();

	let dragging = $state(false);

	function clamp(fraction: number): number {
		return Math.min(max, Math.max(min, fraction));
	}

	function fromPointer(clientX: number): number | null {
		if (!track) return null;
		const box = track.getBoundingClientRect();
		if (box.width === 0) return null;
		return clamp((clientX - box.left) / box.width);
	}

	/**
	 * Pointer events with capture, so the drag keeps following the cursor even
	 * when it crosses the preview iframe-like canvas or leaves the window.
	 */
	function onpointerdown(e: PointerEvent) {
		e.preventDefault();
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging) return;
		const next = fromPointer(e.clientX);
		if (next !== null) onchange(next);
	}

	function stop(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	/** Keyboard resizing, because a drag handle that needs a mouse is not a control. */
	function onkeydown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowLeft') onchange(clamp(value - step));
		else if (e.key === 'ArrowRight') onchange(clamp(value + step));
		else if (e.key === 'Home') onchange(min);
		else if (e.key === 'End') onchange(max);
		else return;
		e.preventDefault();
	}
</script>

<!--
	A focusable `separator` with aria-valuenow/min/max is the ARIA window-splitter
	pattern: in that role it is a widget, not decoration, and it has to take focus
	so it can be resized with the keyboard. The lint rules classify `separator` as
	always non-interactive and do not model the focusable variant.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="splitter"
	class:dragging
	role="separator"
	aria-label="Resize the editor"
	aria-orientation="vertical"
	aria-valuenow={Math.round(value * 100)}
	aria-valuemin={Math.round(min * 100)}
	aria-valuemax={Math.round(max * 100)}
	tabindex="0"
	{onpointerdown}
	{onpointermove}
	onpointerup={stop}
	onpointercancel={stop}
	{onkeydown}
	ondblclick={() => onchange(0.5)}
	title="Drag to resize, double-click to reset"
></div>

<style>
	.splitter {
		width: 7px;
		margin: 0 -3px; /* a wider hit target than the visible line */
		cursor: col-resize;
		background: transparent;
		position: relative;
		z-index: 3;
		flex: none;
		touch-action: none;
	}
	.splitter::after {
		content: '';
		position: absolute;
		inset: 0 3px;
		background: var(--border);
	}
	.splitter:hover::after,
	.splitter.dragging::after,
	.splitter:focus-visible::after {
		background: var(--accent);
	}
	.splitter:focus-visible {
		outline: none;
	}
</style>
