import type Token from 'markdown-it/lib/token.mjs';
import { attrGet } from './inline';

export interface ResolvedImageOk {
	kind: 'ok';
	dataUri: string;
	/** Intrinsic pixel dimensions. pdfmake will not scale without an explicit width (§6.7). */
	width: number;
	height: number;
}
export interface ResolvedImageFailed {
	kind: 'failed';
	reason: string;
}
export type ResolvedImage = ResolvedImageOk | ResolvedImageFailed;

export interface ImageResolution {
	images: Map<string, ResolvedImage>;
	warnings: string[];
}

/**
 * Session cache keyed by source URL, so a re-render on every keystroke does not
 * re-fetch (§6.7 item 5).
 */
const cache = new Map<string, ResolvedImage>();

export function clearImageCache(): void {
	cache.clear();
}

/** Every `src` in the token stream, in document order, deduplicated. */
export function collectImageSources(tokens: Token[]): string[] {
	const seen = new Set<string>();
	const walk = (list: Token[]) => {
		for (const tok of list) {
			if (tok.type === 'image') {
				const src = attrGet(tok, 'src');
				if (src) seen.add(src);
			}
			if (tok.children) walk(tok.children);
		}
	};
	walk(tokens);
	return [...seen];
}

async function intrinsicSize(blob: Blob): Promise<{ width: number; height: number }> {
	if (typeof createImageBitmap === 'function') {
		const bmp = await createImageBitmap(blob);
		const size = { width: bmp.width, height: bmp.height };
		bmp.close();
		return size;
	}
	// SVG and any environment without createImageBitmap: fall back to <img>.
	const url = URL.createObjectURL(blob);
	try {
		return await new Promise<{ width: number; height: number }>((resolve, reject) => {
			const img = new Image();
			img.onload = () =>
				resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 150 });
			img.onerror = () => reject(new Error('image failed to decode'));
			img.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

function blobToDataUri(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result));
		fr.onerror = () => reject(fr.error ?? new Error('read failed'));
		fr.readAsDataURL(blob);
	});
}

async function resolveOne(src: string): Promise<ResolvedImage> {
	if (src.startsWith('data:')) {
		if (!/^data:image\//i.test(src)) {
			return { kind: 'failed', reason: 'data: URI is not an image' };
		}
		const blob = await fetch(src).then((r) => r.blob());
		const { width, height } = await intrinsicSize(blob);
		return { kind: 'ok', dataUri: src, width, height };
	}

	if (/^https?:\/\//i.test(src)) {
		const res = await fetch(src, { mode: 'cors' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const blob = await res.blob();
		if (!blob.type.startsWith('image/'))
			throw new Error(`not an image (${blob.type || 'unknown'})`);
		const [dataUri, size] = await Promise.all([blobToDataUri(blob), intrinsicSize(blob)]);
		return { kind: 'ok', dataUri, width: size.width, height: size.height };
	}

	// Relative paths cannot be resolved in a static app with no document root (§6.7 item 3).
	return {
		kind: 'failed',
		reason: 'relative paths cannot be resolved — paste the image to embed it instead'
	};
}

/**
 * Resolve every image to a data: URI plus intrinsic size, on the main thread,
 * before the token stream goes to the worker (§6.7 item 6).
 * A broken image never aborts generation — it becomes a placeholder plus a warning.
 */
export async function resolveImages(sources: string[]): Promise<ImageResolution> {
	const warnings: string[] = [];
	const images = new Map<string, ResolvedImage>();

	await Promise.all(
		sources.map(async (src) => {
			const hit = cache.get(src);
			if (hit) {
				images.set(src, hit);
				if (hit.kind === 'failed') warnings.push(`Image "${short(src)}": ${hit.reason}`);
				return;
			}
			let result: ResolvedImage;
			try {
				result = await resolveOne(src);
			} catch (e) {
				result = {
					kind: 'failed',
					reason: e instanceof Error ? e.message : String(e)
				};
			}
			cache.set(src, result);
			images.set(src, result);
			if (result.kind === 'failed') warnings.push(`Image "${short(src)}": ${result.reason}`);
		})
	);

	return { images, warnings };
}

function short(src: string): string {
	return src.length > 60 ? `${src.slice(0, 57)}…` : src;
}

/**
 * Draw width in pt. Pixels are converted at 96 dpi and clamped to the content
 * column; without an explicit width pdfmake overflows and clips silently.
 */
export function drawWidth(
	intrinsicWidth: number,
	contentWidth: number,
	maxWidthFraction: number
): number {
	return Math.min(intrinsicWidth * 0.75, contentWidth * maxWidthFraction);
}
