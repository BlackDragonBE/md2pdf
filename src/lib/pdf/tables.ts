import type { Theme } from '../theme/schema';
import type { Alignment, Content, TableNode, TableWidth } from './pdfmake-types';

export interface TableCellSpec {
	content: Content;
	alignment: Alignment | null;
}

/**
 * Markdown tables have no width syntax, so every column gets an equal share of
 * the content width. `auto` would let one long cell starve the others.
 */
export function buildTable(header: TableCellSpec[], rows: TableCellSpec[][], t: Theme): TableNode {
	const columns = Math.max(header.length, ...rows.map((r) => r.length), 1);
	const widths: TableWidth[] = Array.from({ length: columns }, () => '*');

	const pad = (row: TableCellSpec[], style: string): Content[] => {
		const cells: Content[] = row.map((c) =>
			c.alignment
				? ({ stack: [c.content], alignment: c.alignment, style } as Content)
				: ({ stack: [c.content], style } as Content)
		);
		while (cells.length < columns) cells.push({ text: '', style });
		return cells;
	};

	const body: Content[][] = [];
	const hasHeader = header.length > 0;
	if (hasHeader) body.push(pad(header, 'tableHeader'));
	for (const row of rows) body.push(pad(row, 'tableCell'));
	if (body.length === 0) body.push(Array.from({ length: columns }, () => ({ text: '' })));

	return {
		table: {
			headerRows: hasHeader && t.table.repeatHeader ? 1 : 0,
			widths,
			body
		},
		layout: 'themed',
		margin: [0, 4, 0, 10]
	};
}

/** markdown-it puts column alignment in a `style="text-align:…"` attribute. */
export function alignmentFromStyle(style: string | null): Alignment | null {
	if (!style) return null;
	const m = /text-align:\s*(left|center|right)/i.exec(style);
	return m ? (m[1].toLowerCase() as Alignment) : null;
}
