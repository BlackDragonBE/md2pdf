import { browser } from '$app/environment';
import { readText, writeText } from './persist';

export type Appearance = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

const KEY = 'md2pdf:appearance';
const QUERY = '(prefers-color-scheme: dark)';

function isAppearance(value: string): value is Appearance {
	return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * App chrome only — the PDF has its own theme and is unaffected.
 *
 * The resolved value is mirrored onto <html data-theme> so the stylesheet can
 * key off one attribute instead of duplicating every rule under a media query.
 */
class AppearanceStore {
	#stored = readText(KEY, 'system');
	preference = $state<Appearance>(isAppearance(this.#stored) ? this.#stored : 'system');
	/** Tracks the OS setting so "system" follows it live. */
	#systemDark = $state(browser ? window.matchMedia(QUERY).matches : false);

	readonly resolved = $derived<Resolved>(
		this.preference === 'system' ? (this.#systemDark ? 'dark' : 'light') : this.preference
	);

	constructor() {
		if (!browser) return;
		const media = window.matchMedia(QUERY);
		media.addEventListener('change', (e) => (this.#systemDark = e.matches));
	}

	set(preference: Appearance): void {
		this.preference = preference;
		writeText(KEY, preference);
	}

	/** Applied to <html> so the very first paint is already correct. */
	apply(): void {
		if (!browser) return;
		document.documentElement.dataset.theme = this.resolved;
		document.documentElement.style.colorScheme = this.resolved;
	}
}

export const appearance = new AppearanceStore();
