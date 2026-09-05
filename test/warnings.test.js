import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { embedSubsetFont } from '../src/fonts.js';
import { createPlacement, updatePlacement } from '../src/placements.js';
import { collectWarnings } from '../src/warnings.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name));

const geometry = { x0: 0, y0: 0, w: 595, h: 842, rotate: 0 };
const rect = { x: 10, y: 10, w: 100, h: 20 };

function named(placement, name) {
  return updatePlacement([placement], placement.id, { name })[0];
}

describe('collectWarnings — name/type conflicts', () => {
  it('warns when two placements share a name but not a type', () => {
    const text = named(createPlacement({ page: 0, type: 'text', rect }), 'x');
    const check = named(createPlacement({ page: 0, type: 'check', rect }), 'x');

    const warnings = collectWarnings([text, check], [geometry], 'filled');

    expect(warnings.some((w) => w.code === 'name-type-conflict')).toBe(true);
  });

  it('is silent when nothing conflicts', () => {
    const a = named(createPlacement({ page: 0, type: 'text', rect }), 'x');
    const b = named(createPlacement({ page: 1, type: 'text', rect }), 'x');
    expect(collectWarnings([a, b], [geometry, geometry], 'filled')).toEqual([]);
  });
});

describe('collectWarnings — out of bounds', () => {
  it('warns when a placement extends past the page edge', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 550, y: 10, w: 100, h: 20 } });
    const warnings = collectWarnings([placement], [geometry], 'filled');
    expect(warnings.some((w) => w.code === 'out-of-bounds')).toBe(true);
  });

  it('warns when a placement starts before the page edge (negative x or y)', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect: { x: -5, y: 10, w: 50, h: 20 } });
    const warnings = collectWarnings([placement], [geometry], 'filled');
    expect(warnings.some((w) => w.code === 'out-of-bounds')).toBe(true);
  });

  it('is silent for a placement fully inside the page', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect });
    expect(collectWarnings([placement], [geometry], 'filled')).toEqual([]);
  });
});

describe('collectWarnings — unnamed placements', () => {
  it('warns about unnamed placements in layered mode', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect });
    const warnings = collectWarnings([placement], [geometry], 'layered');
    expect(warnings.some((w) => w.code === 'unnamed')).toBe(true);
  });

  it('warns about unnamed placements in template mode', () => {
    const placement = createPlacement({ page: 0, type: 'check', rect });
    const warnings = collectWarnings([placement], [geometry], 'template');
    expect(warnings.some((w) => w.code === 'unnamed')).toBe(true);
  });

  it('never warns about unnamed placements in filled mode — naming is irrelevant there', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect });
    expect(collectWarnings([placement], [geometry], 'filled')).toEqual([]);
  });

  it('does not warn about an unnamed signature placement unless it would become a template field', () => {
    const asNothing = createPlacement({ page: 0, type: 'signature', rect });
    expect(collectWarnings([asNothing], [geometry], 'template').some((w) => w.code === 'unnamed')).toBe(
      false,
    );

    const asText = updatePlacement([asNothing], asNothing.id, { asTextInTemplate: true })[0];
    expect(collectWarnings([asText], [geometry], 'template').some((w) => w.code === 'unnamed')).toBe(true);
  });
});

describe('collectWarnings — signature in template mode', () => {
  it('names what an asTextInTemplate: true signature becomes', () => {
    const withChoice = createPlacement({ page: 0, type: 'signature', rect });
    withChoice.asTextInTemplate = true;

    const warnings = collectWarnings([withChoice], [geometry], 'template');
    const warning = warnings.find((w) => w.code === 'signature-in-template');
    expect(warning.message).toMatch(/blank text field/);
  });

  it('says a signature is left out when asTextInTemplate is false', () => {
    const placement = createPlacement({ page: 0, type: 'signature', rect });
    const warnings = collectWarnings([placement], [geometry], 'template');
    const warning = warnings.find((w) => w.code === 'signature-in-template');
    expect(warning.message).toMatch(/left out/);
  });

  it('never appears for filled or layered mode', () => {
    const placement = createPlacement({ page: 0, type: 'signature', rect });
    expect(collectWarnings([placement], [geometry], 'filled').some((w) => w.code === 'signature-in-template')).toBe(
      false,
    );
    expect(
      collectWarnings([placement], [geometry], 'layered').some((w) => w.code === 'signature-in-template'),
    ).toBe(false);
  });
});

describe('collectWarnings — JPEG signature (filled mode only)', () => {
  it('warns when the resolved signature image is a JPEG', () => {
    const placement = createPlacement({ page: 0, type: 'signature', rect });
    placement.imageId = 'sig-1';
    const signatureMimeTypes = new Map([['sig-1', 'image/jpeg']]);

    const warnings = collectWarnings([placement], [geometry], 'filled', { signatureMimeTypes });
    expect(warnings.some((w) => w.code === 'jpeg-signature')).toBe(true);
  });

  it('is silent for a PNG signature', () => {
    const placement = createPlacement({ page: 0, type: 'signature', rect });
    placement.imageId = 'sig-1';
    const signatureMimeTypes = new Map([['sig-1', 'image/png']]);

    expect(collectWarnings([placement], [geometry], 'filled', { signatureMimeTypes })).toEqual([]);
  });
});

describe('collectWarnings — auto-fit overflow (filled mode only)', () => {
  it('warns when a fontSize: 0 placement does not fit even at the minimum size', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const filledFont = await embedSubsetFont(pdfDoc);

    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 10, h: 20 } });
    placement.value = 'This sentence is much too long for a ten-point-wide box';
    placement.fontSize = 0;

    const warnings = collectWarnings([placement], [geometry], 'filled', { filledFont });
    expect(warnings.some((w) => w.code === 'auto-fit-overflow')).toBe(true);
  });

  it('is silent when the text fits comfortably', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const filledFont = await embedSubsetFont(pdfDoc);

    const placement = createPlacement({ page: 0, type: 'text', rect });
    placement.value = 'Hi';
    placement.fontSize = 0;

    expect(collectWarnings([placement], [geometry], 'filled', { filledFont })).toEqual([]);
  });

  it('is silent without an explicit font size of 0 (an explicit size is never auto-fit)', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const filledFont = await embedSubsetFont(pdfDoc);

    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 10, h: 20 } });
    placement.value = 'This sentence is much too long for a ten-point-wide box';
    placement.fontSize = 12;

    expect(collectWarnings([placement], [geometry], 'filled', { filledFont })).toEqual([]);
  });

  it('is skipped entirely when no font is supplied, rather than throwing', () => {
    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 10, h: 20 } });
    placement.value = 'Some text';
    placement.fontSize = 0;

    expect(() => collectWarnings([placement], [geometry], 'filled')).not.toThrow();
  });
});
