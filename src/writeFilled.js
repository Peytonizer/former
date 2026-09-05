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
 * doesn't mention.
 *
 * Stage 7 scope only: text placements with an explicit font size, single line. Auto-fit sizing
 * (`fontSize: 0`) and alignment both need text measurement and land with fonts.js at stage 11;
 * multiline wrapping lands there too. Ticks, dropdowns and radio groups are stage 10; the
 * signature image path is signature.js at stage 12. Every other placement type is skipped here,
 * not an error — the properties panel that would make an unnamed field creatable doesn't
 * exist yet either.
 */
import { degrees } from 'pdf-lib';

import { embedSubsetFont } from './fonts.js';
import { userFromVisual } from './geometry.js';

/** Used only until fonts.js's auto-fit (stage 11) replaces `fontSize: 0`. */
const FALLBACK_FONT_SIZE_PT = 12;

/**
 * Draw every text placement into its page's content stream and return the saved PDF bytes.
 * `pdfDoc` is mutated in place, matching pdf-lib's own idiom, then saved.
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
    if (placement.type !== 'text') continue;

    const page = pages[placement.page];
    const geometry = pageGeometries[placement.page];
    const anchor = userFromVisual(geometry, placement.rect.x, placement.rect.y);

    page.drawText(placement.value || '', {
      x: anchor.x,
      y: anchor.y,
      size: placement.fontSize || FALLBACK_FONT_SIZE_PT,
      font,
      rotate: degrees(geometry.rotate),
    });
  }

  return pdfDoc.save();
}
