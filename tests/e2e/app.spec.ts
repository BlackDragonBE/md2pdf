import { expect, test, type Download, type Page } from '@playwright/test';
import { THEME_VERSION } from '../../src/lib/theme/schema';

async function downloadBytes(download: Download): Promise<Buffer> {
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

/** Parse the downloaded PDF in Node with pdf.js, the same way the golden tests do. */
async function readPdf(
	bytes: Buffer
): Promise<{ pageCount: number; pages: string[]; sizes: { width: number; height: number }[] }> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true })
		.promise;
	const pages: string[] = [];
	const sizes: { width: number; height: number }[] = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		pages.push((content.items as { str: string }[]).map((it) => it.str).join(''));
		const viewport = page.getViewport({ scale: 1 });
		sizes.push({ width: Math.round(viewport.width), height: Math.round(viewport.height) });
		page.cleanup();
	}
	const pageCount = doc.numPages;
	await doc.destroy();
	return { pageCount, pages, sizes };
}

async function renderId(page: Page): Promise<number> {
	return Number(await page.locator('.state').getAttribute('data-render'));
}

async function settled(page: Page) {
	await expect(page.locator('.state')).not.toHaveText(/generating/, { timeout: 40_000 });
	await expect(page.locator('.page').first()).toBeVisible({ timeout: 40_000 });
}

/**
 * Run an action and wait for the render it triggers to actually commit.
 *
 * Waiting only for "not generating" is a trap: input is debounced by 400 ms, so
 * the state is still `ready` from the *previous* render and every assertion
 * lands on stale bytes.
 */
async function afterRender(page: Page, action: () => Promise<void>) {
	const before = await renderId(page);
	await action();
	await expect
		.poll(() => renderId(page), { timeout: 40_000 })
		.toBeGreaterThan(before);
	await settled(page);
}

async function setSource(page: Page, markdown: string) {
	await afterRender(page, async () => {
		await page.locator('textarea.editor').fill(markdown);
	});
}

async function download(page: Page): Promise<Buffer> {
	const [event] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PDF' }).click()
	]);
	expect(event.suggestedFilename()).toMatch(/\.pdf$/);
	return downloadBytes(event);
}

function section(page: Page, title: string) {
	return page.locator(`details:has(> summary:text-is("${title}"))`);
}

async function openSection(page: Page, title: string) {
	const details = section(page, title);
	if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
		await details.locator('> summary').click();
	}
	return details;
}

test.beforeEach(async ({ page }) => {
	// Cleared once, on the first load — an addInitScript would wipe storage again
	// on reload, which is exactly what the persistence test needs to survive.
	await page.goto('/');
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				localStorage.clear();
				const request = indexedDB.deleteDatabase('md2pdf');
				request.onsuccess = request.onerror = request.onblocked = () => resolve();
			})
	);
	await page.reload();
	await settled(page);
});

test('cold load renders the sample document with no warnings', async ({ page }) => {
	await expect(page.locator('.page')).toHaveCount(3);
	await expect(page.locator('.page canvas')).toHaveCount(3);
	await expect(page.locator('.state')).toHaveText('3 pages');
	await expect(page.locator('.banner')).toHaveCount(0);
});

test('generation runs in a worker, not on the main thread', async ({ page }) => {
	// The fallback path shows this banner; its absence is the assertion.
	await expect(page.getByText('could not start')).toHaveCount(0);
});

test('typing re-renders the preview', async ({ page }) => {
	await setSource(page, '# Only heading\n\nJust one page.');
	await expect(page.locator('.page')).toHaveCount(1);
	await expect(page.locator('.state')).toHaveText('1 page');
});

test('preview and download are the same document', async ({ page }) => {
	await setSource(page, '# Alpha\n\nFirst page.\n\n\\pagebreak\n\n# Bravo\n\nSecond page.');
	await expect(page.locator('.page')).toHaveCount(2);

	const bytes = await download(page);
	expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

	const pdf = await readPdf(bytes);
	expect(pdf.pageCount).toBe(await page.locator('.page').count());
	expect(pdf.pages[0]).toContain('Alpha');
	expect(pdf.pages[1]).toContain('Bravo');
	expect(pdf.pages[1]).not.toContain('First page');
});

test('downloading twice yields identical bytes and never regenerates', async ({ page }) => {
	const first = await download(page);
	await expect(page.locator('.state')).toHaveText('3 pages');
	const second = await download(page);
	expect(second.equals(first)).toBe(true);
});

test('the downloaded PDF is searchable text with embedded fonts, not a raster', async ({ page }) => {
	await setSource(page, '# Searchable heading\n\nA sentence to find.');
	const bytes = await download(page);

	expect(bytes.includes(Buffer.from('/FontFile2'))).toBe(true);
	expect(bytes.includes(Buffer.from('/Subtype /Image'))).toBe(false);

	const pdf = await readPdf(bytes);
	expect(pdf.pages[0]).toContain('Searchable heading');
	expect(pdf.pages[0]).toContain('A sentence to find.');
});

