import { THEME_VERSION } from './schema';

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated *from*. Each entry must bump `version`.
 * Empty today, present deliberately: retrofitting this once themes are in
 * users' hands is not possible (§5.3).
 *
 * Example for the next bump:
 *   1: (t) => ({ ...t, version: 2, newField: 'default' }),
 */
const MIGRATIONS: Record<number, Migration> = {};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Bring an arbitrary parsed theme object up to THEME_VERSION.
 * Never throws — unusable input degrades to `{ version: THEME_VERSION }` and
 * the deep-merge in io.ts fills the rest from DEFAULT_THEME.
 */
export function migrate(raw: unknown): Record<string, unknown> {
	if (!isRecord(raw)) return { version: THEME_VERSION };

	let current: Record<string, unknown> = { ...raw };

	// An unknown or missing version is treated as 1 (§5.3).
	const declared = typeof current.version === 'number' ? current.version : 1;
	let version = Number.isInteger(declared) && declared >= 1 ? declared : 1;

	if (version > THEME_VERSION) {
		// A theme from the future. Keep the fields we understand, stamp it as
		// current, and let schema validation drop what it cannot handle.
		return { ...current, version: THEME_VERSION };
	}

	while (version < THEME_VERSION) {
		const step = MIGRATIONS[version];
		if (!step) {
			// Gap in the chain — cannot climb further. Stamp and let validation decide.
			return { ...current, version: THEME_VERSION };
		}
		current = step(current);
		const next = typeof current.version === 'number' ? current.version : version + 1;
		if (next <= version) {
			// A migration that fails to advance would loop forever.
			return { ...current, version: THEME_VERSION };
		}
		version = next;
	}

	current.version = THEME_VERSION;
	return current;
}
