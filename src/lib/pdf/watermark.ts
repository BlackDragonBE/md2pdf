import type { ImageSpecT, Theme } from '../theme/schema';
import type { Content, ImageNode, PageSize } from './pdfmake-types';
import type { FontMap } from './styles';

/** Solid page fill, drawn first so everything else composites over it (§12.2). */
export function backgroundFill(color: string, pageSize: PageSize): Content {
	return {
		canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color }]
	};
}

/**
 * pdfmake has no background-size, so `fit` is expressed with the node shapes it
 * does have: `cover` uses the cover option, `contain` uses `fit`, `stretch`
 * sets both dimensions. `tile` has no pdfmake equivalent and falls back to
 * cover with a warning from the caller.
 */
export function backgroundImage(spec: ImageSpecT, pageSize: PageSize): Content {
	const base: ImageNode = {
		image: spec.dataUri,
		opacity: spec.opacity,
		absolutePosition: { x: 0, y: 0 }
	};
	switch (spec.fit) {
		case 'contain':
			return { ...base, fit: [pageSize.width, pageSize.height] };
		case 'stretch':
			return { ...base, width: pageSize.width, height: pageSize.height };
		case 'cover':
		case 'tile':
		default:
			return { ...base, cover: { width: pageSize.width, height: pageSize.height } };
	}
}

export interface WatermarkSpec {
	text: string;
	font: string;
	fontSize: number;
	color: string;
	opacity: number;
	bold: boolean;
	angle: number;
}

/**
 * pdfmake's own `docDefinition.watermark`, not a text node in the background
 * callback.
 *
 * §12.2 sketches a node carrying `angle`, but pdfmake only ever calls
 * `pdfKitDoc.rotate` for its built-in watermark — `angle` on an ordinary text
 * node is silently ignored, so that shape renders horizontally. The built-in
 * one honours angle and opacity, and draws after content on every page, which
 * is the "watermark last (top)" ordering §12.2 asks for.
 *
 * One consequence worth knowing: pdfmake stamps every page, so an enabled
 * watermark also appears on the cover.
 */
export function watermarkSpec(t: Theme, fonts: FontMap): WatermarkSpec | undefined {
	if (!t.watermark.enabled || t.watermark.text.trim() === '') return undefined;
	return {
		text: t.watermark.text,
		font: fonts[t.watermark.font],
		fontSize: t.watermark.size,
		color: t.watermark.color,
		opacity: t.watermark.opacity,
		bold: true,
		angle: t.watermark.angle
	};
}

/** Background fill, then the background image on top of it (§12.2). */
export function pageBackground(t: Theme, pageSize: PageSize): Content {
	const layers: Content[] = [backgroundFill(t.background.color, pageSize)];
	if (t.background.image) layers.push(backgroundImage(t.background.image, pageSize));
	return layers;
}
