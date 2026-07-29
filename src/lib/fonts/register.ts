import { bufferToBase64 } from '../util/base64';
import type { FontDictionary, Vfs } from '../pdf/pdfmake-types';
import { FACE_KEYS, type ResolvedFont } from './types';

export interface RegisteredFonts {
	vfs: Vfs; // filename → base64
	fonts: FontDictionary; // family → face → filename
}

/**
 * Both structures are passed to `createPdf` as arguments. `pdfMake.vfs` and
 * `pdfMake.fonts` are never mutated: the worker is long-lived, and stale
 * globals bleed fonts across theme switches (§7.5).
 */
export function buildVfs(fonts: ResolvedFont[]): RegisteredFonts {
	const vfs: Vfs = {};
	const dictionary: FontDictionary = {};

	// Aliased faces share one ArrayBuffer; encode and store each buffer once.
	const encoded = new Map<ArrayBuffer, string>();

	for (const font of fonts) {
		const faces = {} as FontDictionary[string];
		for (const face of FACE_KEYS) {
			const buffer = font.faces[face];
			let filename = encoded.get(buffer);
			if (!filename) {
				filename = `${font.family}-${face}.ttf`;
				vfs[filename] = bufferToBase64(buffer);
				encoded.set(buffer, filename);
			}
			faces[face] = filename;
		}
		dictionary[font.family] = faces;
	}

	return { vfs, fonts: dictionary };
}
