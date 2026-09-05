/**
 * fonts.js — output font loading and embedding.
 *
 * PDF output uses Liberation Sans as a metric-compatible Helvetica substitute with a real
 * Latin-1 range: Standard-14 Helvetica is WinAnsi-only and breaks on the first name with an
 * accent in it, which in Australia means most names (SPEC.md, "Fonts"). The font file is
 * bundled from pdfjs-dist's own `standard_fonts` (already a pinned dependency, and already the
 * copy pdf.js itself redistributes as a fallback font) rather than fetched from a CDN or the
 * network at runtime — the CSP has no `connect-src` at all, so a runtime `fetch()` would be
 * blocked outright regardless of origin. `?inline` forces Vite to inline it as a base64 data URL
 * at build time (overriding the project's `assetsInlineLimit: 0`, which exists only to keep
 * pdf.js's separate worker file un-inlined), decoded below into bytes with no network involved.
 *
 * Licence: GPLv2 with Red Hat's font-embedding exception (not SIL OFL, which SPEC.md assumed —
 * flagged and confirmed with Matt; see src/assets/fonts/LICENSE_LIBERATION). The exception
 * clause explicitly covers this project's use: embedding the font in a document you create does
 * not by itself bring that document under the GPL.
 *
 * Only Liberation Sans **Regular** is bundled — the placement model has no bold/italic/font-
 * family field (SPEC.md, "The placement model"), so no other weight is ever drawn.
 *
 * Filled mode embeds a subset (every character is known at export time); layered and template
 * embed the font in full, because a recipient can type characters no subset would contain
 * (SPEC.md, "Fonts").
 *
 * Auto-fit (`fontSize: 0`) is only ever computed here for **filled** mode — SPEC.md is explicit
 * that layered and template instead pass `0` straight through to pdf-lib and let the viewer size
 * it. `autoFitFontSize` binary-searches the largest size that fits a box, using the embedded
 * font's own `widthOfTextAtSize`; `wrapLines` is exported alongside it because a multiline
 * placement's fit depends on its *wrapped* height, and `writeFilled.js` needs the same wrapping
 * to actually draw the lines it measured.
 */
import fontkit from '@pdf-lib/fontkit';

import fontDataUrl from './assets/fonts/LiberationSans-Regular.ttf?inline';

/** Decode a base64 `data:` URL into raw bytes, without ever calling `fetch`. */
function bytesFromDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let cachedBytes = null;

function outputFontBytes() {
  cachedBytes ??= bytesFromDataUrl(fontDataUrl);
  return cachedBytes;
}

/**
 * The full font's size in bytes — an honest estimate for the export dialog's "layered and
 * template add about N KB for the full font embed" note (SPEC.md, "Fonts"). A subset is always
 * smaller than this, sometimes drastically so, so this is deliberately not offered as an
 * estimate for filled mode.
 */
export function fullFontByteSize() {
  return outputFontBytes().length;
}

/**
 * Embed Liberation Sans as a **subset** font in `pdfDoc`, for filled-mode output. Every
 * character used in a filled export is known at export time, so a subset is safe and keeps the
 * file small.
 *
 * A custom (non-Standard-14) font needs a fontkit instance registered on the document first —
 * pdf-lib throws `FontkitNotRegisteredError` otherwise. Registering is idempotent, so this
 * doesn't track which documents have already had it done.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 */
export async function embedSubsetFont(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(outputFontBytes(), { subset: true });
}

/**
 * Embed Liberation Sans in **full** in `pdfDoc`, for layered and template output. pdf-lib does
 * not subset unless asked, so this is just `embedFont` with no options — the discipline is in
 * *not* passing `{ subset: true }` here, not in any extra step.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 */
export async function embedFullFont(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  return pdfDoc.embedFont(outputFontBytes());
}

/** Auto-fit never goes above or below these, however small or large the box is. */
export const AUTO_FIT_MIN_PT = 6;
export const AUTO_FIT_MAX_PT = 48;

/**
 * A reasonable single-spacing factor for stacking wrapped lines. Not specified anywhere in
 * SPEC.md — unlike the coordinate transform, this is ordinary typographic judgement, not a
 * pdf-lib fact to get right or wrong. Exported so `writeFilled.js` stacks its drawn lines at
 * the exact spacing this module measured against.
 */
export const LINE_HEIGHT_FACTOR = 1.2;

/**
 * Break `text` into lines that each fit within `maxWidth` at `size`, breaking on whitespace. A
 * single word wider than `maxWidth` is kept whole on its own line rather than split mid-word —
 * there is no hyphenation here.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 * @param {number} size
 * @param {number} maxWidth
 * @returns {string[]}
 */
export function wrapLines(font, text, size, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(attempt, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * The largest font size in `[AUTO_FIT_MIN_PT, AUTO_FIT_MAX_PT]` at which `text` fits `maxWidth`
 * points wide — and, for multiline text, at which its wrapped lines together fit `maxHeight`
 * points tall. Binary search over integer point sizes: fit is monotonic in size (a size that
 * doesn't fit never fits at a larger size), so this converges directly rather than scanning.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 * @param {number} maxWidth
 * @param {{ multiline?: boolean, maxHeight?: number }} [options]
 */
export function autoFitFontSize(font, text, maxWidth, options = {}) {
  let lo = AUTO_FIT_MIN_PT;
  let hi = AUTO_FIT_MAX_PT;
  let best = AUTO_FIT_MIN_PT; // if even the minimum doesn't fit, draw at the minimum anyway
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAtSize(font, text, mid, maxWidth, options)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** @param {{ multiline?: boolean, maxHeight?: number }} [options] */
function fitsAtSize(font, text, size, maxWidth, { multiline = false, maxHeight = Infinity } = {}) {
  if (!multiline) return font.widthOfTextAtSize(text, size) <= maxWidth;
  const lines = wrapLines(font, text, size, maxWidth);
  return lines.length * size * LINE_HEIGHT_FACTOR <= maxHeight;
}

/**
 * `true` when even `AUTO_FIT_MIN_PT` doesn't fit — the case `warnings.js`'s "auto-sized text
 * that will not fit" check (SPEC.md) surfaces, since `autoFitFontSize` itself always returns
 * *some* size regardless, clamped to the minimum, rather than signalling failure.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 * @param {number} maxWidth
 * @param {{ multiline?: boolean, maxHeight?: number }} [options]
 */
export function autoFitOverflows(font, text, maxWidth, options = {}) {
  return !fitsAtSize(font, text, AUTO_FIT_MIN_PT, maxWidth, options);
}
