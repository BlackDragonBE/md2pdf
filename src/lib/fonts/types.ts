import type { FontSourceT } from '../theme/schema';

export type FaceKey = 'normal' | 'bold' | 'italics' | 'bolditalics';
export type FaceBuffers = Record<FaceKey, ArrayBuffer>;

export const FACE_KEYS: FaceKey[] = ['normal', 'bold', 'italics', 'bolditalics'];

export interface ResolvedFont {
	/** Key used in the pdfMake font dictionary. */
	family: string;
	faces: FaceBuffers;
	warnings: string[];
}

export interface BuiltinFontEntry {
	name: string;
	category: 'sans' | 'serif' | 'mono' | 'display';
	license: string;
	url?: string;
	files: Record<FaceKey, string>;
}

export type BuiltinFontManifest = Record<string, BuiltinFontEntry>;

export type { FontSourceT };

/**
 * pdfmake throws the moment a document contains `*emphasis*` in a family with
 * no registered italics, so all four faces are always populated: a missing face
 * aliases to the nearest available one (§7).
 */
export function completeFaces(
	partial: Partial<FaceBuffers>,
	family: string,
	warnings: string[]
): FaceBuffers {
	const normal = partial.normal ?? partial.bold ?? partial.italics ?? partial.bolditalics;
	if (!normal) throw new Error(`Font "${family}" has no usable faces.`);

	const bold = partial.bold ?? normal;
	const italics = partial.italics ?? normal;
	const bolditalics = partial.bolditalics ?? partial.bold ?? partial.italics ?? normal;

	if (!partial.normal) warnings.push(`${family}: regular face missing — substituted.`);
	if (!partial.bold) warnings.push(`${family}: bold face missing — regular substituted.`);
	if (!partial.italics) warnings.push(`${family}: italic face missing — regular substituted.`);
	if (!partial.bolditalics) warnings.push(`${family}: bold-italic face missing — substituted.`);

	return { normal, bold, italics, bolditalics };
}

/** A stable, collision-free pdfmake family key for a theme font source. */
export function familyKey(source: FontSourceT): string {
	switch (source.kind) {
		case 'builtin':
			return `b_${source.id}`;
		case 'upload':
			return `u_${source.hash.slice(0, 12)}`;
		case 'google':
			return `g_${source.family.replace(/[^A-Za-z0-9]/g, '')}`;
	}
}
