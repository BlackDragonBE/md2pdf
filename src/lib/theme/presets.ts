import manuscript from './presets/manuscript.json';
import slateDraft from './presets/slate-draft.json';
import technicalReport from './presets/technical-report.json';
import wideDeck from './presets/wide-deck.json';

export interface Preset {
	name: string;
	/** Partial theme JSON; `importTheme` deep-merges it over DEFAULT_THEME (§5.2). */
	theme: unknown;
}

export const PRESETS: Preset[] = [
	{ name: 'Default', theme: { version: 1, name: 'Default' } },
	{ name: technicalReport.name, theme: technicalReport },
	{ name: manuscript.name, theme: manuscript },
	{ name: slateDraft.name, theme: slateDraft },
	{ name: wideDeck.name, theme: wideDeck }
];
