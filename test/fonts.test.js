import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AUTO_FIT_MAX_PT,
  AUTO_FIT_MIN_PT,
  autoFitFontSize,
  autoFitOverflows,
  embedFullFont,
  embedSubsetFont,
  wrapLines,
} from '../src/fonts.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** @type {import('pdf-lib').PDFFont} */
let font;

beforeAll(async () => {
  const pdfDoc = await PDFDocument.load(readFileSync(join(FIXTURES, 'flat-a4.pdf')));
  font = await embedSubsetFont(pdfDoc);
});

describe('embedSubsetFont / embedFullFont', () => {
  it('both embed successfully, registering fontkit as needed', async () => {
    const pdfDoc = await PDFDocument.load(readFileSync(join(FIXTURES, 'flat-a4.pdf')));
    const subset = await embedSubsetFont(pdfDoc);
    const full = await embedFullFont(pdfDoc);
    expect(subset.name).toBeTruthy();
    expect(full.name).toBeTruthy();
  });
});

describe('wrapLines', () => {
  it('keeps short text on one line', () => {
    expect(wrapLines(font, 'Short', 12, 200)).toEqual(['Short']);
  });

  it('breaks on whitespace once a line would exceed the width', () => {
    const lines = wrapLines(font, 'one two three four five six seven eight nine ten', 12, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(60 + 0.01);
    }
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
  });

  it('keeps a single word wider than maxWidth whole, on its own line', () => {
    const lines = wrapLines(font, 'supercalifragilisticexpialidocious', 40, 20);
    expect(lines).toEqual(['supercalifragilisticexpialidocious']);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapLines(font, '', 12, 100)).toEqual(['']);
  });
});

describe('autoFitFontSize', () => {
  it('picks a larger size for a smaller box\'s worth of short text than for a long sentence', () => {
    const shortSize = autoFitFontSize(font, 'Hi', 200);
    const longSize = autoFitFontSize(font, 'This is a considerably longer sentence to fit', 200);
    expect(shortSize).toBeGreaterThan(longSize);
  });

  it('never returns outside [AUTO_FIT_MIN_PT, AUTO_FIT_MAX_PT]', () => {
    expect(autoFitFontSize(font, 'x', 1000)).toBe(AUTO_FIT_MAX_PT); // trivially fits, clamp to max
    expect(autoFitFontSize(font, 'x'.repeat(500), 10)).toBe(AUTO_FIT_MIN_PT); // never fits, clamp to min
  });

  it('the returned size actually fits, whenever some allowed size does', () => {
    const size = autoFitFontSize(font, 'Fits nicely', 150);
    expect(font.widthOfTextAtSize('Fits nicely', size)).toBeLessThanOrEqual(150);
  });

  it('considers wrapped height, not just width, for multiline text', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    const unconstrained = autoFitFontSize(font, text, 80, { multiline: true, maxHeight: 1000 });
    const constrained = autoFitFontSize(font, text, 80, { multiline: true, maxHeight: 20 });
    expect(constrained).toBeLessThanOrEqual(unconstrained);
  });
});

describe('autoFitOverflows', () => {
  it('is false when the text fits comfortably', () => {
    expect(autoFitOverflows(font, 'Hi', 200)).toBe(false);
  });

  it('is true when even the minimum size does not fit', () => {
    expect(autoFitOverflows(font, 'x'.repeat(500), 10)).toBe(true);
  });
});
