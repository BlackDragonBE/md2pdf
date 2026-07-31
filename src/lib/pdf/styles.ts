import type { ElementKey, ElementStyleT, FontRole, Theme } from '../theme/schema';
import type { StyleDefinition } from './pdfmake-types';

/**
 * Font role → the family name registered in the pdfmake font dictionary.
 * `emoji` is not a theme role — it is the bundled emoji family, present only
 * when the document needs it (see pdf/emoji.ts).
 */
export type FontMap = Record<FontRole, string> & { emoji?: string };

export function elementStyle(e: ElementStyleT, fonts: FontMap): StyleDefinition {
	return {
		font: fonts[e.font],
		fontSize: e.size,
		bold: e.bold,
		italics: e.italics,
		color: e.color,
		lineHeight: e.lineHeight,
		alignment: e.alignment,
		margin: [...e.margin],
		characterSpacing: e.characterSpacing
	};
}

/**
 * theme.elements → the pdfmake `styles` dictionary. `keepWithNext` and
 * `breakBefore` have no pdfmake equivalent and are handled in
 * buildDocDefinition and per-node respectively (§6.5).
 */
export function buildStyles(t: Theme, fonts: FontMap): Record<string, StyleDefinition> {
	const out: Record<string, StyleDefinition> = {};
	for (const [key, value] of Object.entries(t.elements) as [ElementKey, ElementStyleT][]) {
		out[key] = elementStyle(value, fonts);
	}

	// Inline code is a run, not a block: its margin would offset the whole line.
	out.inlineCode = { ...out.inlineCode, margin: undefined, fillColor: t.code.background };

	// Table cells inherit padding from the layout, not from a style margin.
	out.tableCell = { ...out.tableCell, margin: undefined };
	out.tableHeader = { ...out.tableHeader, margin: undefined };

	// A TOC line is a table cell too; its spacing comes from `toc.entrySpacing`,
	// applied per entry as `tocMargin` so it can also carry the level indent.
	out.tocEntry = { ...out.tocEntry, margin: undefined };

	out.imageCaption = {
		font: fonts.body,
		fontSize: t.image.caption.size,
		italics: t.image.caption.italics,
		color: t.image.caption.color,
		alignment: t.image.alignment
	};

	out.codeLineNumber = {
		font: fonts.mono,
		fontSize: t.elements.codeBlock.size,
		color: t.code.lineNumberColor,
		lineHeight: t.elements.codeBlock.lineHeight,
		alignment: 'right'
	};

	return out;
}

/** `defaultStyle` is derived from the paragraph element (§6.5). */
export function buildDefaultStyle(t: Theme, fonts: FontMap): StyleDefinition {
	const p = elementStyle(t.elements.paragraph, fonts);
	// A default margin would apply to header, footer and cover nodes too.
	return { ...p, margin: undefined };
}
