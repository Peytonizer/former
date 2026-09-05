/**
 * Cross-writer agreement — build stage 9.
 *
 * SPEC.md, "The round-trip question — answered": filled and layered are genuinely separate
 * writers (drawText vs. a real field), so the tests must assert they agree rather than trust
 * that they do. For an identical text placement with an explicit font size, writeFilled's drawn
 * anchor and writeFields' widget anchor must describe the same point in the same rotation.
 *
 * This is deliberately not a re-check of either writer's own correctness — writeFilled.test.js
 * and writeFields.test.js already assert each one against SPEC.md's worked example and widget-
 * rectangle table independently. What this file guards against is the two drifting apart from
 * each other: both currently compute their anchor via the same `userFromVisual` call, so they
 * agree by construction today, but nothing stops a future edit to one writer from quietly
 * breaking that. A disagreement here means one of the two verified rules is being violated by an
 * implementation bug — per CLAUDE.md, that is a stop-and-flag situation, not a fudge factor.
 */
import { PDFDocument, PDFTextField } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlacement } from '../src/placements.js';
import { writeFilled } from '../src/writeFilled.js';
import { writeLayered } from '../src/writeFields.js';

async function blankPage(rotate) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  if (rotate) page.setRotation({ type: 'degrees', angle: rotate });
  return { pdfDoc, geometry: { x0: 0, y0: 0, w: 595, h: 842, rotate } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cross-writer agreement', () => {
  for (const rotate of [0, 90, 180, 270]) {
    it(`filled's drawn anchor and layered's widget anchor agree at /Rotate ${rotate}`, async () => {
      const placement = createPlacement({ page: 0, type: 'text', rect: { x: 100, y: 50, w: 120, h: 20 } });
      placement.value = 'Hello';
      placement.fontSize = 18;
      placement.name = 'agree'; // layered requires a name to create a field at all

      const filled = await blankPage(rotate);
      const drawTextSpy = vi.spyOn(filled.pdfDoc.getPages()[0], 'drawText');
      await writeFilled(filled.pdfDoc, [placement], [filled.geometry]);
      const filledArgs = drawTextSpy.mock.calls[0][1];

      const layered = await blankPage(rotate);
      // The field is created inside writeFields.js, not handed back to the caller, so the
      // prototype method is spied on rather than a specific instance.
      const addToPageSpy = vi.spyOn(PDFTextField.prototype, 'addToPage');
      await writeLayered(layered.pdfDoc, [placement], [layered.geometry]);
      const layeredArgs = addToPageSpy.mock.calls[0][1];

      expect(layeredArgs.x).toBe(filledArgs.x);
      expect(layeredArgs.y).toBe(filledArgs.y);
      expect(layeredArgs.rotate.angle).toBe(filledArgs.rotate.angle);
    });
  }
});
