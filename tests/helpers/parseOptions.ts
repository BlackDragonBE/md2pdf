import { parseOptionsFor, type ParseOptions } from '../../src/lib/markdown/parse';
import { DEFAULT_THEME } from '../../src/lib/theme/defaults';

/** Default parse options, with individual switches overridable per test. */
export function parseOpts(overrides: Partial<ParseOptions> = {}): ParseOptions {
	return { ...parseOptionsFor(DEFAULT_THEME), ...overrides };
}
