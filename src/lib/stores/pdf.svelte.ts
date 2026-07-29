import { browser } from '$app/environment';
import { charsetKey, documentCharset } from '../fonts/charset';
import type { Anchor } from '../pdf/buildDocDefinition';
import { resolveFonts } from '../fonts/resolve';
import { buildVfs } from '../fonts/register';
import { EMPTY_META, type DocMeta } from '../markdown/frontmatter';
import { parse } from '../markdown/parse';
import { collectImageSources, resolveImages } from '../pdf/images';
import type { FontDictionary, Vfs } from '../pdf/pdfmake-types';
import type { FontRole, Theme } from '../theme/schema';
import { debounce } from '../util/debounce';
import type { RenderRequest, RenderResponse } from '../workers/protocol';

export type PdfState = 'idle' | 'generating' | 'ready' | 'error';

/**
 * Soft limit, not a hard one — generation still works above it.
 *
 * Measured with `scripts/measure-ceiling.mjs`: generation is linear at roughly
 * 3 ms/page (187 pages in ~0.6 s in Node). What degrades first is preview
 * rasterisation and memory, which is why the preview virtualises. This
 * threshold is where the app starts saying so rather than silently getting
 * sluggish (§16 item 5).
 */
export const SOFT_PAGE_LIMIT = 300;

interface FontBundle {
	roles: Record<FontRole, string>;
	vfs: Vfs;
	fonts: FontDictionary;
	warnings: string[];
	failed: { role: FontRole; reason: string }[];
}

class PdfStore {
	state = $state<PdfState>('idle');
	/** Retained across `generating` so the preview never blanks (§8). */
	buffer = $state<ArrayBuffer | null>(null);
	pageCount = $state(0);
	/** Source line → page and offset in the finished PDF, for scroll sync. */
	anchors = $state<Anchor[]>([]);
	/**
	 * Metadata as the renderer actually resolved it — front matter first, then
	 * the panel overrides. The panel values alone are not enough: a document
	 * titled in its front matter downloaded as the *theme* name.
	 */
	meta = $state<DocMeta>({ ...EMPTY_META });
	/**
	 * Id of the most recently *committed* render. Surfaced in the DOM so tests
	 * can wait for a specific render rather than guessing at the debounce.
	 */
	completedId = $state(0);
	warnings = $state<string[]>([]);
	error = $state<string | null>(null);
	/** Which font slots fell back, for the explicit "unavailable" state (§7.4). */
	fontFailures = $state<{ role: FontRole; reason: string }[]>([]);
	/** Set when the worker spike failed and generation ran on the main thread (§8). */
	usingMainThread = $state(false);

	#worker: Worker | null = null;
	#workerBroken = false;
	#nextId = 1;
	#latestId = 0;
	#fontCache: { key: string; bundle: FontBundle } | null = null;
	#request = debounce((input: RenderInput) => void this.#run(input), 400);

	/** Debounced entry point: every editor keystroke and theme edit lands here. */
	schedule(input: RenderInput): void {
		if (!browser) return;
		this.#request(input);
	}

	/** Skip the debounce — used on first paint and on explicit re-render. */
	renderNow(input: RenderInput): void {
		if (!browser) return;
		this.#request.cancel();
		void this.#run(input);
	}

	async #fontBundle(theme: Theme, charset: string): Promise<FontBundle> {
		// The charset is part of the key: Google fonts are subsetted to the
		// document's characters, so a new character needs a new file.
		const key = `${JSON.stringify(theme.fonts)}|${charsetKey(charset)}`;
		if (this.#fontCache?.key === key) return this.#fontCache.bundle;

		const resolution = await resolveFonts(theme, charset);
		const { vfs, fonts } = buildVfs(resolution.fonts);
		const bundle: FontBundle = {
			roles: resolution.roles,
			vfs,
			fonts,
			warnings: resolution.warnings,
			failed: resolution.failed.map((f) => ({ role: f.role, reason: f.reason }))
		};
		this.#fontCache = { key, bundle };
		return bundle;
	}

	async #run(input: RenderInput): Promise<void> {
		const id = this.#nextId++;
		this.#latestId = id;
		this.state = 'generating';
		this.error = null;

