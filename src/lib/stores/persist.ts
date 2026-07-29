import { browser } from '$app/environment';

/** localStorage caps at ~5 MB and binaries belong in IndexedDB (§10). */
export function readJson<T>(key: string, fallback: T): T {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export function writeJson(key: string, value: unknown): boolean {
	if (!browser) return false;
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// QuotaExceededError: the caller decides whether that is worth surfacing.
		return false;
	}
}

export function readText(key: string, fallback: string): string {
	if (!browser) return fallback;
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeText(key: string, value: string): boolean {
	if (!browser) return false;
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export const KEY_DOC = 'md2pdf:doc';
export const KEY_META = 'md2pdf:meta';
export const KEY_THEME = 'md2pdf:theme';
export const KEY_RECENT = 'md2pdf:recentThemes';
