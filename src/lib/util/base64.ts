/**
 * `String.fromCharCode.apply(null, hugeArray)` exceeds the argument limit on
 * multi-megabyte fonts, so everything here is chunked (§7.5, pitfall 9).
 */
const CHUNK = 0x2000; // 8 KB

export function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(s);
}

export function bufferToBase64(buf: ArrayBuffer): string {
	return bytesToBase64(new Uint8Array(buf));
}

export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Split `data:image/png;base64,AAAA` into its MIME type and raw bytes. */
export function dataUriToBytes(uri: string): { mime: string; bytes: Uint8Array } {
	const comma = uri.indexOf(',');
	if (comma < 0) return { mime: '', bytes: new Uint8Array(0) };
	const head = uri.slice(0, comma);
	const mime = /^data:([^;,]*)/.exec(head)?.[1] ?? '';
	const payload = uri.slice(comma + 1);
	if (!head.includes(';base64')) {
		return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
	}
	return { mime, bytes: base64ToBytes(payload) };
}

export function bytesToDataUri(mime: string, bytes: Uint8Array): string {
	return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
