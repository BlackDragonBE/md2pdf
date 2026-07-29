import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'md2pdf';
const DB_VERSION = 1;

export const STORE_FONTS = 'fonts';
export const STORE_UPLOADS = 'uploads';
export const STORE_ASSETS = 'assets';

export interface UploadRecord {
	bytes: ArrayBuffer;
	family: string;
	face: string;
	name: string;
}

let dbPromise: Promise<IDBPDatabase> | undefined;

function db(): Promise<IDBPDatabase> {
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, DB_VERSION, {
			upgrade(database) {
				if (!database.objectStoreNames.contains(STORE_FONTS)) database.createObjectStore(STORE_FONTS);
				if (!database.objectStoreNames.contains(STORE_UPLOADS))
					database.createObjectStore(STORE_UPLOADS);
				if (!database.objectStoreNames.contains(STORE_ASSETS))
					database.createObjectStore(STORE_ASSETS);
			}
		});
	}
	return dbPromise;
}

/** IndexedDB is unavailable in some private-browsing modes; degrade, never throw. */
async function safe<T>(fn: (d: IDBPDatabase) => Promise<T>, fallback: T): Promise<T> {
	try {
		return await fn(await db());
	} catch {
		return fallback;
	}
}

export function getFont(key: string): Promise<ArrayBuffer | undefined> {
	return safe((d) => d.get(STORE_FONTS, key), undefined);
}

export function putFont(key: string, buffer: ArrayBuffer): Promise<void> {
	return safe(async (d) => {
		await d.put(STORE_FONTS, buffer, key);
	}, undefined);
}

/** Font cache keys, for pruning superseded versions. */
export function listFontKeys(): Promise<string[]> {
	return safe(async (d) => (await d.getAllKeys(STORE_FONTS)).map(String), []);
}

export function deleteFont(key: string): Promise<void> {
	return safe(async (d) => {
		await d.delete(STORE_FONTS, key);
	}, undefined);
}

export function getUpload(hash: string): Promise<UploadRecord | undefined> {
	return safe((d) => d.get(STORE_UPLOADS, hash), undefined);
}

export function putUpload(hash: string, record: UploadRecord): Promise<void> {
	return safe(async (d) => {
		await d.put(STORE_UPLOADS, record, hash);
	}, undefined);
}

export function listUploads(): Promise<{ hash: string; record: UploadRecord }[]> {
	return safe(async (d) => {
		const keys = await d.getAllKeys(STORE_UPLOADS);
		const values = await d.getAll(STORE_UPLOADS);
		return keys.map((k, i) => ({ hash: String(k), record: values[i] as UploadRecord }));
	}, []);
}

export function deleteUpload(hash: string): Promise<void> {
	return safe(async (d) => {
		await d.delete(STORE_UPLOADS, hash);
	}, undefined);
}

/** Binaries over 256 KB belong here, not in localStorage (§10). */
export function getAsset(key: string): Promise<string | undefined> {
	return safe((d) => d.get(STORE_ASSETS, key), undefined);
}

export function putAsset(key: string, dataUri: string): Promise<void> {
	return safe(async (d) => {
		await d.put(STORE_ASSETS, dataUri, key);
	}, undefined);
}