test('the page-break marker splits pages and stays literal inside a fence', async ({ page }) => {
	await setSource(
		page,
		['# One', '', '```', '\\pagebreak', '```', '', '\\pagebreak', '', '# Two'].join('\n')
	);
	await expect(page.locator('.page')).toHaveCount(2);

	const pdf = await readPdf(await download(page));
	expect(pdf.pageCount).toBe(2);
	expect(pdf.pages[0]).toContain('\\pagebreak'); // the fenced copy, rendered literally
	expect(pdf.pages[1]).toContain('Two');
});

/**
 * Read the page size out of the PDF, not the rendered width of `.page`.
 *
 * The DOM width was a proxy for "the theme reached the PDF" and a bad one: it
 * only holds while the zoom stays pinned, so the test needed `fill('0.5')` plus
 * a two-second sleep, and auto-fit re-running on the narrower page put the
 * width back where it started and failed the assertion under load.
 */
test('a theme change reaches the PDF', async ({ page }) => {
	await setSource(page, '# Heading\n\nBody paragraph.');
	const before = await readPdf(await download(page));
	expect(before.sizes[0]).toEqual({ width: 595, height: 842 }); // A4

	const pageSection = await openSection(page, 'Page');
	await afterRender(page, async () => {
		await pageSection.locator('select').first().selectOption('A5');
	});

	const after = await readPdf(await download(page));
	expect(after.sizes[0]).toEqual({ width: 420, height: 595 }); // A5
});

test('enabling the watermark puts it on every page', async ({ page }) => {
	await setSource(page, 'one\n\n\\pagebreak\n\ntwo');
	await expect(page.locator('.page')).toHaveCount(2);

	const watermark = await openSection(page, 'Watermark');
	await afterRender(page, async () => {
		await watermark.locator('input[type=checkbox]').first().check();
	});

	const pdf = await readPdf(await download(page));
	expect(pdf.pageCount).toBe(2);
	for (const text of pdf.pages) expect(text).toContain('DRAFT');
});

test('a cover page numbers the content pages from one', async ({ page }) => {
	await setSource(page, 'body one\n\n\\pagebreak\n\nbody two');

	const cover = await openSection(page, 'Cover page');
	await afterRender(page, async () => {
		await cover.locator('input[type=checkbox]').first().check();
	});

	await expect(page.locator('.page')).toHaveCount(3);
	const pdf = await readPdf(await download(page));
	expect(pdf.pageCount).toBe(3);
	expect(pdf.pages[0]).not.toMatch(/\d+ \/ \d+/); // no footer on the cover
	expect(pdf.pages[1]).toContain('1 / 2');
	expect(pdf.pages[2]).toContain('2 / 2');
});

test('exporting a theme produces importable JSON', async ({ page }) => {
	const [event] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export' }).click()
	]);
	expect(event.suggestedFilename()).toMatch(/\.theme\.json$/);

	const parsed = JSON.parse((await downloadBytes(event)).toString('utf8')) as Record<
		string,
		unknown
	>;
	expect(parsed.version).toBe(THEME_VERSION);
	expect(parsed).toHaveProperty('elements');
	expect(parsed).toHaveProperty('fonts');
});

test('applying a preset changes the document without warnings', async ({ page }) => {
	const presets = await openSection(page, 'Presets');
	await afterRender(page, async () => {
		await presets.getByRole('button', { name: 'Technical Report' }).click();
	});

	await expect(page.locator('.warnings')).toHaveCount(0);
	const pdf = await readPdf(await download(page));
	expect(pdf.pageCount).toBeGreaterThanOrEqual(3); // the preset adds a cover
});

test('the About page describes the project and lists every bundled family', async ({ page }) => {
	await expect(page).toHaveTitle('md2pdf');

	await page.getByRole('link', { name: 'About' }).click();
	await expect(page.getByRole('heading', { name: 'About md2pdf' })).toBeVisible();
	// Twelve text families plus Noto Emoji, which is bundled and so must be
	// attributed here even though it is never a selectable font slot.
	await expect(page.locator('tbody tr')).toHaveCount(13);
	await expect(page.getByRole('link', { name: 'OFL-1.1' }).first()).toBeVisible();
	await expect(page.getByText('entirely inside your browser')).toBeVisible();
	await expect(page).toHaveTitle(/about/);

	// Navigating back must restore the title, not leave the tab on the About one.
	await page.getByRole('link', { name: 'back to the editor' }).click();
	await expect(page).toHaveTitle('md2pdf');
});

test('reloading restores the document and fetches no font bytes', async ({ page }) => {
	await setSource(page, '# Persisted\n\nThis text must survive a reload.');
	// The document store debounces its localStorage write by a second.
	await page.waitForTimeout(1500);

	await page.reload();
	await settled(page);

	await expect(page.locator('textarea.editor')).toHaveValue(/Persisted/);
	const ttfRequests = await page.evaluate(
		() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.ttf')).length
	);
	expect(ttfRequests).toBe(0);
});

/** A long document, so every pane genuinely overflows. */
const LONG_DOC = Array.from(
	{ length: 60 },
	(_, i) => `## Section ${i}\n\n${'Filler text for the scroll tests. '.repeat(12)}`
).join('\n\n');

