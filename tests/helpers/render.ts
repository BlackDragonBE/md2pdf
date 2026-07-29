import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PdfPrinter from 'pdfmake/src/printer.js';
import { buildDocDefinition } from '../../src/lib/pdf/buildDocDefinition';
import { buildLayouts } from '../../src/lib/pdf/layouts';
import { parse } from '../../src/lib/markdown/parse';
import type { ResolvedImage } from '../../src/lib/pdf/images';
import type { DocMeta } from '../../src/lib/markdown/frontmatter';
import type { FontMap } from '../../src/lib/pdf/styles';
import type { Theme } from '../../src/lib/theme/schema';
import { cloneDefaultTheme } from '../../src/lib/theme/defaults';

const ROOT = join(import.meta.dirname, '..', '..');
const FONT_DIR = join(ROOT, 'static', 'fonts');

interface Manifest {
	[id: string]: { files: Record<string, string> };
}

const manifest: Manifest = JSON.parse(
	readFileSync(join(FONT_DIR, 'manifest.json'), 'utf8')
) as Manifest;

/**
 * Node-side twin of the browser render path: same tokens, same theme, same
 * buildDocDefinition, same layouts. Only the font transport differs — files on
 * disk here, a base64 VFS in the browser.
 */
function printerFonts(ids: string[]) {
	const fonts: Record<string, Record<string, string>> = {};
	for (const id of ids) {
		const entry = manifest[id];
		if (!entry) throw new Error(`Unknown builtin font "${id}"`);
		fonts[`b_${id}`] = Object.fromEntries(
			Object.entries(entry.files).map(([face, path]) => [face, join(FONT_DIR, path)])
		);
	}
	return fonts;
}

export interface RenderOptions {
	theme?: Theme;
	meta?: Partial<DocMeta>;
	images?: Map<string, ResolvedImage>;
}

export interface RenderedPdf {
	buffer: Buffer;
	warnings: string[];
	docDefinition: ReturnType<typeof buildDocDefinition>['docDefinition'];
}

export async function renderMarkdown(
	source: string,
	options: RenderOptions = {}
): Promise<RenderedPdf> {
	const theme = options.theme ?? cloneDefaultTheme();
	const parsed = parse(source, theme.pagebreak.marker, options.meta ?? {});

	const ids = [...new Set(Object.values(theme.fonts).map((s) => (s.source.kind === 'builtin' ? s.source.id : s.fallback)))];
	const roles: FontMap = {
		body: `b_${theme.fonts.body.source.kind === 'builtin' ? theme.fonts.body.source.id : theme.fonts.body.fallback}`,
		heading: `b_${theme.fonts.heading.source.kind === 'builtin' ? theme.fonts.heading.source.id : theme.fonts.heading.fallback}`,
		mono: `b_${theme.fonts.mono.source.kind === 'builtin' ? theme.fonts.mono.source.id : theme.fonts.mono.fallback}`
	};

	const { docDefinition, warnings } = buildDocDefinition({
		tokens: parsed.tokens,
		theme,
		meta: parsed.meta,
		images: options.images ?? new Map(),
		fonts: roles
	});

	const printer = new PdfPrinter(printerFonts(ids));
	const doc = printer.createPdfKitDocument(docDefinition, { tableLayouts: buildLayouts(theme) });

	const chunks: Uint8Array[] = [];
	const buffer = await new Promise<Buffer>((resolve, reject) => {
		doc.on('data', (c) => {
			chunks.push(c);
		});
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
		doc.end();
	});

	return { buffer, warnings: [...warnings, ...parsed.warnings], docDefinition };
}

export interface TextItemGeometry {
	str: string;
	/** pdf.js text transform: [a, b, c, d, e, f]. b and c are zero unless rotated. */
	transform: number[];
}

export interface ExtractedPdf {
	pageCount: number;
	/** Text per page, in reading order. */
	pages: string[];
	text: string;
	fontNames: string[];
	items: TextItemGeometry[][];
}

/** Rotation in degrees implied by a pdf.js text transform. */
export function itemAngle(item: TextItemGeometry): number {
	const [a, b] = item.transform;
	return Math.round((Math.atan2(b, a) * 180) / Math.PI);
}

export async function extract(buffer: Buffer): Promise<ExtractedPdf> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({
		data: new Uint8Array(buffer),
		useSystemFonts: false,
		disableFontFace: true
	}).promise;

	const pages: string[] = [];
	const geometry: TextItemGeometry[][] = [];
	const fontNames = new Set<string>();
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const items = content.items as { str: string; fontName?: string; transform: number[] }[];
		pages.push(items.map((it) => it.str).join(''));
		geometry.push(items.map((it) => ({ str: it.str, transform: it.transform })));
		for (const it of items) if (it.fontName) fontNames.add(it.fontName);
		page.cleanup();
	}
	const pageCount = doc.numPages;
	await doc.destroy();

	return {
		pageCount,
		pages,
		text: pages.join('\n'),
		fontNames: [...fontNames],
		items: geometry
	};
}

export async function renderAndExtract(
	source: string,
	options: RenderOptions = {}
): Promise<ExtractedPdf & { warnings: string[] }> {
	const { buffer, warnings } = await renderMarkdown(source, options);
	return { ...(await extract(buffer)), warnings };
}
