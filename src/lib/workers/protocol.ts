import type Token from 'markdown-it/lib/token.mjs';
import type { DocMeta } from '../markdown/frontmatter';
import type { Anchor } from '../pdf/buildDocDefinition';
import type { ResolvedImage } from '../pdf/images';
import type { FontDictionary, Vfs } from '../pdf/pdfmake-types';
import type { FontRole, Theme } from '../theme/schema';

/**
 * The worker builds the document definition itself.
 *
 * §8 sketches posting a finished `TDocumentDefinitions`, but §12.1 requires
 * `background`, `header` and `footer` to be *functions* — those cannot be
 * structured-cloned across the worker boundary. So the token stream, theme and
 * pre-resolved images cross instead, and `buildDocDefinition` (which is
 * synchronous exactly so it can run here) is called worker-side.
 */
export interface RenderRequest {
	/** Monotonic generation token. Responses with a stale id are discarded (§8). */
	id: number;
	tokens: Token[];
	theme: Theme;
	meta: DocMeta;
	images: [string, ResolvedImage][];
	roles: Record<FontRole, string>;
	vfs: Vfs;
	fonts: FontDictionary;
}

export type RenderResponse =
	| {
			id: number;
			ok: true;
			buffer: ArrayBuffer;
			pageCount: number;
			warnings: string[];
			anchors: Anchor[];
	  }
	| { id: number; ok: false; error: string };
