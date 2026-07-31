import { cloneDefaultTheme } from '../theme/defaults';
import { exportTheme, importTheme, importThemeJson, type UploadedFontBytes } from '../theme/io';
import type { Theme } from '../theme/schema';
import { debounce } from '../util/debounce';
import { KEY_RECENT, KEY_THEME, readJson, writeJson } from './persist';

export interface RecentTheme {
	name: string;
	json: string;
}

const RECENT_LIMIT = 10;

function loadInitial(): { theme: Theme; warnings: string[] } {
	const raw = readJson<unknown>(KEY_THEME, null);
	if (raw === null) return { theme: cloneDefaultTheme(), warnings: [] };
	return importTheme(raw);
}

class ThemeStore {
	#initial = loadInitial();
	current = $state<Theme>(this.#initial.theme);
	warnings = $state<string[]>(this.#initial.warnings);
	recent = $state<RecentTheme[]>(readJson<RecentTheme[]>(KEY_RECENT, []));
	/** Set when persistence fails, usually a localStorage quota overflow (§10). */
	persistError = $state<string | null>(null);

	#save = debounce((theme: Theme) => {
		const ok = writeJson(KEY_THEME, theme);
		this.persistError = ok
			? null
			: 'Theme is too large for browser storage — embedded images above 256 KB are not persisted.';
	}, 400);

	/** Replace the whole theme; every panel edit funnels through here. */
	set(theme: Theme, warnings: string[] = []): void {
		this.current = theme;
		this.warnings = warnings;
		this.#save(theme);
	}

	/** Apply a mutation to a structural copy, so `$state` sees a new object. */
	update(mutate: (draft: Theme) => void): void {
		const draft = structuredClone($state.snapshot(this.current)) as Theme;
		mutate(draft);
		this.set(draft, this.warnings);
	}

	reset(): void {
		this.set(cloneDefaultTheme(), []);
	}

	loadJson(text: string): void {
		const { theme, warnings } = importThemeJson(text);
		this.set(theme, warnings);
		this.remember(theme);
	}

	loadObject(raw: unknown): void {
		const { theme, warnings } = importTheme(raw);
		this.set(theme, warnings);
		this.remember(theme);
	}

	remember(theme: Theme): void {
		const json = JSON.stringify(theme);
		const next = [{ name: theme.name, json }, ...this.recent.filter((r) => r.json !== json)].slice(
			0,
			RECENT_LIMIT
		);
		this.recent = next;
		writeJson(KEY_RECENT, next);
	}

	export(uploads: UploadedFontBytes[] = []) {
		const snapshot = structuredClone($state.snapshot(this.current)) as Theme;
		this.remember(snapshot);
		return exportTheme(snapshot, uploads);
	}

	snapshot(): Theme {
		return structuredClone($state.snapshot(this.current)) as Theme;
	}
}

export const themeStore = new ThemeStore();
