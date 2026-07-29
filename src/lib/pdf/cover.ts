import type { DocMeta } from '../markdown/frontmatter';
import type { CoverBlockT, Theme } from '../theme/schema';
import { formatDate } from './headerFooter';
import type { Content, PageSize, TextNode } from './pdfmake-types';
import type { FontMap } from './styles';
import { backgroundFill, backgroundImage } from './watermark';

function blockText(block: CoverBlockT, meta: DocMeta, t: Theme): string {
	switch (block.field) {
		case 'literal':
			return block.literal;
		case 'date':
			return meta.date || block.literal ? formatDate(meta.date, t.locale) : '';
		default:
			return meta[block.field];
	}
}

/**
 * Drawn from the `background` callback rather than the content flow: only the
 * callback receives `pageSize`, and pdfmake's content flow has no vertical
 * alignment, so `y: "38%"` has nowhere else to live (§12.1).
 */
export function buildCover(
	t: Theme,
	pageSize: PageSize,
	meta: DocMeta,
	fonts: FontMap
): Content {
	const layers: Content[] = [backgroundFill(t.cover.background.color, pageSize)];
	if (t.cover.background.image) {
		layers.push(backgroundImage(t.cover.background.image, pageSize));
	}

	const [ml, , mr] = t.page.margins;
	const width = pageSize.width - ml - mr;

	for (const block of t.cover.blocks) {
		const text = blockText(block, meta, t);
		if (!text) continue;
		const y = (parseFloat(block.y) / 100) * pageSize.height;
		const node: TextNode = {
			text,
			font: fonts[block.font],
			fontSize: block.size,
			bold: block.bold,
			color: block.color,
			alignment: block.alignment,
			absolutePosition: { x: ml, y },
			width
		};
		layers.push(node);
	}

	return layers;
}

/** Content page 1 is an empty spacer so the cover owns a page of its own (§12.1). */
export function coverSpacer(t: Theme): Content[] {
	return t.cover.enabled ? [{ text: '', pageBreak: 'after' }] : [];
}
