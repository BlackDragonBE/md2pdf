import { describe, expect, it } from 'vitest';
import { hasVariationAxes } from '../../src/lib/fonts/google';
import { completeFaces, familyKey, type FaceBuffers } from '../../src/lib/fonts/types';
import { sniffFont } from '../../src/lib/fonts/upload';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT_DIR = join(import.meta.dirname, '..', '..', 'static', 'fonts');

function buf(byte: number): ArrayBuffer {
	return new Uint8Array([byte, byte, byte, byte]).buffer;
}

function tag(ascii: string): ArrayBuffer {
	return new Uint8Array([...ascii].map((c) => c.charCodeAt(0))).buffer;
}

/** The single rule that prevents the most common crash in the app (§7). */
describe('face aliasing', () => {
	it('fills all four faces from a lone regular', () => {
		const warnings: string[] = [];
		const faces = completeFaces({ normal: buf(1) }, 'Solo', warnings);
		expect(Object.keys(faces).sort()).toEqual(['bold', 'bolditalics', 'italics', 'normal']);
		expect(faces.bold).toBe(faces.normal);
		expect(faces.italics).toBe(faces.normal);
		expect(faces.bolditalics).toBe(faces.normal);
		expect(warnings).toHaveLength(3);
	});

	it('prefers bold over regular for bold-italic when italics are missing', () => {
		const bold = buf(2);
		const faces = completeFaces({ normal: buf(1), bold }, 'Half', []);
		expect(faces.bolditalics).toBe(bold);
	});

	it('prefers italics over regular for bold-italic when bold is missing', () => {
		const italics = buf(3);
		const faces = completeFaces({ normal: buf(1), italics }, 'Half', []);
		expect(faces.bolditalics).toBe(italics);
	});

	it('warns once per substituted face', () => {
		const warnings: string[] = [];
		completeFaces({ normal: buf(1), bold: buf(2) }, 'Two', warnings);
		expect(warnings.join(' ')).toMatch(/italic face missing/);
		expect(warnings.join(' ')).toMatch(/bold-italic face missing/);
	});

	it('adds no warnings when every face is real', () => {
		const warnings: string[] = [];
		const faces: Partial<FaceBuffers> = {
			normal: buf(1),
			bold: buf(2),
			italics: buf(3),
			bolditalics: buf(4)
		};
		completeFaces(faces, 'Full', warnings);
		expect(warnings).toEqual([]);
	});

	it('throws only when there is nothing at all to alias', () => {
		expect(() => completeFaces({}, 'Nothing', [])).toThrow(/no usable faces/);
	});
});

describe('familyKey', () => {
	it('namespaces by tier so two sources cannot collide', () => {
		expect(familyKey({ kind: 'builtin', id: 'inter' })).toBe('b_inter');
		expect(familyKey({ kind: 'upload', hash: 'abcdef0123456789', family: 'X' })).toBe(
			'u_abcdef012345'
		);
		expect(familyKey({ kind: 'google', family: 'Playfair Display', weights: [400] })).toBe(
			'g_PlayfairDisplay'
		);
	});
});

describe('upload magic-byte validation', () => {
	it('accepts TrueType', () => {
		expect(sniffFont(new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer)).toEqual({
			ok: true,
			format: 'ttf'
		});
	});

	it('accepts the "true" and "ttcf" tags', () => {
		expect(sniffFont(tag('true'))).toEqual({ ok: true, format: 'ttf' });
		expect(sniffFont(tag('ttcf'))).toEqual({ ok: true, format: 'ttf' });
	});

	it('accepts CFF/OpenType', () => {
		expect(sniffFont(tag('OTTO'))).toEqual({ ok: true, format: 'otf' });
	});

	it('rejects a renamed .woff2 with a message that points somewhere useful', () => {
		const result = sniffFont(tag('wOF2'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/WOFF\/WOFF2|Google Fonts/);
	});

	it('rejects .woff', () => {
		expect(sniffFont(tag('wOFF')).ok).toBe(false);
	});

	it('rejects arbitrary bytes', () => {
		expect(sniffFont(tag('%PDF')).ok).toBe(false);
		expect(sniffFont(new Uint8Array([1, 2]).buffer).ok).toBe(false);
	});

	it('accepts every bundled face', () => {
		const manifest = JSON.parse(readFileSync(join(FONT_DIR, 'manifest.json'), 'utf8')) as Record<
			string,
			{ files: Record<string, string> }
		>;
		for (const entry of Object.values(manifest)) {
			for (const path of Object.values(entry.files)) {
				const bytes = readFileSync(join(FONT_DIR, path));
				const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
				expect(sniffFont(ab as ArrayBuffer).ok, path).toBe(true);
			}
		}
	});
});

describe('variable font detection', () => {
	it('finds no fvar in any bundled face', () => {
		const manifest = JSON.parse(readFileSync(join(FONT_DIR, 'manifest.json'), 'utf8')) as Record<
			string,
			{ files: Record<string, string> }
		>;
		for (const entry of Object.values(manifest)) {
			for (const path of Object.values(entry.files)) {
				const bytes = readFileSync(join(FONT_DIR, path));
				const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
				expect(hasVariationAxes(ab as ArrayBuffer), path).toBe(false);
			}
		}
	});

	it('does not crash on truncated input', () => {
		expect(hasVariationAxes(new Uint8Array([0, 1, 0, 0]).buffer)).toBe(false);
		expect(hasVariationAxes(new ArrayBuffer(0))).toBe(false);
	});
});
