/**
 * pdfmake ships weak types. These are the shapes this app actually produces
 * and consumes — narrow enough to catch mistakes, no `any` at call sites (§2).
 */

export type Margin = [number, number, number, number];
export type Alignment = 'left' | 'center' | 'right' | 'justify';
export type PageSizeName = 'A3' | 'A4' | 'A5' | 'LETTER' | 'LEGAL' | 'TABLOID';
export type PageOrientation = 'portrait' | 'landscape';

export interface PageSize {
	width: number;
	height: number;
	orientation?: PageOrientation;
}

export interface TextRun {
	text: string;
	font?: string;
	fontSize?: number;
	bold?: boolean;
	italics?: boolean;
	color?: string;
	background?: string;
	decoration?: 'underline' | 'lineThrough' | 'overline';
	decorationStyle?: 'dashed' | 'dotted' | 'double' | 'wavy';
	decorationColor?: string;
	link?: string;
	style?: string;
	characterSpacing?: number;
	lineHeight?: number;
	preserveLeadingSpaces?: boolean;
	noWrap?: boolean;
	sup?: boolean;
	sub?: boolean;
}

export interface TextNode extends Omit<TextRun, 'text'> {
	text: string | (string | TextRun)[];
	alignment?: Alignment;
	margin?: Margin;
	pageBreak?: 'before' | 'after';
	headlineLevel?: number;
	absolutePosition?: { x: number; y: number };
	relativePosition?: { x: number; y: number };
	width?: number;
	opacity?: number;
	angle?: number;
	unbreakable?: boolean;
}

export interface ImageNode {
	image: string;
	width?: number;
	height?: number;
	fit?: [number, number];
	cover?: { width: number; height: number; valign?: string; align?: string };
	opacity?: number;
	alignment?: Alignment;
	margin?: Margin;
	pageBreak?: 'before' | 'after';
	absolutePosition?: { x: number; y: number };
	link?: string;
}

export interface CanvasRect {
	type: 'rect';
	x: number;
	y: number;
	w: number;
	h: number;
	color?: string;
	lineColor?: string;
	lineWidth?: number;
	opacity?: number;
	r?: number;
}

export interface CanvasLine {
	type: 'line';
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	lineWidth?: number;
	lineColor?: string;
	dash?: { length: number; space?: number };
	opacity?: number;
}

export type CanvasElement = CanvasRect | CanvasLine;

export interface CanvasNode {
	canvas: CanvasElement[];
	margin?: Margin;
	absolutePosition?: { x: number; y: number };
	pageBreak?: 'before' | 'after';
	alignment?: Alignment;
}

export interface StackNode {
	stack: Content[];
	margin?: Margin;
	style?: string;
	alignment?: Alignment;
	pageBreak?: 'before' | 'after';
	unbreakable?: boolean;
	headlineLevel?: number;
}

export interface ColumnsNode {
	columns: Content[];
	columnGap?: number;
	margin?: Margin;
	style?: string;
	pageBreak?: 'before' | 'after';
}

export interface ListNode {
	ul?: Content[];
	ol?: Content[];
	type?: string;
	start?: number;
	markerColor?: string;
	separator?: string | [string, string];
	margin?: Margin;
	style?: string;
	pageBreak?: 'before' | 'after';
}

export type TableWidth = number | 'auto' | '*' | string;

export interface TableCell {
	colSpan?: number;
	rowSpan?: number;
	fillColor?: string;
	border?: [boolean, boolean, boolean, boolean];
	alignment?: Alignment;
}

export interface TableBody {
	widths?: TableWidth[];
	heights?: number | number[];
	headerRows?: number;
	dontBreakRows?: boolean;
	keepWithHeaderRows?: number;
	body: Content[][];
	widthsAuto?: boolean;
}

export interface TableNode {
	table: TableBody;
	layout?: string | CustomTableLayout;
	margin?: Margin;
	style?: string;
	pageBreak?: 'before' | 'after';
	fillColor?: string;
	unbreakable?: boolean;
	headlineLevel?: number;
}

