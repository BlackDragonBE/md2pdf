// Ambient declarations for dependencies that ship no types.
// Must stay a script (no top-level import/export) or these become module
// augmentations of modules that do not exist.

declare module 'markdown-it-task-lists' {
	import type MarkdownIt from 'markdown-it';
	interface TaskListsOptions {
		enabled?: boolean;
		label?: boolean;
		labelAfter?: boolean;
	}
	const plugin: (md: MarkdownIt, options?: TaskListsOptions) => void;
	export default plugin;
}

declare module 'pdfmake/build/pdfmake' {
	const pdfMake: unknown;
	export default pdfMake;
}

declare module 'pdfmake/src/printer.js' {
	interface PdfKitDocument {
		on(event: 'data', cb: (chunk: Uint8Array) => void): void;
		on(event: 'end', cb: () => void): void;
		on(event: 'error', cb: (error: Error) => void): void;
		end(): void;
	}
	export default class PdfPrinter {
		constructor(fonts: Record<string, Record<string, string>>);
		createPdfKitDocument(docDefinition: unknown, options?: unknown): PdfKitDocument;
	}
}

declare module 'wawoff2' {
	export function decompress(input: Uint8Array): Promise<Uint8Array>;
	export function compress(input: Uint8Array): Promise<Uint8Array>;
}

declare module 'wawoff2/build/decompress_binding.js?url' {
	const url: string;
	export default url;
}