async function metrics(page: Page, selector: string) {
	return page.locator(selector).evaluate((el) => ({
		clientHeight: el.clientHeight,
		scrollHeight: el.scrollHeight,
		clientWidth: el.clientWidth,
		scrollWidth: el.scrollWidth,
		scrollTop: el.scrollTop
	}));
}

test.describe('scrolling', () => {
	/**
	 * Grid and flex items default to `min-height: auto`, so a pane without an
	 * explicit `min-height: 0` grows to its content height, overflows its track,
	 * and no descendant ever becomes a scroll container. That made the editor,
	 * the preview and the theme panel all unscrollable at once.
	 */
	test('every pane is a real scroll container', async ({ page }) => {
		await setSource(page, LONG_DOC);

		for (const selector of ['.viewport', 'textarea.editor', '.panel']) {
			const box = await metrics(page, selector);
			expect(box.scrollHeight, `${selector} does not overflow`).toBeGreaterThan(box.clientHeight);
		}

		// Nothing may spill out of the viewport-height shell.
		const shell = await metrics(page, '.app');
		expect(shell.scrollHeight).toBeLessThanOrEqual(shell.clientHeight + 1);
		const documentScrolls = await page.evaluate(
			() => document.documentElement.scrollHeight > window.innerHeight + 1
		);
		expect(documentScrolls).toBe(false);
	});

	test('the preview keeps its position across a re-render', async ({ page }) => {
		await setSource(page, LONG_DOC);

		const target = await page
			.locator('.viewport')
			.evaluate((el) => {
				el.scrollTop = Math.round(el.scrollHeight * 0.5);
				return el.scrollTop;
			});
		expect(target).toBeGreaterThan(0);

		// The page indicator updates from the scroll event, so wait for it to
		// catch up before capturing — otherwise the "before" value is stale.
		await expect(page.locator('.status')).not.toHaveText(/^page 1 /);
		const pageBefore = await page.locator('.status').textContent();

		await afterRender(page, async () => {
			await page.locator('textarea.editor').fill(`${LONG_DOC}\n\nAppended paragraph.`);
		});

		const after = await metrics(page, '.viewport');
		expect(after.scrollTop, 'snapped back to the top').toBeGreaterThan(0);
		expect(Math.abs(after.scrollTop - target)).toBeLessThan(120);
		expect(await page.locator('.status').textContent()).toBe(pageBefore);
	});

	test('the preview scrolls with the keyboard', async ({ page }) => {
		await setSource(page, LONG_DOC);

		await page.locator('.viewport').focus();
		await expect(page.locator('.viewport')).toBeFocused();

		await page.keyboard.press('PageDown');
		await page.waitForTimeout(300);
		const afterPageDown = await metrics(page, '.viewport');
		expect(afterPageDown.scrollTop).toBeGreaterThan(0);

		await page.keyboard.press('End');
		await page.waitForTimeout(300);
		const afterEnd = await metrics(page, '.viewport');
		expect(afterEnd.scrollTop).toBeGreaterThan(afterPageDown.scrollTop);
	});

	test('scrolling a long document rasterises pages as they come into view', async ({ page }) => {
		// Past the 20-page virtualisation threshold.
		await setSource(
			page,
			Array.from({ length: 200 }, (_, i) => `## Section ${i}\n\n${'Filler. '.repeat(30)}`).join(
				'\n\n'
			)
		);
		const pageCount = await page.locator('.page').count();
		expect(pageCount).toBeGreaterThan(20);

		/**
		 * A bounded window, never the whole document. `shouldRender` keeps
		 * `visiblePage ± NEIGHBOURHOOD` (preview/renderer.ts), so the window is at
		 * most 2 × 2 + 1 pages.
		 *
		 * The old assertion was `toHaveCount(3)`, which is the window only while
		 * page 1 is the visible one. `setSource` fills the textarea and leaves it
		 * scrolled to the bottom, so scroll sync can move the preview before this
		 * runs and the settled count is legitimately 5. Bound it instead of
		 * pinning it, and poll so a mid-swap transient does not decide the result.
		 */
		const WINDOW = 5;
		const windowed = async () => {
			const n = await page.locator('.page canvas').count();
			return n > 0 && n <= WINDOW;
		};
		await expect.poll(windowed, { timeout: 20_000 }).toBe(true);
		expect(await page.locator('.page canvas').count()).toBeLessThan(pageCount);

		await page.locator('.viewport').evaluate((el) => {
			el.scrollTop = Math.round(el.scrollHeight * 0.5);
			el.dispatchEvent(new Event('scroll'));
		});

		await expect(page.locator('.status')).not.toHaveText(`page 1 / ${pageCount}`);
		// Still a bounded window after scrolling, and still showing something.
		await expect.poll(windowed, { timeout: 20_000 }).toBe(true);
	});

	/**
	 * `align-items: center` on a scroll container pushes overflow past both
	 * edges, and only the right-hand overflow is reachable — at 200% zoom the
	 * left of the page was cut off with no way to scroll to it.
	 */
	test('a zoomed page is reachable edge to edge', async ({ page }) => {
		await setSource(page, '# Zoom\n\nBody text.');
		await page.locator('.zoom input').fill('2');
		await page.waitForTimeout(2500);

		const viewport = await metrics(page, '.viewport');
		const pageWidth = await page.locator('.page').first().evaluate((el) => el.clientWidth);

		expect(pageWidth).toBeGreaterThan(viewport.clientWidth);
		expect(viewport.scrollWidth).toBeGreaterThanOrEqual(pageWidth);

		// At scrollLeft 0 the left edge of the page must be inside the viewport.
		const leftOffset = await page.evaluate(() => {
			const view = document.querySelector('.viewport')!;
			view.scrollLeft = 0;
			const sheet = document.querySelector('.page')!;
			return Math.round(sheet.getBoundingClientRect().left - view.getBoundingClientRect().left);
		});
		expect(leftOffset).toBeGreaterThanOrEqual(0);
	});

	/** At 100% an A4 page is 595px, wider than the default pane. */
	test('opens at a zoom where the page fits, with no horizontal scrollbar', async ({ page }) => {
		// Fitting re-renders the preview without touching generation state, so
		// poll rather than assuming it has landed by the time the PDF is ready.
		await expect
			.poll(async () => {
				const box = await metrics(page, '.viewport');
				return box.scrollWidth - box.clientWidth;
			}, { timeout: 20_000 })
			.toBeLessThanOrEqual(1);

		const viewport = await metrics(page, '.viewport');
		const pageWidth = await page.locator('.page').first().evaluate((el) => el.clientWidth);
		expect(pageWidth).toBeLessThanOrEqual(viewport.clientWidth);
	});

	test('the Fit button restores a fitting zoom after manual zooming', async ({ page }) => {
		await page.locator('.zoom input').fill('2');
		await page.waitForTimeout(2500);
		let viewport = await metrics(page, '.viewport');
		expect(viewport.scrollWidth).toBeGreaterThan(viewport.clientWidth);

		await page.getByRole('button', { name: 'Fit' }).click();
		await page.waitForTimeout(2500);

		viewport = await metrics(page, '.viewport');
		expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
	});

	test('a page narrower than the pane stays centred without a scrollbar', async ({ page }) => {
		await setSource(page, '# Small\n\nBody text.');
		await page.locator('.zoom input').fill('0.4');
		await page.waitForTimeout(2500);

		const gaps = await page.evaluate(() => {
			const view = document.querySelector('.viewport')!.getBoundingClientRect();
			const sheet = document.querySelector('.page')!.getBoundingClientRect();
			return { left: Math.round(sheet.left - view.left), right: Math.round(view.right - sheet.right) };
		});
		expect(Math.abs(gaps.left - gaps.right)).toBeLessThanOrEqual(2);

		const viewport = await metrics(page, '.viewport');
		expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
	});

	test('the theme panel stays reachable on a narrow screen', async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 800 });
		const panel = page.locator('.panel');
		await expect(panel).toBeVisible();

		const box = await metrics(page, '.panel');
		expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);

		// The Theme button must actually do something, not just claim to.
		await page.getByRole('button', { name: 'Theme' }).click();
		await expect(panel).toBeHidden();
		await page.getByRole('button', { name: 'Theme' }).click();
		await expect(panel).toBeVisible();
	});

	test('stacks into one column on a phone-sized viewport', async ({ page }) => {
		await page.setViewportSize({ width: 640, height: 800 });
		await setSource(page, LONG_DOC);

		const shell = await metrics(page, '.app');
		expect(shell.scrollHeight).toBeLessThanOrEqual(shell.clientHeight + 1);

		for (const selector of ['.viewport', 'textarea.editor']) {
			const box = await metrics(page, selector);
			expect(box.clientHeight, `${selector} collapsed`).toBeGreaterThan(100);
			expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
		}
	});
});

