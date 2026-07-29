// Measures generation time against document size (DESIGN.md §16 item 5).
//
//   npx vite-node scripts/measure-ceiling.mjs
//
// Node-side, so it excludes worker transfer and pdf.js rasterisation. Treat the
// numbers as a floor for the browser, not a prediction of it.
import { extract, renderMarkdown } from '../tests/helpers/render.ts';

function doc(sections) {
	const parts = ['# Benchmark\n'];
	for (let i = 1; i <= sections; i++) {
		parts.push(`## Section ${i}\n`);
		parts.push('Body text that fills the page. '.repeat(18) + '\n');
		if (i % 5 === 0) parts.push('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n');
		if (i % 7 === 0) parts.push('```js\nconst x = ' + i + ';\n```\n');
	}
	return parts.join('\n');
}

const rows = [];
for (const sections of [30, 70, 150, 300, 600]) {
	const source = doc(sections);
	const started = performance.now();
	const { buffer } = await renderMarkdown(source);
	const generateMs = performance.now() - started;
	const { pageCount } = await extract(buffer);
	rows.push({
		pages: pageCount,
		generateMs: Math.round(generateMs),
		msPerPage: Math.round(generateMs / pageCount),
		sizeKb: Math.round(buffer.length / 1024)
	});
}
console.table(rows);
