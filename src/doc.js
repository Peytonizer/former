/**
 * doc.js — load a PDF and find out what it is before anything is drawn on it.
 *
 * Three refusals live here, per SPEC.md's warnings table: an encrypted document (never opened
 * with `ignoreEncryption` — silently stripping a document's protection is not this tool's
 * decision to make), a corrupt document pdf-lib cannot parse at all, and a structurally valid
 * document with zero pages. Everything else returns the per-page geometry the rest of the app
 * needs: the CropBox (falling back to the MediaBox), normalised against `geometry.js`.
 */
import { PDFDocument } from 'pdf-lib';

import { normaliseRotation } from './geometry.js';

/**
 * @typedef {import('./geometry.js').PageGeometry & { rotationRounded: boolean }} DocPageGeometry
 */

/**
 * @typedef {{ ok: true, pdfDoc: import('pdf-lib').PDFDocument, pages: DocPageGeometry[] }} LoadSuccess
 * @typedef {{ ok: false, reason: 'encrypted'|'corrupt'|'zero-pages', pageCount?: number }} LoadFailure
 */

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<LoadSuccess|LoadFailure>}
 */
export async function loadDocument(bytes) {
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(bytes);
  } catch (err) {
    return { ok: false, reason: isEncryptedError(err) ? 'encrypted' : 'corrupt' };
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount === 0) return { ok: false, reason: 'zero-pages', pageCount: 0 };

  const pages = pdfDoc.getPages().map(pageGeometry);
  return { ok: true, pdfDoc, pages };
}

/**
 * pdf-lib's own message for this case, verified against 1.17.1: "Input document to
 * `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true
 * })` if you wish to load the document anyways." There is no typed error class to catch instead
 * — just a plain `Error` — and a corrupt file's message is unrelated ("Failed to parse PDF
 * document ... No PDF header found"), so matching on "is encrypted" tells the two apart.
 */
function isEncryptedError(err) {
  return typeof err?.message === 'string' && err.message.includes('is encrypted');
}

/**
 * One page's geometry: the CropBox (or MediaBox when there is no CropBox) and the normalised
 * rotation. Exported on its own so `acroform.js` can extract the geometry of a page it already
 * has a handle to, without loading the document a second time.
 *
 * @param {import('pdf-lib').PDFPage} page
 * @returns {DocPageGeometry}
 */
export function pageGeometry(page) {
  const box = page.node.CropBox() ?? page.node.MediaBox();
  const [x0, y0, x1, y1] = box.asArray().map((n) => n.asNumber());
  const { rotate, rounded } = normaliseRotation(page.getRotation().angle);
  return { x0, y0, w: x1 - x0, h: y1 - y0, rotate, rotationRounded: rounded };
}