export interface QrNode {
	qr: string;
	fit?: number;
}

export type Content =
	| string
	| TextRun
	| TextNode
	| ImageNode
	| CanvasNode
	| StackNode
	| ColumnsNode
	| ListNode
	| TableNode
	| QrNode
	| Content[];

export interface CustomTableLayout {
	hLineWidth?: (i: number, node: unknown) => number;
	vLineWidth?: (i: number, node: unknown) => number;
	hLineColor?: (i: number, node: unknown) => string;
	vLineColor?: (i: number, node: unknown) => string;
	hLineStyle?: (i: number, node: unknown) => { dash: { length: number; space?: number } } | null;
	vLineStyle?: (i: number, node: unknown) => { dash: { length: number; space?: number } } | null;
	paddingLeft?: (i: number, node: unknown) => number;
	paddingRight?: (i: number, node: unknown) => number;
	paddingTop?: (i: number, node: unknown) => number;
	paddingBottom?: (i: number, node: unknown) => number;
	fillColor?: (rowIndex: number, node: unknown, columnIndex: number) => string | null;
	fillOpacity?: (rowIndex: number, node: unknown, columnIndex: number) => number;
	defaultBorder?: boolean;
}

export interface StyleDefinition {
	font?: string;
	fontSize?: number;
	bold?: boolean;
	italics?: boolean;
	color?: string;
	lineHeight?: number;
	alignment?: Alignment;
	margin?: Margin;
	characterSpacing?: number;
	fillColor?: string;
	decoration?: string;
}

/** The subset of the node shape `pageBreakBefore` receives (§6.8). */
export interface PageBreakNodeInfo {
	id?: string;
	headlineLevel?: number;
	text?: unknown;
	startPosition: { pageNumber: number; top: number; verticalRatio: number };
	pageNumbers: number[];
	pages: number;
	stack?: boolean;
}

export interface DocumentInfo {
	title?: string;
	author?: string;
	subject?: string;
	keywords?: string;
	creator?: string;
	producer?: string;
}

export interface DocDefinition {
	pageSize: PageSizeName;
	pageOrientation: PageOrientation;
	pageMargins: Margin;
	content: Content[];
	styles: Record<string, StyleDefinition>;
	defaultStyle: StyleDefinition;
	info?: DocumentInfo;
	background?: (currentPage: number, pageSize: PageSize) => Content;
	header?: (currentPage: number, pageCount: number, pageSize: PageSize) => Content | undefined;
	footer?: (currentPage: number, pageCount: number, pageSize: PageSize) => Content | undefined;
	pageBreakBefore?: (
		currentNode: PageBreakNodeInfo,
		followingNodesOnPage: PageBreakNodeInfo[],
		nodesOnNextPage: PageBreakNodeInfo[],
		previousNodesOnPage: PageBreakNodeInfo[]
	) => boolean;
	images?: Record<string, string>;
	/** pdfmake's built-in watermark: the only text it will actually rotate (§12.2). */
	watermark?: {
		text: string;
		font?: string;
		fontSize?: number;
		color?: string;
		opacity?: number;
		bold?: boolean;
		italics?: boolean;
		angle?: number;
	};
	compress?: boolean;
}

export type FaceKey = 'normal' | 'bold' | 'italics' | 'bolditalics';
export type FontDictionary = Record<string, Record<FaceKey, string>>;
export type Vfs = Record<string, string>;

/** Point dimensions of every page size we expose, portrait. */
export const PAGE_SIZES: Record<PageSizeName, [number, number]> = {
	A3: [841.89, 1190.55],
	A4: [595.28, 841.89],
	A5: [419.53, 595.28],
	LETTER: [612, 792],
	LEGAL: [612, 1008],
	TABLOID: [792, 1224]
};

export function pageDimensions(size: PageSizeName, orientation: PageOrientation): PageSize {
	const [w, h] = PAGE_SIZES[size];
	return orientation === 'landscape'
		? { width: h, height: w, orientation }
		: { width: w, height: h, orientation };
}
