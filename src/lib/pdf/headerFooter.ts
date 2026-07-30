import type { DocMeta } from '../markdown/frontmatter';
import type { Theme } from '../theme/schema';
import { emojiText } from './emoji';
import type { Content, PageSize, StackNode, TextNode } from './pdfmake-types';
import type { FontMap } from './styles';

export interface TemplateValues {
	page: number;
	pages: number;
	title: string;
	subtitle: string;
	author: string;
	date: string;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * A deliberately small template engine: a fixed whitelist, no expressions, no
 * conditionals, no property access (§12.3).
 */
export function substitute(
	template: string,
	values: TemplateValues,
	warnings?: Set<string>
): string {
	return template.replace(TOKEN, (match, key: string) => {
		if (key in values) return String(values[key as keyof TemplateValues]);
		warnings?.add(`Unknown template token ${match} rendered literally.`);
		return match;
	});
}

/** `''` means "today at render time" (§6.1). */
export function formatDate(iso: string, locale: string): string {
	const d = iso ? new Date(iso) : new Date();
	if (Number.isNaN(d.getTime())) return iso;
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d);
	} catch {
		return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(d);
	}
}

export function templateValues(
	meta: DocMeta,
	theme: Theme,
	page: number,
	pages: number
): TemplateValues {
	return {
		page,
		pages,
		title: meta.title,
		subtitle: meta.subtitle,
		author: meta.author,
		date: formatDate(meta.date, theme.locale)
	};
}

/** Pages the cover occupies and which are excluded from numbering (§12.1). */
export function pageOffset(t: Theme): number {
	return t.cover.enabled && t.cover.excludeFromPageCount ? 1 : 0;
}

/** True when this physical page is a cover page and must carry no running text. */
export function isCoverPage(currentPage: number, t: Theme): boolean {
	return t.cover.enabled && currentPage === 1;
}

type Band = Theme['header'] | Theme['footer'];

function bandNode(
	band: Band,
	place: 'header' | 'footer',
	currentPage: number,
	pageCount: number,
	pageSize: PageSize,
	t: Theme,
	meta: DocMeta,
	fonts: FontMap,
	warnings: Set<string>
): Content | undefined {
	if (!band.enabled) return undefined;
	if (isCoverPage(currentPage, t)) return undefined;

	const offset = pageOffset(t);
	const logicalPage = currentPage - offset;
	if (logicalPage < 1) return undefined;
	if (!band.showOnFirstContentPage && logicalPage === 1) return undefined;

	const values = templateValues(meta, t, logicalPage, Math.max(0, pageCount - offset));
	const text = substitute(band.template, values, warnings);

	const [ml, , mr] = t.page.margins;
	const contentWidth = pageSize.width - ml - mr;

	const label: TextNode = {
		text: emojiText(text, fonts.emoji),
		font: fonts[band.font],
		fontSize: band.size,
		color: band.color,
		alignment: band.alignment,
		// A header/footer node's margin is relative to the page edge (§12.3).
		margin: place === 'header' ? [ml, band.offset, mr, 0] : [ml, 0, mr, band.offset]
	};

	if (!band.rule.enabled) return label;

	const rule: Content = {
		canvas: [
			{
				type: 'line',
				x1: 0,
				y1: 0,
				x2: contentWidth,
				y2: 0,
				lineWidth: band.rule.width,
				lineColor: band.rule.color
			}
		],
		margin: place === 'header' ? [ml, 3, mr, 0] : [ml, 0, mr, 3]
	};

	const stack: StackNode = {
		stack:
			place === 'header'
				? [{ ...label, margin: [ml, band.offset, mr, 0] }, rule]
				: [rule, { ...label, margin: [ml, 0, mr, band.offset] }]
	};
	return stack;
}

export function headerFor(
	currentPage: number,
	pageCount: number,
	pageSize: PageSize,
	t: Theme,
	meta: DocMeta,
	fonts: FontMap,
	warnings: Set<string>
): Content | undefined {
	return bandNode(t.header, 'header', currentPage, pageCount, pageSize, t, meta, fonts, warnings);
}

export function footerFor(
	currentPage: number,
	pageCount: number,
	pageSize: PageSize,
	t: Theme,
	meta: DocMeta,
	fonts: FontMap,
	warnings: Set<string>
): Content | undefined {
	return bandNode(t.footer, 'footer', currentPage, pageCount, pageSize, t, meta, fonts, warnings);
}
