/**
 * writeFilled.js — writer 1: burn placements directly into the page content stream.
 *
 * Filled mode draws with `drawText`/`drawImage` rather than creating and flattening fields
 * (SPEC.md, "Filled mode uses drawText/drawImage, not flatten()") — a control choice, not a
 * correctness one: `flatten()` was verified to place fields correctly on every rotation, but
 * direct drawing gives exact font size and baseline placement, needs only a subset font, and is
 * the only path that can place a signature image at all.
 *
 * Every element is drawn per SPEC.md's "Drawing under rotation" rule: the anchor is
 * `userFromVisual` of the placement's own visual bottom-left corner, and the element is rotated
 * counter-clockwise by the page's own rotation to cancel the clockwise rotation a viewer applies
 * for display. No baseline inset is added for text — the rule is stated once, for every element,
 * and this follows it literally rather than carving out a text-specific exception SPEC.md
 * doesn't mention. A tick's checkmark is a plain vector (two `drawLine` segments) rather than a
 * font glyph, which sidesteps ever having to ask whether Liberation Sans's cmap contains one.
 *
 * Radio needs no cross-placement lookup: a radio placement carries both its own option
 * (`optionValue`) and the group's current selection (`value`, mirrored across every placement
 * sharing the name — see `placements.js`), so "am I the selected one" is `optionValue === value`
 * on the one placement alone.
 *
 * fontSize: 0 (auto-fit) and alignment both need text measurement and land with fonts.js at
 * stage 11; multiline wrapping lands there too. The signature image path is signature.js at
 * stage 12. Every other placement type is skipped here, not an error — the properties panel that
 * would make an unnamed field creatable doesn't fully exist yet either.
 */
import { degrees, rgb } from 'pdf-lib';

import { embedSubsetFont } from './fonts.js';
import { userFromVisual } from './geometry.js';

/** Used only until fonts.js's auto-fit (stage 11) replaces `fontSize: 0`. */
const FALLBACK_FONT_SIZE_PT = 12;

function drawText(page, font, geometry, placement, text) {
  const anchor = userFromVisual(geometry, placement.rect.x, placement.rect.y);
  page.drawText(text || '', {
    x: anchor.x,
    y: anchor.y,
    size: placement.fontSize || FALLBACK_FONT_SIZE_PT,
    font,
    rotate: degrees(geometry.rotate),
  });
}

/** A simple vector checkmark inside `rect`, mapped point by point like the fixture generator's
 * rectangles — a checkmark has no single anchor to rotate about, just three absolute points. */
function drawCheckmark(page, geometry, rect) {
  const { x, y, w, h } = rect;
  const points = [
    { x: x + w * 0.15, y: y + h * 0.5 },
    { x: x + w * 0.4, y: y + h * 0.12 },
    { x: x + w * 0.85, y: y + h * 0.8 },
  ].map((p) => userFromVisual(geometry, p.x, p.y));
  const thickness = Math.max(1, Math.min(w, h) * 0.15);
  const color = rgb(0, 0, 0);
  page.drawLine({ start: points[0], end: points[1], thickness, color });
  page.drawLine({ start: points[1], end: points[2], thickness, color });
}

/**
 * Draw every placement into its page's content stream and return the saved PDF bytes. `pdfDoc`
 * is mutated in place, matching pdf-lib's own idiom, then saved.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries  one per page, same order as
 *   `pdfDoc.getPages()`
 * @returns {Promise<Uint8Array>}
 */
export async function writeFilled(pdfDoc, placements, pageGeometries) {
  const font = await embedSubsetFont(pdfDoc);
  const pages = pdfDoc.getPages();

  for (const placement of placements) {
    const page = pages[placement.page];
    const geometry = pageGeometries[placement.page];

    if (placement.type === 'text' || placement.type === 'dropdown') {
      drawText(page, font, geometry, placement, placement.value);
    } else if (placement.type === 'check') {
      if (placement.value) drawCheckmark(page, geometry, placement.rect);
    } else if (placement.type === 'radio') {
      if (placement.optionValue && placement.optionValue === placement.value) {
        drawCheckmark(page, geometry, placement.rect);
      }
    }
    // signature: stage 12.
  }

  return pdfDoc.save();
}