test.describe('editor', () => {
	test('Tab indents and Shift+Tab outdents without leaving the field', async ({ page }) => {
		const editor = page.locator('textarea.editor');
		await editor.fill('alpha');
		await editor.click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Tab');
		await expect(editor).toHaveValue('\talpha');
		await expect(editor).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(editor).toHaveValue('alpha');
		await expect(editor).toBeFocused();
	});

	/** Rewriting the whole textarea value discards the browser's undo stack. */
	test('Tab does not destroy the undo history', async ({ page }) => {
		const editor = page.locator('textarea.editor');
		await editor.fill('');
		await editor.click();
		await page.keyboard.type('hello');
		await page.keyboard.press('Tab');
		await expect(editor).toHaveValue('hello\t');

		await page.keyboard.press('ControlOrMeta+z'); // undo the tab
		await page.keyboard.press('ControlOrMeta+z'); // undo the typing
		// Whatever the browser's undo granularity, it must be able to step back
		// past the Tab rather than being stuck at "hello\t".
		await expect(editor).not.toHaveValue('hello\t');
	});
});

test('the download filename follows the document title', async ({ page }) => {
	await setSource(page, '---\ntitle: Quarterly Report\n---\n\n# Body\n\ntext');
	const [withTitle] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PDF' }).click()
	]);
	expect(withTitle.suggestedFilename()).toBe('quarterly-report.pdf');

	await setSource(page, '# No front matter\n\njust text');
	const [withoutTitle] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PDF' }).click()
	]);
	expect(withoutTitle.suggestedFilename()).toMatch(/\.pdf$/);
});

