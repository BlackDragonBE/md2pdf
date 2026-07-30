import pdfMakeModule from 'pdfmake/build/pdfmake';
import { buildDocDefinition, type Anchor } from './buildDocDefinition';
import { buildLayouts } from './layouts';
import type { CustomTableLayout, DocDefinition, FontDictionary, Vfs } from './pdfmake-types';
import type { RenderRequest } from '../workers/protocol';
import type { FontMap } from './styles';

interface PdfMakeDocument {
	_createDoc(options: object, cb: (doc: PdfKitDoc) => void): void;
	_flushDoc(doc: PdfKitDoc, cb: (buffer: Uint8Array, pages: unknown[]) => void): void;
	getBuffer(cb: (buffer: Uint8Array) => void): void;
}

interface PdfKitDoc {
	on(event: string, cb: () => void): void;
	read(size: number): Uint8Array | null;
	end(): void;
}

interface PdfMakeApi {
	createPdf(
		docDefinition: DocDefinition,
		tableLayouts: Record<string, CustomTableLayout>,
		fonts: FontDictionary,
		vfs: Vfs
	): PdfMakeDocument;
}

const pdfMake = pdfMakeModule as unknown as PdfMakeApi;

export interface GenerateResult {
	buffer: ArrayBuffer;
	pageCount: number;
	warnings: string[];
	/** Source line → page and offset, for scroll sync. Sorted by line. */
	anchors: Anchor[];
}

/**
 * Runs identically on the worker and, if the worker spike fails, on the main
 * thread. Everything it needs is in the request — no globals, no module state,
 * so consecutive renders cannot bleed fonts into one another (§7.5).
 */
export function generate(req: RenderRequest): Promise<GenerateResult> {
	const { docDefinition, warnings, anchors } = buildDocDefinition({
		tokens: req.tokens,
		theme: req.theme,
		meta: req.meta,
		images: new Map(req.images),
		emojiArt: new Map(req.emojiArt ?? []),
		fonts: req.roles as FontMap
	});

	const layouts = buildLayouts(req.theme);
	const doc = pdfMake.createPdf(docDefinition, layouts, req.fonts, req.vfs);

	return new Promise<GenerateResult>((resolve, reject) => {
		try {
			// ponytail: _createDoc/_flushDoc are pdfmake internals, used because the
			// public getBuffer() discards the page list we need for the page counter.
			// If they ever move, fall back to getBuffer() and take the count from pdf.js.
			doc._createDoc({}, (kit) => {
				doc._flushDoc(kit, (buffer, pages) => {
					const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
					const copy = new ArrayBuffer(bytes.byteLength);
					new Uint8Array(copy).set(bytes);
					resolve({
						buffer: copy,
						pageCount: pages?.length ?? 0,
						warnings,
						anchors: [...anchors.values()].sort((a, b) => a.line - b.line)
					});
				});
			});
		} catch (e) {
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}
