/**
 * Maps source lines to pixel offsets inside a soft-wrapped `<textarea>`.
 *
 * A textarea exposes no per-line geometry, and `scrollTop / lineHeight` is
 * wrong the moment any line wraps — which, for prose, is most of them. The only
 * reliable way is to lay the same text out again in an element we can measure,
 * so this mirrors the textarea's box and typography into a hidden div with one
 * child per source line.
 */
export class LineMetrics {
	#mirror: HTMLDivElement | null = null;
	#offsets: number[] = [];
	#signature = '';

	/** Rebuild only when the text or the box that wraps it actually changed. */
	measure(textarea: HTMLTextAreaElement, source: string): void {
		const style = getComputedStyle(textarea);
		const signature = `${textarea.clientWidth}|${style.font}|${style.lineHeight}|${style.padding}|${source.length}|${source}`;
		if (signature === this.#signature) return;
		this.#signature = signature;

		const mirror = this.#ensureMirror();
		mirror.style.width = `${textarea.clientWidth}px`;
		mirror.style.font = style.font;
		mirror.style.lineHeight = style.lineHeight;
		mirror.style.letterSpacing = style.letterSpacing;
		mirror.style.padding = style.padding;
		mirror.style.tabSize = style.tabSize;

		const lines = source.split('\n');
		mirror.replaceChildren(
			...lines.map((line) => {
				const div = document.createElement('div');
				// A blank line still occupies a row; without this it collapses.
				div.textContent = line === '' ? '​' : line;
				return div;
			})
		);

		const children = mirror.children;
		this.#offsets = new Array(children.length);
		for (let i = 0; i < children.length; i++) {
			this.#offsets[i] = (children[i] as HTMLElement).offsetTop;
		}
	}

	/** Pixel offset of a (possibly fractional) source line. */
	offsetOf(line: number): number {
		if (this.#offsets.length === 0) return 0;
		const index = Math.max(0, Math.min(this.#offsets.length - 1, Math.floor(line)));
		const start = this.#offsets[index];
		const next = this.#offsets[index + 1];
		if (next === undefined) return start;
		return start + (next - start) * (line - index);
	}

	/** The source line, fractionally, at a pixel offset. */
	lineAt(offset: number): number {
		if (this.#offsets.length === 0) return 0;
		let index = 0;
		for (let i = 0; i < this.#offsets.length; i++) {
			if (this.#offsets[i] <= offset) index = i;
			else break;
		}
		const start = this.#offsets[index];
		const next = this.#offsets[index + 1];
		if (next === undefined || next <= start) return index;
		return index + (offset - start) / (next - start);
	}

	destroy(): void {
		this.#mirror?.remove();
		this.#mirror = null;
		this.#offsets = [];
		this.#signature = '';
	}

	#ensureMirror(): HTMLDivElement {
		if (this.#mirror) return this.#mirror;
		const mirror = document.createElement('div');
		// Off-screen rather than `display: none`, which would report no geometry.
		mirror.setAttribute('aria-hidden', 'true');
		Object.assign(mirror.style, {
			position: 'absolute',
			top: '0',
			left: '-99999px',
			visibility: 'hidden',
			whiteSpace: 'pre-wrap',
			overflowWrap: 'break-word',
			boxSizing: 'border-box',
			pointerEvents: 'none'
		});
		document.body.appendChild(mirror);
		this.#mirror = mirror;
		return mirror;
	}
}
