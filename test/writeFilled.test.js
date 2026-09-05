import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { createPlacement } from '../src/placements.js';
import { writeFilled } from '../src/writeFilled.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name));

/** geometry.js's PageGeometry for each page of a freshly-loaded fixture, in page order. */
function geometriesOf(pdfDoc) {
  return pdfDoc.getPages().map((page) => {
    const box = page.node.CropBox() ?? page.node.MediaBox();
    const [x0, y0, x1, y1] = box.asArray().map((n) => n.asNumber());
    return { x0, y0, w: x1 - x0, h: y1 - y0, rotate: page.getRotation().angle };
  });
}

describe('writeFilled', () => {
  it('draws a text placement at the anchor SPEC.md\'s worked example gives, rotated to match the page', async () => {
    // The rotated.pdf fixture's page 2 (index 1) is /Rotate 90 — the exact SPEC.md worked
    // example page. A placement whose visual rect starts at (700, 20) with a fontSize of 24
    // must produce the same anchor and rotation the geometry test already asserts.
    const pdfDoc = await PDFDocument.load(fixture('rotated.pdf'));
    const pages = pdfDoc.getPages();
    const spy = vi.spyOn(pages[1], 'drawText');

    const placement = createPlacement({
      page: 1,
      type: 'text',
      rect: { x: 700, y: 20, w: 60, h: 40 },
    });
    placement.value = 'Hello';
    placement.fontSize = 24;

    await writeFilled(pdfDoc, [placement], geometriesOf(pdfDoc));

    expect(spy).toHaveBeenCalledTimes(1);
    const [text, options] = spy.mock.calls[0];
    expect(text).toBe('Hello');
    expect(options.x).toBe(575);
    expect(options.y).toBe(700);
    expect(options.size).toBe(24);
    expect(options.rotate.angle).toBe(90);
  });

  it('falls back to a default size when fontSize is 0 (auto-fit is stage 11)', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawText');

    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } });
    placement.value = 'x';
    placement.fontSize = 0;

    await writeFilled(pdfDoc, [placement], geometriesOf(pdfDoc));

    expect(spy.mock.calls[0][1].size).toBe(12);
  });

  it('draws nothing for an empty value, without throwing', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawText');
    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } });

    await writeFilled(pdfDoc, [placement], geometriesOf(pdfDoc));

    expect(spy).toHaveBeenCalledWith('', expect.anything());
  });

  it('skips an unticked check placement, drawing nothing', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawLine');
    const check = createPlacement({ page: 0, type: 'check', rect: { x: 10, y: 10, w: 20, h: 20 } });

    await writeFilled(pdfDoc, [check], geometriesOf(pdfDoc));

    expect(spy).not.toHaveBeenCalled();
  });

  it('draws a checkmark for a ticked check placement', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawLine');
    const check = createPlacement({ page: 0, type: 'check', rect: { x: 10, y: 10, w: 20, h: 20 } });
    check.value = true;

    await writeFilled(pdfDoc, [check], geometriesOf(pdfDoc));

    // Two line segments make the checkmark shape; both stay inside the placement's rect.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      const [{ start, end }] = call;
      for (const point of [start, end]) {
        expect(point.x).toBeGreaterThanOrEqual(10);
        expect(point.x).toBeLessThanOrEqual(30);
        expect(point.y).toBeGreaterThanOrEqual(10);
        expect(point.y).toBeLessThanOrEqual(30);
      }
    }
  });

  it('draws a dropdown\'s selected value as text', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawText');
    const dropdown = createPlacement({ page: 0, type: 'dropdown', rect: { x: 10, y: 10, w: 100, h: 20 } });
    dropdown.options = ['NSW', 'VIC'];
    dropdown.value = 'VIC';

    await writeFilled(pdfDoc, [dropdown], geometriesOf(pdfDoc));

    expect(spy).toHaveBeenCalledWith('VIC', expect.anything());
  });

  it('marks the selected radio option, and no others, without a cross-placement lookup', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const spy = vi.spyOn(pdfDoc.getPages()[0], 'drawLine');

    const email = createPlacement({ page: 0, type: 'radio', rect: { x: 10, y: 10, w: 20, h: 20 } });
    email.name = 'contact';
    email.optionValue = 'email';
    email.value = 'email'; // the group's shared current selection

    const phone = createPlacement({ page: 0, type: 'radio', rect: { x: 50, y: 10, w: 20, h: 20 } });
    phone.name = 'contact';
    phone.optionValue = 'phone';
    phone.value = 'email';

    await writeFilled(pdfDoc, [email, phone], geometriesOf(pdfDoc));

    expect(spy).toHaveBeenCalledTimes(2); // one checkmark (two lines) for "email" only
    for (const call of spy.mock.calls) {
      const [{ start, end }] = call;
      for (const point of [start, end]) {
        expect(point.x).toBeGreaterThanOrEqual(10);
        expect(point.x).toBeLessThanOrEqual(30);
      }
    }
  });

  it('produces bytes pdf-lib can reload, with the page count unchanged', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const placement = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } });
    placement.value = 'Reloadable';
    placement.fontSize = 14;

    const bytes = await writeFilled(pdfDoc, [placement], geometriesOf(pdfDoc));
    const reloaded = await PDFDocument.load(bytes);

    expect(reloaded.getPageCount()).toBe(2);
  });

  it('draws each placement onto its own page, not always page 0', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    const pages = pdfDoc.getPages();
    const spy0 = vi.spyOn(pages[0], 'drawText');
    const spy1 = vi.spyOn(pages[1], 'drawText');

    const placement = createPlacement({ page: 1, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } });
    placement.value = 'Page two';
    placement.fontSize = 12;

    await writeFilled(pdfDoc, [placement], geometriesOf(pdfDoc));

    expect(spy0).not.toHaveBeenCalled();
    expect(spy1).toHaveBeenCalledTimes(1);
  });
});
