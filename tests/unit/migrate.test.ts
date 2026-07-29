import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/lib/theme/migrate';
import { THEME_VERSION } from '../../src/lib/theme/schema';

describe('migrate', () => {
	it('stamps the current version onto a versionless object', () => {
		expect(migrate({ name: 'x' })).toEqual({ name: 'x', version: THEME_VERSION });
	});

	it('treats a missing version as 1', () => {
		const out = migrate({ name: 'x' });
		expect(out.version).toBe(THEME_VERSION);
	});

	it('treats a non-numeric version as 1', () => {
		expect(migrate({ version: 'two', name: 'x' }).version).toBe(THEME_VERSION);
	});

	it('clamps a version from the future rather than throwing', () => {
		const out = migrate({ version: 9999, name: 'x', unknownFuture: true });
		expect(out.version).toBe(THEME_VERSION);
		expect(out.unknownFuture).toBe(true);
	});

	it('passes a current-version theme through unchanged apart from version', () => {
		const input = { version: THEME_VERSION, name: 'keep', page: { size: 'A5' } };
		expect(migrate(input)).toEqual(input);
	});

	it.each([null, undefined, 42, 'theme', [1, 2, 3], true])('degrades non-objects (%p)', (bad) => {
		expect(migrate(bad)).toEqual({ version: THEME_VERSION });
	});

	it('does not mutate its input', () => {
		const input = { version: 1, name: 'x' };
		migrate(input);
		expect(input).toEqual({ version: 1, name: 'x' });
	});
});
