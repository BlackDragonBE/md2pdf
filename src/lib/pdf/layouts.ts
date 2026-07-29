import type { Theme } from '../theme/schema';
import type { CustomTableLayout } from './pdfmake-types';

/**
 * Layouts close over the theme, so this is a factory. The result is passed as
 * the second argument to `createPdf`, never installed on a global (§6.6).
 */
export function buildLayouts(t: Theme): Record<string, CustomTableLayout> {
	const blockquoteBar: CustomTableLayout = {
		hLineWidth: () => 0,
		vLineWidth: (i) => (i === 0 ? t.blockquote.barWidth : 0),
		vLineColor: () => t.blockquote.barColor,
		hLineColor: () => t.blockquote.barColor,
		paddingLeft: () => t.blockquote.indent,
		paddingRight: () => 0,
		paddingTop: () => 2,
		paddingBottom: () => 2,
		fillColor: () => t.blockquote.background
	};

	const border = t.code.borderWidth > 0 ? t.code.borderWidth : 0;
	const codeBlock: CustomTableLayout = {
		hLineWidth: () => border,
		vLineWidth: () => border,
		hLineColor: () => t.code.borderColor,
		vLineColor: () => t.code.borderColor,
		paddingLeft: () => t.code.padding[0],
		paddingTop: () => t.code.padding[1],
		paddingRight: () => t.code.padding[2],
		paddingBottom: () => t.code.padding[3]
	};

	const themed: CustomTableLayout = {
		hLineWidth: () => t.table.borderWidth,
		vLineWidth: () => t.table.borderWidth,
		hLineColor: () => t.table.borderColor,
		vLineColor: () => t.table.borderColor,
		paddingLeft: () => t.table.cellPadding[0],
		paddingTop: () => t.table.cellPadding[1],
		paddingRight: () => t.table.cellPadding[2],
		paddingBottom: () => t.table.cellPadding[3],
		fillColor: (rowIndex) =>
			rowIndex === 0
				? t.table.headerFill
				: t.table.zebra && rowIndex % 2 === 0
					? t.table.zebra
					: null
	};

	/** Code block with a gutter: no inner rule between gutter and source. */
	const codeBlockGutter: CustomTableLayout = {
		...codeBlock,
		vLineWidth: (i, node) => {
			const cols = (node as { table?: { widths?: unknown[] } })?.table?.widths?.length ?? 2;
			return i === 0 || i === cols ? border : 0;
		}
	};

	return { themed, codeBlock, codeBlockGutter, blockquoteBar };
}