		try {
			const { theme, source, metaOverrides } = input;
			const parsed = parse(source, theme.pagebreak.marker, metaOverrides);
			const imageResult = await resolveImages(collectImageSources(parsed.tokens));
			const fontBundle = await this.#fontBundle(theme, documentCharset(source));

			if (id !== this.#latestId) return; // superseded while awaiting

			this.fontFailures = fontBundle.failed;

			const request: RenderRequest = {
				id,
				tokens: JSON.parse(JSON.stringify(parsed.tokens)),
				theme,
				meta: parsed.meta,
				images: [...imageResult.images],
				roles: fontBundle.roles,
				vfs: fontBundle.vfs,
				fonts: fontBundle.fonts
			};

			const preWarnings = [
				...parsed.warnings,
				...imageResult.warnings,
				...fontBundle.warnings
			];

			const response = await this.#dispatch(request);
			// Responses with a stale id are discarded, or a fast typist watches the
			// preview lag seconds behind the editor (§8, pitfall 4).
			if (response.id !== this.#latestId) return;

			if (!response.ok) {
				this.state = 'error';
				this.error = response.error;
				this.completedId = id;
				return;
			}

			this.buffer = response.buffer;
			this.pageCount = response.pageCount;
			this.anchors = response.anchors;
			this.meta = parsed.meta;
			const sizeWarning =
				response.pageCount > SOFT_PAGE_LIMIT
					? [
							`This document is ${response.pageCount} pages. Above ${SOFT_PAGE_LIMIT} the preview gets slow and memory-hungry; the download is unaffected.`
						]
					: [];
			this.warnings = dedupe([...preWarnings, ...response.warnings, ...sizeWarning]);
			this.state = 'ready';
			this.completedId = id;
		} catch (e) {
			if (id !== this.#latestId) return;
			this.state = 'error';
			this.error = e instanceof Error ? e.message : String(e);
			this.completedId = id;
		}
	}

	#ensureWorker(): Worker | null {
		if (this.#workerBroken) return null;
		if (this.#worker) return this.#worker;
		try {
			this.#worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), {
				type: 'module'
			});
			return this.#worker;
		} catch {
			this.#workerBroken = true;
			this.usingMainThread = true;
			return null;
		}
	}

	/** Worker when it works; main thread when it does not (§8, §16 item 1). */
	async #dispatch(request: RenderRequest): Promise<RenderResponse> {
		const worker = this.#ensureWorker();
		if (!worker) return this.#mainThread(request);

		try {
			return await new Promise<RenderResponse>((resolve, reject) => {
				const onMessage = (e: MessageEvent<RenderResponse>) => {
					if (e.data.id !== request.id) return;
					cleanup();
					resolve(e.data);
				};
				const onError = (e: ErrorEvent) => {
					cleanup();
					reject(new Error(e.message || 'PDF worker failed to start'));
				};
				const cleanup = () => {
					worker.removeEventListener('message', onMessage as EventListener);
					worker.removeEventListener('error', onError as EventListener);
				};
				worker.addEventListener('message', onMessage as EventListener);
				worker.addEventListener('error', onError as EventListener);
				worker.postMessage(request);
			});
		} catch {
			// The worker is a performance optimisation, not a correctness
			// requirement — fall back permanently and record it (§8).
			this.#workerBroken = true;
			this.usingMainThread = true;
			this.#worker?.terminate();
			this.#worker = null;
			return this.#mainThread(request);
		}
	}

	async #mainThread(request: RenderRequest): Promise<RenderResponse> {
		const { generate } = await import('../pdf/engine');
		try {
			const result = await generate(request);
			return { id: request.id, ok: true, ...result };
		} catch (e) {
			return {
				id: request.id,
				ok: false,
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}

	/** The Download button reuses this exact buffer — it never regenerates (§9). */
	blob(): Blob | null {
		return this.buffer ? new Blob([this.buffer], { type: 'application/pdf' }) : null;
	}

	invalidateFonts(): void {
		this.#fontCache = null;
	}
}

export interface RenderInput {
	source: string;
	theme: Theme;
	metaOverrides: Partial<DocMeta>;
}

function dedupe(list: string[]): string[] {
	return [...new Set(list)];
}

export const pdfStore = new PdfStore();