test.describe('theme number fields', () => {
	/**
	 * Clamping on every keystroke made low numbers impossible to enter: in a
	 * field with min 4, typing "12" clamped the "1" to "4" and appended the "2".
	 */
	test('accept a value below the minimum while it is still being typed', async ({ page }) => {
		const elements = await openSection(page, 'Elements');
		const heading = elements.locator('details', { has: page.locator('summary', { hasText: 'Heading 1' }) }).first();
		if (!(await heading.evaluate((el) => (el as HTMLDetailsElement).open))) {
			await heading.locator('summary').click();
		}

		const size = heading.locator('input[type=number]').first();
		await size.click();
		await size.press('ControlOrMeta+a');
		await size.pressSequentially('12');
		await expect(size).toHaveValue('12');

		await size.blur();
		await expect(size).toHaveValue('12');
	});

	/**
	 * Editing a value re-renders the component, and re-applying `open={false}`
	 * collapsed the very panel being edited — silently taking focus with it, with
	 * no blur event, so every keystroke after the first went nowhere.
	 */
	test('keep the panel open and the field focused while typing', async ({ page }) => {
		const elements = await openSection(page, 'Elements');
		const heading = elements.locator('details', { has: page.locator('summary', { hasText: 'Heading 1' }) }).first();
		if (!(await heading.evaluate((el) => (el as HTMLDetailsElement).open))) {
			await heading.locator('summary').click();
		}

		const size = heading.locator('input[type=number]').first();
		await size.click();
		await size.press('ControlOrMeta+a');
		await size.pressSequentially('31');

		await expect(heading).toHaveAttribute('open', '');
		await expect(size).toBeFocused();
		await expect(size).toHaveValue('31');
	});

	test('clamp an out-of-range value once it settles', async ({ page }) => {
		const elements = await openSection(page, 'Elements');
		const heading = elements.locator('details', { has: page.locator('summary', { hasText: 'Heading 1' }) }).first();
		if (!(await heading.evaluate((el) => (el as HTMLDetailsElement).open))) {
			await heading.locator('summary').click();
		}
		const size = heading.locator('input[type=number]').first();
		await size.click();
		await size.press('ControlOrMeta+a');
		await size.pressSequentially('999');
		await size.blur();
		await expect(size).toHaveValue('96');
	});
});

test('installs as a PWA and precaches the app shell', async ({ page }) => {
	// The manifest link has to be in the prerendered HTML: `ssr = false` means a
	// <svelte:head> link would never reach the document an installer reads.
	const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
	expect(manifestHref).toBeTruthy();

	const manifest = await page.evaluate(async () => {
		const href = document.querySelector('link[rel=manifest]')!.getAttribute('href')!;
		const res = await fetch(new URL(href, location.href));
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	});
	expect(manifest.status).toBe(200);
	expect(manifest.body.name).toBe('md2pdf');
	expect(Array.isArray(manifest.body.icons)).toBe(true);

	// A worker that registers but whose precache never populates looks installed
	// and is not offline-capable — assert the cache actually filled.
	const sw = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		for (let i = 0; i < 40; i++) {
			const names = await caches.keys();
			const precache = names.find((n) => n.includes('precache'));
			if (precache) {
				const entries = await (await caches.open(precache)).keys();
				if (entries.length > 0) {
					return {
						scope: registration.scope,
						active: !!registration.active,
						cached: entries.length,
						cachedUrls: entries.map((r) => r.url)
					};
				}
			}
			await new Promise((r) => setTimeout(r, 250));
		}
		return { scope: registration.scope, active: !!registration.active, cached: 0, cachedUrls: [] };
	});

	expect(sw.active).toBe(true);
	expect(sw.cached).toBeGreaterThan(10);
	// The shell must be cached under the worker's own scope, not the domain root.
	expect(sw.cachedUrls.every((url) => url.startsWith(sw.scope))).toBe(true);
	// Cache keys carry a __WB_REVISION__ query, so compare on the path alone.
	const paths = sw.cachedUrls.map((url) => new URL(url).pathname);
	expect(paths).toContain(`${new URL(sw.scope).pathname}index.html`);
});

test('the service worker serves the app, not the domain root', async ({ page }) => {
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	// Second load goes through the worker; a fallback bound to the wrong URL
	// replaces the app with whatever lives at the site root.
	await page.reload();
	await settled(page);
	await expect(page).toHaveTitle('md2pdf');
	await expect(page.locator('.app')).toHaveCount(1);
	await expect(page.locator('.page').first()).toBeVisible();
});

test('a fast typist never sees a stale preview', async ({ page }) => {
	const editor = page.locator('textarea.editor');
	await afterRender(page, async () => {
		for (let i = 1; i <= 6; i++) {
			await editor.fill(`# Draft ${i}\n\n${'\\pagebreak\n\n'.repeat(i)}End.`);
			await page.waitForTimeout(120); // faster than the 400 ms debounce
		}
	});

	// Every superseded render must be discarded: what settles is the last thing
	// typed, not an earlier one that happened to finish later.
	await expect(page.locator('.page')).toHaveCount(7);
	const pdf = await readPdf(await download(page));
	expect(pdf.pages[0]).toContain('Draft 6');
	expect(pdf.pageCount).toBe(7);
});

