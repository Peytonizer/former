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
 * `fontSize: 0` auto-fits via fonts.js's `autoFitFontSize` (filled mode's own calculation, per
 * SPEC.md — layered and template instead pass `0` straight through to pdf-lib). A multiline
 * placement is wrapped with the same `wrapLines` the size search measured against, and its lines
 * are stacked so the *last* line's baseline sits at the placement's own visual bottom-left —
 * consistent with the single-line rule above, of which it is the one-line special case, rather
 * than a top-anchored convention invented just for this. Alignment isn't implemented: SPEC.md
 * only asks for auto-fit and multiline at this stage, and alignment shifts the anchor sideways by
 * the same measured width auto-fit already computes, so it is a small addition to make later
 * rather than a gap being carried silently.
 *
 * A signature placement is drawn from `signatureImages`, a `Map<imageId, Uint8Array>` the caller
 * resolves from IndexedDB ahead of time (signature.js) — this module stays testable in Node with
 * a plain map and never touches browser storage itself. The stored bytes are sniffed the same
 * way an upload is (`sniffImageType`), because trusting whatever mime type was recorded when the
 * signature was saved is exactly the kind of assumption that breaks quietly. A placement with no
 * matching entry (nothing saved yet, or the id is stale) draws nothing, not an error.
 *
 * A placement marked `fromExistingField` (build stage 13 — `acroform.js` imported it from a real
 * AcroForm field already in the source document) is never drawn at all: SPEC.md's "Existing
 * AcroForm fields" makes this the one case `form.flatten()` is the right call, because the field
 * already exists and was laid out by whoever made the document — setting its value and letting
 * `flatten()` bake it in is more faithful than a second, independent redrawing of the same spot.
 * Every hand-drawn placement in the same export is drawn exactly as described above regardless;
 * the two paths coexist because a document can have both kinds of placement in it.
 *
 * Every other placement type not mentioned above is skipped here, not an error — the properties
 * panel that would make an unnamed field creatable doesn't fully exist yet either.
 */
import { degrees, rgb } from 'pdf-lib';

import { applyImportedValue } from './acroform.js';
import { autoFitFontSize, embedSubsetFont, LINE_HEIGHT_FACTOR, wrapLines } from './fonts.js';
import { userFromVisual } from './geometry.js';
import { groupByName } from './placements.js';
import { sniffImageType } from './signature.js';

function drawText(page, font, geometry, placement, text) {
  const value = text || '';
  const size = placement.fontSize || autoFitFontSize(font, value, placement.rect.w, {
    multiline: placement.multiline,
    maxHeight: placement.rect.h,
  });
  const lines = placement.multiline ? wrapLines(font, value, size, placement.rect.w) : [value];
  const lineHeight = size * LINE_HEIGHT_FACTOR;

  lines.forEach((line, i) => {
    const fromBottom = lines.length - 1 - i; // 0 for the last line, increasing upward
    const anchor = userFromVisual(geometry, placement.rect.x, placement.rect.y + fromBottom * lineHeight);
    page.drawText(line, { x: anchor.x, y: anchor.y, size, font, rotate: degrees(geometry.rotate) });
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

/** Embed and draw a signature image at `rect`, per the same anchor+rotate rule as everything
 * else — an image, like text, is drawn about its own visual bottom-left corner. */
async function drawSignature(pdfDoc, page, geometry, rect, bytes) {
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return; // corrupt or since-deleted signature bytes; nothing sane to draw

  // pdf-lib's JpegEmbedder reads the SOI marker with `new DataView(imageData.buffer)` — the
  // *whole* underlying ArrayBuffer, ignoring byteOffset/byteLength entirely. That's only safe
  // for a Uint8Array that owns its buffer outright; a view into a larger buffer (which
  // `fs.readFileSync`/IndexedDB can both legitimately hand back, and did in CI, where this threw
  // "SOI not found in JPEG" against bytes that are a correct JPEG on disk) gets read from the
  // wrong offset. `.slice()` copies into a fresh, byte-0-based buffer, working around a real bug
  // in an unmaintained dependency rather than in our own code — see CLAUDE.md, "Dependencies".
  const safeBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  const image = mimeType === 'image/png' ? await pdfDoc.embedPng(safeBytes) : await pdfDoc.embedJpg(safeBytes);
  const anchor = userFromVisual(geometry, rect.x, rect.y);
  page.drawImage(image, {
    x: anchor.x,
    y: anchor.y,
    width: rect.w,
    height: rect.h,
    rotate: degrees(geometry.rotate),
  });
}

/**
 * Draw every placement into its page's content stream and return the saved PDF bytes. `pdfDoc`
 * is mutated in place, matching pdf-lib's own idiom, then saved.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries  one per page, same order as
 *   `pdfDoc.getPages()`
 * @param {Map<string, Uint8Array>} [signatureImages]  imageId -> saved signature bytes
 * @returns {Promise<Uint8Array>}
 */
export async function writeFilled(pdfDoc, placements, pageGeometries, signatureImages = new Map()) {
  const font = await embedSubsetFont(pdfDoc);
  const pages = pdfDoc.getPages();
  const form = pdfDoc.getForm();

  const imported = placements.filter((p) => p.fromExistingField && p.name);
  const drawn = placements.filter((p) => !p.fromExistingField);

  for (const placement of drawn) {
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
    } else if (placement.type === 'signature') {
      const bytes = signatureImages.get(placement.imageId);
      // Sequential, not Promise.all: embedding mutates pdfDoc's shared context, and placements
      // must stay in their own list order regardless — the same reasoning as render.js's
      // thumbnail loop.
      // oxlint-disable-next-line no-await-in-loop
      if (bytes) await drawSignature(pdfDoc, page, geometry, placement.rect, bytes);
    }
  }

  if (imported.length > 0) {
    for (const [name, group] of groupByName(imported)) {
      const field = form.getFieldMaybe(name);
      if (field) applyImportedValue(field, group);
    }
    form.flatten();
  }

  return pdfDoc.save();
}
