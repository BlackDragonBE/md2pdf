import { THEME_VERSION, type ElementStyleT, type Theme } from './schema';

function el(partial: Partial<ElementStyleT> & Pick<ElementStyleT, 'size' | 'margin'>): ElementStyleT {
	return {
		font: 'body',
		bold: false,
		italics: false,
		color: '#24292f',
		lineHeight: 1.35,
		alignment: 'left',
		breakBefore: false,
		keepWithNext: false,
		characterSpacing: 0,
		...partial
	};
}

export const DEFAULT_THEME: Theme = {
	version: THEME_VERSION,
	name: 'Default',

	page: { size: 'A4', orientation: 'portrait', margins: [56, 64, 56, 64] },

	fonts: {
		body: { source: { kind: 'builtin', id: 'inter' }, fallback: 'inter' },
		heading: { source: { kind: 'builtin', id: 'inter' }, fallback: 'inter' },
		mono: { source: { kind: 'builtin', id: 'jetbrains-mono' }, fallback: 'jetbrains-mono' }
	},

	background: { color: '#ffffff', image: null },

	watermark: {
		enabled: false,
		text: 'DRAFT',
		angle: -45,
		opacity: 0.08,
		size: 90,
		color: '#000000',
		font: 'heading'
	},

	cover: {
		enabled: false,
		background: { color: '#ffffff', image: null },
		blocks: [
			{
				field: 'title',
				literal: '',
				y: '38%',
				alignment: 'center',
				font: 'heading',
				size: 34,
				bold: true,
				color: '#111111'
			},
			{
				field: 'subtitle',
				literal: '',
				y: '47%',
				alignment: 'center',
				font: 'heading',
				size: 16,
				bold: false,
				color: '#555555'
			},
			{
				field: 'author',
				literal: '',
				y: '72%',
				alignment: 'center',
				font: 'body',
				size: 12,
				bold: false,
				color: '#555555'
			},
			{
				field: 'date',
				literal: '',
				y: '78%',
				alignment: 'center',
				font: 'body',
				size: 10,
				bold: false,
				color: '#888888'
			}
		],
		excludeFromPageCount: true
	},

	header: {
		enabled: false,
		template: '{{title}}',
		alignment: 'right',
		font: 'body',
		size: 8,
		color: '#888888',
		offset: 28,
		showOnFirstContentPage: true,
		rule: { enabled: false, color: '#dddddd', width: 0.5 }
	},

	footer: {
		enabled: true,
		template: '{{page}} / {{pages}}',
		alignment: 'center',
		font: 'body',
		size: 8,
		color: '#888888',
		offset: 28,
		showOnFirstContentPage: true,
		rule: { enabled: false, color: '#dddddd', width: 0.5 }
	},

	pagebreak: { marker: '\\pagebreak' },

	code: {
		background: '#f6f8fa',
		borderColor: '#e1e4e8',
		borderWidth: 0.5,
		padding: [8, 6, 8, 6],
		showLineNumbers: false,
		lineNumberColor: '#b0b0b0',
		syntaxHighlight: false,
		tokenColors: {
			keyword: '#cf222e',
			string: '#0a3069',
			comment: '#6e7781',
			number: '#0550ae',
			title: '#8250df',
			built_in: '#0550ae',
			literal: '#0550ae',
			attr: '#0550ae',
			type: '#953800',
			variable: '#953800',
			meta: '#6e7781',
			regexp: '#0a3069',
			symbol: '#0550ae'
		}
	},

	table: {
		headerFill: '#f0f0f0',
		headerColor: '#111111',
		headerBold: true,
		borderColor: '#dddddd',
		borderWidth: 0.5,
		zebra: null,
		cellPadding: [6, 4, 6, 4],
		repeatHeader: true
	},

	blockquote: { barColor: '#cccccc', barWidth: 3, indent: 12, background: null },

	hr: { color: '#dddddd', width: 0.5, margin: [0, 10, 0, 10] },

	list: {
		bulletChars: ['•', '◦', '▪'],
		indent: 16,
		itemSpacing: 3,
		taskChecked: '☑',
		taskUnchecked: '☐'
	},

	link: { color: '#0366d6', underline: false },

	image: {
		maxWidth: 1,
		alignment: 'center',
		margin: [0, 8, 0, 8],
		caption: { enabled: false, size: 8, italics: true, color: '#666666' }
	},

	elements: {
		h1: el({ font: 'heading', size: 26, bold: true, color: '#111111', margin: [0, 18, 0, 8], keepWithNext: true }),
		h2: el({ font: 'heading', size: 20, bold: true, color: '#111111', margin: [0, 16, 0, 7], keepWithNext: true }),
		h3: el({ font: 'heading', size: 16, bold: true, color: '#111111', margin: [0, 14, 0, 6], keepWithNext: true }),
		h4: el({ font: 'heading', size: 13, bold: true, color: '#222222', margin: [0, 12, 0, 5], keepWithNext: true }),
		h5: el({ font: 'heading', size: 11, bold: true, color: '#333333', margin: [0, 10, 0, 4], keepWithNext: true }),
		h6: el({ font: 'heading', size: 10, bold: true, color: '#555555', margin: [0, 10, 0, 4], keepWithNext: true }),
		paragraph: el({ size: 10.5, margin: [0, 0, 0, 8] }),
		codeBlock: el({ font: 'mono', size: 9, color: '#24292f', lineHeight: 1.4, margin: [0, 4, 0, 10] }),
		inlineCode: el({ font: 'mono', size: 9.5, color: '#b31d28', margin: [0, 0, 0, 0] }),
		blockquote: el({ size: 10.5, italics: true, color: '#57606a', margin: [0, 4, 0, 10] }),
		listItem: el({ size: 10.5, margin: [0, 0, 0, 0] }),
		tableCell: el({ size: 9.5, margin: [0, 0, 0, 0] }),
		tableHeader: el({ size: 9.5, bold: true, color: '#111111', margin: [0, 0, 0, 0] })
	},

	locale: 'en-GB'
};

/** Deep structural clone; themes are plain JSON so this is safe. */
export function cloneDefaultTheme(): Theme {
	return structuredClone(DEFAULT_THEME);
}