/**
 * A broken image warns "paste the image to embed it instead", so pasting has to
 * actually work — otherwise the app's own guidance is a dead end.
 */
test('pasting an image embeds it in the document', async ({ page }) => {
	await setSource(page, '# Paste target\n\n');
	const editor = page.locator('textarea.editor');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');

	await editor.evaluate((el) => {
		// 1x1 red PNG, as a real File on a DataTransfer.
		const bytes = Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
			),
			(c) => c.charCodeAt(0)
		);
		const file = new File([bytes], 'dot.png', { type: 'image/png' });
		const data = new DataTransfer();
		data.items.add(file);
		el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});

	await expect(editor).toHaveValue(/!\[dot\]\(data:image\/png;base64,/);

	// And the pasted image must survive into the PDF rather than warn.
	await expect(page.locator('.state')).not.toHaveText(/generating/, { timeout: 40_000 });
	await expect(page.getByText('relative paths cannot be resolved')).toHaveCount(0);
});

test('theme fields are labelled for assistive technology', async ({ page }) => {
	await openSection(page, 'Page');

	// Every form control in the panel must have an accessible name.
	const unnamed = await page.locator('.panel').evaluate((panel) => {
		const controls = [...panel.querySelectorAll('input, select, textarea')];
		return controls
			.filter((control) => {
				if (control.getAttribute('aria-label')) return false;
				if (control.id && panel.querySelector(`label[for="${CSS.escape(control.id)}"]`)) return false;
				if (control.closest('label')) return false;
				return true;
			})
			.map((control) => `${control.tagName.toLowerCase()}[${control.getAttribute('type') ?? ''}]`);
	});
	expect(unnamed).toEqual([]);
});

test.describe('appearance', () => {
	async function theme(page: Page) {
		return page.evaluate(() => document.documentElement.dataset.theme);
	}

	test('switches between light, dark and system', async ({ page }) => {
		const select = page.locator('.appearance select');

		await select.selectOption('light');
		expect(await theme(page)).toBe('light');
		const lightBg = await page.evaluate(
			() => getComputedStyle(document.body).backgroundColor
		);

		await select.selectOption('dark');
		expect(await theme(page)).toBe('dark');
		const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

		expect(lightBg).not.toBe(darkBg);

		await select.selectOption('system');
		expect(['light', 'dark']).toContain(await theme(page));
	});

	test('survives a reload and paints without a flash of the wrong palette', async ({ page }) => {
		await page.locator('.appearance select').selectOption('light');
		await page.reload();

		// Set by the inline script in app.html, so it is already correct at first
		// paint rather than being corrected after hydration.
		expect(await theme(page)).toBe('light');
		await expect(page.locator('.appearance select')).toHaveValue('light');
		await settled(page);
	});

	test('follows the OS setting when set to system', async ({ page }) => {
		await page.locator('.appearance select').selectOption('system');

		await page.emulateMedia({ colorScheme: 'light' });
		await expect.poll(() => theme(page)).toBe('light');

		await page.emulateMedia({ colorScheme: 'dark' });
		await expect.poll(() => theme(page)).toBe('dark');
	});
});

test.describe('editor pane layout', () => {
	async function editorWidth(page: Page) {
		return page.locator('.editor-pane').evaluate((el) => el.getBoundingClientRect().width);
	}

	test('the splitter resizes the editor against the preview', async ({ page }) => {
		const before = await editorWidth(page);
		const splitter = page.locator('.splitter');
		const box = (await splitter.boundingBox())!;

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();

		const after = await editorWidth(page);
		expect(after).toBeLessThan(before - 80);

		// The preview keeps working at the new size.
		await expect(page.locator('.page').first()).toBeVisible();
	});

	test('the splitter resizes with the keyboard', async ({ page }) => {
		const before = await editorWidth(page);
		await page.locator('.splitter').focus();
		await expect(page.locator('.splitter')).toBeFocused();

		for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
		expect(await editorWidth(page)).toBeGreaterThan(before);

		for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
		expect(await editorWidth(page)).toBeLessThan(before);
	});

	test('the editor can be collapsed so the PDF gets the space', async ({ page }) => {
		const previewBefore = await page
			.locator('.preview-pane')
			.evaluate((el) => el.getBoundingClientRect().width);

		await page.getByRole('button', { name: 'Editor' }).click();
		await expect(page.locator('.editor-pane')).toHaveCount(0);
		await expect(page.locator('.splitter')).toHaveCount(0);

		const previewAfter = await page
			.locator('.preview-pane')
			.evaluate((el) => el.getBoundingClientRect().width);
		expect(previewAfter).toBeGreaterThan(previewBefore);

		await page.getByRole('button', { name: 'Editor' }).click();
		await expect(page.locator('textarea.editor')).toBeVisible();
	});

	test('the split survives a reload', async ({ page }) => {
		await page.locator('.splitter').focus();
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
		const width = await editorWidth(page);

		await page.reload();
		await settled(page);

		expect(Math.abs((await editorWidth(page)) - width)).toBeLessThan(12);
	});
});

