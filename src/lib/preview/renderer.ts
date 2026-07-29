import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

/**
 * `?worker`, not the `?url` + `GlobalWorkerOptions.workerSrc` form.
 *
 * The URL form works in dev and then fails in the production build: the emitted
 * asset is an ES module, pdf.js loads `workerSrc` as a *classic* worker, that
 * throws, and its "fake worker" fallback then fails to dynamically import the
 * same file — "Setting up fake worker failed". Letting Vite emit a real module
 * worker and handing pdf.js the port sidesteps all of it and keeps the worker
 * self-hosted, which matters on GitHub Pages.
 *
 * pdf.js does not terminate a port it did not create, so each document owns its
 * worker and terminates it in `destroy()`.
 */
let workerSeq = 0;

/** Long enough for a cold worker start on a slow machine, short enough to notice. */
const OPEN_TIMEOUT_MS = 20_000;

/**
 * pdf.js generates its `.d.ts` from JSDoc and gets this one wrong: the emitted
 * constructor says `port?: null | undefined`, contradicting the
 * `PDFWorkerParameters` typedef directly above it, which says `Worker`. Retyped
 * here rather than cast away at the call site.
 */
type PdfWorkerConstructor = new (params: {
	name?: string;
	port?: Worker;
	verbosity?: number;
}) => pdfjs.PDFWorker;

const PDFWorker = pdfjs.PDFWorker as unknown as PdfWorkerConstructor;

/** Beyond this many pages, only pages near the viewport are rasterised (§9 item 4). */
export const VIRTUALISE_ABOVE = 20;
const NEIGHBOURHOOD = 2;
const MAX_SCALE = 3;

export interface PageGeometry {
	/** CSS pixel size at the current zoom. */
	width: number;
	height: number;
}

export class PreviewDocument {
	#doc: PDFDocumentProxy;
	#geometry: PageGeometry[];
	#port: Worker;
	#destroyed = false;

	private constructor(doc: PDFDocumentProxy, geometry: PageGeometry[], port: Worker) {
		this.#doc = doc;
		this.#geometry = geometry;
		this.#port = port;
	}

	static async open(buffer: ArrayBuffer, zoom: number): Promise<PreviewDocument> {
		// pdf.js takes ownership of the buffer it is handed, so give it a copy —
		// the store's buffer is also the download payload (§9).
		const copy = buffer.slice(0);
		const port = new PdfjsWorker();
		let doc: PDFDocumentProxy;
		try {
			const worker = new PDFWorker({ port, name: `md2pdf-preview-${++workerSeq}` });
			/*
			 * Supplying our own port means pdf.js uses `_initializeFromPort`, which
			 * has none of the timeout and fake-worker fallback it applies to a
			 * worker it created itself. If the port never completes the handshake,
			 * `getDocument` simply never settles — the preview sits on "Nothing to
			 * preview yet" forever with nothing logged and nothing to catch. Both
			 * guards below exist to turn that into a visible error.
			 */
			doc = await Promise.race([
				pdfjs.getDocument({ data: copy, worker }).promise,
				new Promise<never>((_, reject) => {
					port.addEventListener('error', (event) =>
						reject(new Error(`PDF preview worker failed: ${event.message || 'unknown error'}`))
					);
					port.addEventListener('messageerror', () =>
						reject(new Error('PDF preview worker sent an unreadable message.'))
					);
				}),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error('The PDF preview worker did not respond in time.')),
						OPEN_TIMEOUT_MS
					)
				)
			]);
		} catch (e) {
			port.terminate();
			throw e;
		}

		const geometry: PageGeometry[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const viewport = page.getViewport({ scale: zoom });
			geometry.push({ width: viewport.width, height: viewport.height });
			page.cleanup();
		}
		return new PreviewDocument(doc, geometry, port);
	}

	get pageCount(): number {
		return this.#doc.numPages;
	}

	get geometry(): PageGeometry[] {
		return this.#geometry;
	}

	shouldRender(index: number, visiblePage: number): boolean {
		if (this.pageCount <= VIRTUALISE_ABOVE) return true;
		return Math.abs(index + 1 - visiblePage) <= NEIGHBOURHOOD;
	}

	/** Rasterise one page into a detached canvas at devicePixelRatio × zoom, capped at 3× (§9 item 3). */
	async renderPage(index: number, zoom: number): Promise<HTMLCanvasElement> {
		const page: PDFPageProxy = await this.#doc.getPage(index + 1);
		try {
			const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
			const scale = Math.min(MAX_SCALE, zoom * dpr);
			const viewport = page.getViewport({ scale });
			const cssViewport = page.getViewport({ scale: zoom });

			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.floor(viewport.width));
			canvas.height = Math.max(1, Math.floor(viewport.height));
			canvas.style.width = `${cssViewport.width}px`;
			canvas.style.height = `${cssViewport.height}px`;

			const context = canvas.getContext('2d');
			if (!context) throw new Error('2D canvas context unavailable');
			await page.render({ canvasContext: context, viewport }).promise;
			return canvas;
		} finally {
			page.cleanup();
		}
	}

	/** Leaking pdf.js documents on each keystroke exhausts memory (§9 item 5, pitfall 8). */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		void this.#doc.destroy().finally(() => this.#port.terminate());
	}
}
