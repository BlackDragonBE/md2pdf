import { getUpload, listUploads, putUpload, type UploadRecord } from './cache';
import { completeFaces, FACE_KEYS, type FaceBuffers, type FaceKey } from './types';

export type SniffResult =
	| { ok: true; format: 'ttf' | 'otf' }
	| { ok: false; reason: string };

/**
 * Validate magic bytes, not the file extension — a renamed .woff2 must be
 * rejected with a message, not accepted and then crash pdfkit (§7.3).
 */
export function sniffFont(buffer: ArrayBuffer): SniffResult {
	if (buffer.byteLength < 4) return { ok: false, reason: 'File is too small to be a font.' };
	const view = new DataView(buffer);
	const tag = view.getUint32(0, false);
	const ascii = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3)
	);

	if (tag === 0x00010000 || ascii === 'true' || ascii === 'ttcf') return { ok: true, format: 'ttf' };
	if (ascii === 'OTTO') return { ok: true, format: 'otf' };
	if (ascii === 'wOFF' || ascii === 'wOF2') {
		return {
			ok: false,
			reason:
				'WOFF/WOFF2 is a web-only format. Upload the .ttf or .otf, or use the Google Fonts tier.'
		};
	}
	return { ok: false, reason: 'Not a TrueType or OpenType font.' };
}

/** SHA-256 of the bytes, so the same font uploaded twice stores once (§7.3). */
export async function hashFont(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface StoredUpload {
	hash: string;
	family: string;
	face: FaceKey;
	name: string;
}

export async function storeUpload(
	file: File,
	family: string,
	face: FaceKey
): Promise<{ ok: true; upload: StoredUpload } | { ok: false; reason: string }> {
	const buffer = await file.arrayBuffer();
	const sniff = sniffFont(buffer);
	if (!sniff.ok) return { ok: false, reason: `${file.name}: ${sniff.reason}` };

	const hash = await hashFont(buffer);
	await putUpload(`${hash}:${face}`, { bytes: buffer, family, face, name: file.name });
	return { ok: true, upload: { hash, family, face, name: file.name } };
}

/** All faces uploaded under one family hash, keyed by face. */
export async function loadUploadFaces(
	hash: string,
	family: string,
	warnings: string[]
): Promise<FaceBuffers> {
	const partial: Partial<FaceBuffers> = {};
	await Promise.all(
		FACE_KEYS.map(async (face) => {
			const rec = await getUpload(`${hash}:${face}`);
			if (rec) partial[face] = rec.bytes;
		})
	);
	if (!partial.normal && !partial.bold && !partial.italics && !partial.bolditalics) {
		throw new Error(`Uploaded font "${family}" is no longer in this browser's storage.`);
	}
	return completeFaces(partial, family, warnings);
}

export interface UploadedFamily {
	hash: string;
	family: string;
	faces: Partial<Record<FaceKey, string>>;
}

/** Group stored uploads into families for the picker UI. */
export async function listUploadedFamilies(): Promise<UploadedFamily[]> {
	const rows = await listUploads();
	const byHash = new Map<string, UploadedFamily>();
	for (const { hash: key, record } of rows) {
		const [hash] = key.split(':');
		const entry = byHash.get(hash) ?? { hash, family: record.family, faces: {} };
		entry.faces[record.face as FaceKey] = record.name;
		byHash.set(hash, entry);
	}
	return [...byHash.values()];
}

export type { UploadRecord };