test.describe('scroll sync', () => {
	/** Long enough that a source line maps somewhere well down the PDF. */
	const DOC = Array.from(
		{ length: 70 },
		(_, i) => `## Section ${i}\n\n${'Body text for section ' + i + '. '.repeat(10)}`
	).join('\n\n');

	async function offsets(page: Page) {
		return page.evaluate(() => ({
			editor: document.querySelector('textarea.editor')!.scrollTop,
			preview: document.querySelector('.viewport')!.scrollTop
		}));
	}

	test('scrolling the editor moves the preview', async ({ page }) => {
		await setSource(page, DOC);
		await expect(page.locator('.page').first()).toBeVisible();

		const before = await offsets(page);
		await page.locator('textarea.editor').evaluate((el) => {
			el.scrollTop = Math.round(el.scrollHeight * 0.6);
			el.dispatchEvent(new Event('scroll'));
		});

		await expect.poll(async () => (await offsets(page)).preview).toBeGreaterThan(before.preview + 50);
	});

	/** Fraction of the editor's scrollable range, so the assertion is positional. */
	async function editorFraction(page: Page) {
		return page.locator('textarea.editor').evaluate((el) => {
			const range = el.scrollHeight - el.clientHeight;
			return range <= 0 ? 0 : el.scrollTop / range;
		});
	}

	async function scrollPreviewTo(page: Page, fraction: number) {
		await page.locator('.viewport').evaluate((el, f) => {
			el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * f);
			el.dispatchEvent(new Event('scroll'));
		}, fraction);
	}

	test('scrolling the preview moves the editor to matching content', async ({ page }) => {
		await setSource(page, DOC);
		await expect(page.locator('.page').first()).toBeVisible();

		// Driving the preview to each end must take the editor to the same end.
		// `fill` leaves the textarea at the bottom, so asserting "it increased"
		// would depend on where the previous action happened to leave it.
		await scrollPreviewTo(page, 0);
		await expect.poll(() => editorFraction(page)).toBeLessThan(0.2);

		await scrollPreviewTo(page, 1);
		await expect.poll(() => editorFraction(page)).toBeGreaterThan(0.7);
	});

	/** Each pane echoing the other would ratchet both to the bottom. */
	test('the two panes do not chase each other', async ({ page }) => {
		await setSource(page, DOC);
		await page.locator('textarea.editor').evaluate((el) => {
			el.scrollTop = Math.round(el.scrollHeight * 0.4);
			el.dispatchEvent(new Event('scroll'));
		});
		await page.waitForTimeout(600);
		const settledOnce = await offsets(page);

		await page.waitForTimeout(900);
		const later = await offsets(page);

		expect(Math.abs(later.editor - settledOnce.editor)).toBeLessThan(8);
		expect(Math.abs(later.preview - settledOnce.preview)).toBeLessThan(8);
	});

	test('lands near the matching content, not merely proportionally', async ({ page }) => {
		// A tall block early on makes proportional mapping wrong; anchors do not care.
		const source = [
			'# Top',
			'',
			'```',
			...Array.from({ length: 80 }, (_, i) => `code line ${i}`),
			'```',
			'',
			...Array.from({ length: 30 }, (_, i) => `## Heading ${i}\n\ntext ${i}`)
		].join('\n');
		await setSource(page, source);

		// Scroll the editor to the very end.
		await page.locator('textarea.editor').evaluate((el) => {
			el.scrollTop = el.scrollHeight;
			el.dispatchEvent(new Event('scroll'));
		});
		await page.waitForTimeout(700);

		const preview = await metrics(page, '.viewport');
		const fraction = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
		expect(fraction).toBeGreaterThan(0.6);
	});

	test('can be turned off', async ({ page }) => {
		await setSource(page, DOC);
		await page.getByRole('button', { name: 'Sync' }).click();
		await expect(page.getByRole('button', { name: 'Sync' })).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		const before = await offsets(page);
		await page.locator('textarea.editor').evaluate((el) => {
			el.scrollTop = Math.round(el.scrollHeight * 0.7);
			el.dispatchEvent(new Event('scroll'));
		});
		await page.waitForTimeout(600);

		expect((await offsets(page)).preview).toBe(before.preview);
	});
});

