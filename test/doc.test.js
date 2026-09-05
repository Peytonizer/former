import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadDocument } from '../src/doc.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name));

describe('loadDocument', () => {
  it('extracts geometry for an ordinary flat A4 document', async () => {
    const result = await loadDocument(fixture('flat-a4.pdf'));
    expect(result.ok).toBe(true);
    expect(result.pages).toHaveLength(2);
    for (const page of result.pages) {
      expect(page).toEqual({ x0: 0, y0: 0, w: 595, h: 842, rotate: 0, rotationRounded: false });
    }
  });

  it('reads /Rotate on each page of the rotated fixture', async () => {
    const result = await loadDocument(fixture('rotated.pdf'));
    expect(result.ok).toBe(true);
    expect(result.pages.map((p) => p.rotate)).toEqual([0, 90, 180, 270]);
    for (const page of result.pages) {
      expect(page.w).toBe(595);
      expect(page.h).toBe(842);
      expect(page.rotationRounded).toBe(false);
    }
  });

  it('reads a non-zero CropBox origin instead of falling back to the MediaBox', async () => {
    const result = await loadDocument(fixture('cropped.pdf'));
    expect(result.ok).toBe(true);
    // MediaBox is [0,0,655,932]; CropBox is [30,45,625,887] — a 595x842 box inset into it.
    expect(result.pages[0]).toEqual({ x0: 30, y0: 45, w: 595, h: 842, rotate: 0, rotationRounded: false });
  });

  it('falls back to the MediaBox when there is no CropBox', async () => {
    const result = await loadDocument(fixture('flat-a4.pdf'));
    expect(result.pages[0]).toEqual({ x0: 0, y0: 0, w: 595, h: 842, rotate: 0, rotationRounded: false });
  });

  it('refuses a zero-page document', async () => {
    const result = await loadDocument(fixture('zero-pages.pdf'));
    expect(result).toEqual({ ok: false, reason: 'zero-pages', pageCount: 0 });
  });

  it('refuses an encrypted document without ever passing ignoreEncryption', async () => {
    const result = await loadDocument(fixture('encrypted.pdf'));
    expect(result).toEqual({ ok: false, reason: 'encrypted' });
  });

  it('refuses a corrupt document', async () => {
    const result = await loadDocument(Buffer.from('not a pdf at all'));
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('refuses an empty buffer as corrupt, not as a crash', async () => {
    const result = await loadDocument(new Uint8Array(0));
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
  });
});
