import type { DocMeta } from '../markdown/frontmatter';
import { debounce } from '../util/debounce';
import { KEY_DOC, KEY_META, readJson, readText, writeJson, writeText } from './persist';
import { SAMPLE_DOCUMENT } from './sample';

class DocStore {
	source = $state(readText(KEY_DOC, SAMPLE_DOCUMENT));
	/** Fallbacks for fields the document's front matter does not supply (§6.2). */
	meta = $state<Partial<DocMeta>>(
		readJson<Partial<DocMeta>>(KEY_META, { title: '', subtitle: '', author: '', date: '' })
	);

	#saveSource = debounce((value: string) => writeText(KEY_DOC, value), 1000);
	#saveMeta = debounce((value: Partial<DocMeta>) => writeJson(KEY_META, value), 1000);

	setSource(value: string): void {
		this.source = value;
		this.#saveSource(value);
	}

	setMeta(patch: Partial<DocMeta>): void {
		this.meta = { ...this.meta, ...patch };
		this.#saveMeta(this.meta);
	}

	reset(): void {
		this.setSource(SAMPLE_DOCUMENT);
	}
}

export const docStore = new DocStore();