test.describe('font cache invalidation', () => {
	/**
	 * The exact failure this guards: a previously cached font kept being used
	 * after the bundled files were rebuilt, so glyphs added to them never
	 * appeared for anyone who had already loaded the app.
	 */
	test('a stale cached face is replaced rather than reused', async ({ page }) => {
		// Plant a bogus entry under the pre-versioning key *and* under a wrong
		// version, then confirm neither is used.
		await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('md2pdf');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const store = db.transaction('fonts', 'readwrite').objectStore('fonts');
			store.put(new ArrayBuffer(8), 'builtin:jetbrains-mono:normal');
			store.put(new ArrayBuffer(8), 'builtin:jetbrains-mono:normal:deadbeef');
			await new Promise((r) => setTimeout(r, 100));
			db.close();
		});

		await page.reload();
		await settled(page);

		const keys = await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('md2pdf');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const store = db.transaction('fonts', 'readonly').objectStore('fonts');
			const all = await new Promise<IDBValidKey[]>((r) => {
				const q = store.getAllKeys();
				q.onsuccess = () => r(q.result);
			});
			db.close();
			return all.map(String);
		});

		// The unversioned and wrong-version entries are gone; a versioned one remains.
		expect(keys).not.toContain('builtin:jetbrains-mono:normal');
		expect(keys).not.toContain('builtin:jetbrains-mono:normal:deadbeef');
		expect(keys.some((k) => /^builtin:jetbrains-mono:normal:[0-9a-f]{8}$/.test(k))).toBe(true);
	});

	test('box-drawing characters survive into the PDF', async ({ page }) => {
		await setSource(
			page,
			['# Tree', '', '```', 'md2pdf/', '├── scripts/', '│   └── subset-fonts.md', '└── src/', '```'].join(
				'\n'
			)
		);

		const pdf = await readPdf(await download(page));
		expect(pdf.pages[0]).toContain('├──');
		expect(pdf.pages[0]).toContain('└──');
		expect(pdf.pages[0]).toContain('│');
	});
});

/**
 * The bundled families are Latin subsets and pdfmake binds one font per run, so
 * emoji were silently blank boxes. The emoji family is 845 KB, so it must load
 * only for a document that actually contains one.
 */
test.describe('emoji', () => {
	test('are fetched only when the document has them, then cached', async ({ page }) => {
		const emojiKeys = () =>
			page.evaluate(async () => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('md2pdf');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				const store = db.transaction('fonts', 'readonly').objectStore('fonts');
				const all = await new Promise<IDBValidKey[]>((r) => {
					const q = store.getAllKeys();
					q.onsuccess = () => r(q.result);
				});
				db.close();
				return all.map(String).filter((k) => k.includes('noto-emoji'));
			});

		await setSource(page, '# Plain heading\n\nNo emoji at all.');
		expect(await emojiKeys()).toHaveLength(0);

		await setSource(page, '# Heading \u{1F3CB}\uFE0F\n\nBody \u{1F4CA} text.');
		await expect.poll(emojiKeys).not.toHaveLength(0);

		// One entry, not four: all four faces point at the same file.
		expect(await emojiKeys()).toHaveLength(1);
	});

	test('reach the downloaded PDF alongside the text', async ({ page }) => {
		await setSource(
			page,
			'# Report \u{1F4CA}\n\nProgress \u{1F3AF} and \u2705 done.\n\n- bullet \u{1F525}'
		);
		const pdf = await readPdf(await download(page));
		expect(pdf.pages[0]).toContain('Report');
		expect(pdf.pages[0]).toContain('Progress');
		expect(pdf.pages[0]).toContain('done');
		expect(pdf.pages[0]).toContain('bullet');
	});
});

/**
 * The browser loads `pdfmake/build/pdfmake`; every golden test loads
 * `pdfmake/src/printer.js`. They are different copies of the code, so this is
 * the only test that can prove the inline-artwork patch reached the bundle.
 * Without it a bundle-only regression ships with a green Node suite.
 */
test('a mid-sentence image reaches the downloaded PDF', async ({ page }) => {
	const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQaztBEmIY1TCqYfhqAABrG3wQY1e8RAAAAABJRU5ErkJggg==';
	await setSource(page, `Before ![alt](${png}) after it.`);

	const bytes = await download(page);
	expect(bytes.includes(Buffer.from('/Subtype /Image'))).toBe(true);

	const pdf = await readPdf(bytes);
	expect(pdf.pages[0]).toContain('Before');
	expect(pdf.pages[0]).toContain('after');
	expect(pdf.pageCount).toBe(1);
	await expect(page.locator('.banner')).toHaveCount(0);
});

/**
 * A re-render restores the preview's scroll position, which fires `scroll`.
 * Treating that as the reader scrolling made every keystroke tug the editor
 * along and swallow the next real scroll.
 */
test('re-rendering does not drag the editor along', async ({ page }) => {
	await setSource(
		page,
		Array.from({ length: 70 }, (_, i) => `## Section ${i}\n\ntext ${i}`).join('\n\n')
	);

	await page.locator('textarea.editor').evaluate((el) => {
		el.scrollTop = Math.round(el.scrollHeight * 0.5);
		el.dispatchEvent(new Event('scroll'));
	});
	await page.waitForTimeout(700);
	const before = await page.locator('textarea.editor').evaluate((el) => el.scrollTop);

	// Type, forcing a full re-render and a scroll restoration in the preview.
	await afterRender(page, async () => {
		await page.locator('textarea.editor').evaluate((el) => {
			const field = el as HTMLTextAreaElement;
			field.value += '\n\nappended';
			field.dispatchEvent(new Event('input', { bubbles: true }));
		});
	});
	await page.waitForTimeout(700);

	const after = await page.locator('textarea.editor').evaluate((el) => el.scrollTop);
	expect(Math.abs(after - before)).toBeLessThan(40);
});
