import { expect, test, type Download, type Page } from '@playwright/test';

async function downloadBytes(download: Download): Promise<Buffer> {
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

/** Parse the downloaded PDF in Node with pdf.js, the same way the golden tests do. */
async function readPdf(bytes: Buffer): Promise<{ pageCount: number; pages: string[] }> {
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true })
		.promise;
	const pages: string[] = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		pages.push((content.items as { str: string }[]).map((it) => it.str).join(''));
		page.cleanup();
	}
	const pageCount = doc.numPages;
	await doc.destroy();
	return { pageCount, pages };
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

test('a theme change reaches the PDF', async ({ page }) => {
	await setSource(page, '# Heading\n\nBody paragraph.');
	// Pin the zoom: auto-fit would otherwise zoom in on the narrower page and
	// keep the rendered width almost unchanged, hiding the size change.
	await page.locator('.zoom input').fill('0.5');
	await page.waitForTimeout(2000);
	const widthBefore = await page.locator('.page').first().evaluate((el) => el.clientWidth);

	const pageSection = await openSection(page, 'Page');
	await afterRender(page, async () => {
		await pageSection.locator('select').first().selectOption('A5');
	});

	const widthAfter = await page.locator('.page').first().evaluate((el) => el.clientWidth);
	expect(widthAfter).toBeLessThan(widthBefore);
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
	expect(parsed.version).toBe(1);
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
	await expect(page.locator('tbody tr')).toHaveCount(12);
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

		// Only a window of pages is rasterised, never all of them.
		await expect(page.locator('.page canvas')).toHaveCount(3, { timeout: 20_000 });

		await page.locator('.viewport').evaluate((el) => {
			el.scrollTop = Math.round(el.scrollHeight * 0.5);
			el.dispatchEvent(new Event('scroll'));
		});

		await expect(page.locator('.status')).not.toHaveText(`page 1 / ${pageCount}`);
		// Still a bounded window after scrolling, and still showing something.
		const canvases = await page.locator('.page canvas').count();
		expect(canvases).toBeGreaterThan(0);
		expect(canvases).toBeLessThanOrEqual(6);
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

		await page.getByRole('button', { name: 'Hide editor' }).click();
		await expect(page.locator('.editor-pane')).toHaveCount(0);
		await expect(page.locator('.splitter')).toHaveCount(0);

		const previewAfter = await page
			.locator('.preview-pane')
			.evaluate((el) => el.getBoundingClientRect().width);
		expect(previewAfter).toBeGreaterThan(previewBefore);

		await page.getByRole('button', { name: 'Show editor' }).click();
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
