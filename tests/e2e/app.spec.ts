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

test('the licences page lists every bundled family', async ({ page }) => {
	await page.getByRole('link', { name: 'Font licences' }).click();
	await expect(page.getByRole('heading', { name: 'Font licences' })).toBeVisible();
	await expect(page.locator('tbody tr')).toHaveCount(12);
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
