import type { FontRole, FontSlotT, FontSourceT, Theme } from '../theme/schema';
import { loadBuiltinFaces } from './builtin';
import { loadGoogleFaces } from './google';
import { loadUploadFaces } from './upload';
import { familyKey, type ResolvedFont } from './types';

export interface FontResolution {
	/** family key → resolved faces, deduplicated across the three slots. */
	fonts: ResolvedFont[];
	/** Font role → family key, for the pdfmake styles dictionary. */
	roles: Record<FontRole, string>;
	warnings: string[];
	/** Slots that fell back, so the UI can show an explicit unavailable state (§7.4). */
	failed: { role: FontRole; source: FontSourceT; reason: string }[];
}

async function loadSource(source: FontSourceT, warnings: string[]): Promise<ResolvedFont> {
	switch (source.kind) {
		case 'builtin':
			return {
				family: familyKey(source),
				faces: await loadBuiltinFaces(source.id, warnings),
				warnings
			};
		case 'upload':
			return {
				family: familyKey(source),
				faces: await loadUploadFaces(source.hash, source.family, warnings),
				warnings
			};
		case 'google': {
			const { faces } = await loadGoogleFaces(source.family, source.weights, warnings);
			return { family: familyKey(source), faces, warnings };
		}
	}
}

/** One slot: try the source, then `slot.fallback`, never silently succeed. */
export async function resolveSlot(
	slot: FontSlotT,
	warnings: string[]
): Promise<{ font: ResolvedFont; failure: string | null }> {
	// Warnings from the attempt are only kept if the attempt succeeds. A family
	// that failed outright must not also report "no italics face available" —
	// that reads as if it partly worked.
	const attemptWarnings: string[] = [];
	try {
		const font = await loadSource(slot.source, attemptWarnings);
		warnings.push(...attemptWarnings);
		return { font, failure: null };
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		const fallback: FontSourceT = { kind: 'builtin', id: slot.fallback };
		const font = await loadSource(fallback, warnings);
		return { font, failure: reason };
	}
}

/**
 * Resolve all three slots. Slots sharing a source resolve once — the same
 * family key is registered a single time in the pdfmake dictionary.
 */
export async function resolveFonts(theme: Theme): Promise<FontResolution> {
	const roles = ['body', 'heading', 'mono'] as const;
	const warnings: string[] = [];
	const failed: FontResolution['failed'] = [];
	const byFamily = new Map<string, ResolvedFont>();
	const roleMap = {} as Record<FontRole, string>;

	for (const role of roles) {
		const slot = theme.fonts[role];
		const key = familyKey(slot.source);
		if (byFamily.has(key)) {
			roleMap[role] = key;
			continue;
		}
		const slotWarnings: string[] = [];
		const { font, failure } = await resolveSlot(slot, slotWarnings);
		if (failure) {
			const reason = failure.replace(/\.$/, '');
			failed.push({ role, source: slot.source, reason });
			warnings.push(`${role} font unavailable — ${reason}. Using ${slot.fallback}.`);
		}
		warnings.push(...slotWarnings);
		byFamily.set(font.family, font);
		roleMap[role] = font.family;
	}

	return { fonts: [...byFamily.values()], roles: roleMap, warnings, failed };
}
