/**
 * sidecar.js — serialise/parse the JSON sidecar, hash the source.
 *
 * SPEC.md, "The sidecar": the placement list plus a fingerprint of the source PDF, small enough
 * to email, for the form filled every month. `imageId` values are preserved verbatim and need no
 * special stripping — a `Placement` never stores image bytes itself, only the key into the
 * IndexedDB signature store, so a sidecar whose signature has since been cleared just loads with
 * that placement's `imageId` pointing at nothing; the properties panel's own "which signature"
 * picker already shows no selection in that case; nothing here needs a new flag for it.
 *
 * `sha256` is over the source PDF bytes exactly as loaded, via `crypto.subtle.digest` — no
 * external hashing library, this is a standard Web Crypto call available in both the browser and
 * Node (>=19), which is what keeps this module testable without a DOM.
 */

const SIDECAR_VERSION = 1;

/** @returns {Promise<string>} lowercase hex SHA-256 of `bytes`. */
export async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {import('./geometry.js').PageGeometry[]} pageGeometries */
function firstPageSizeOf(pageGeometries) {
  return pageGeometries.length > 0 ? [pageGeometries[0].w, pageGeometries[0].h] : [0, 0];
}

/**
 * Build the sidecar object for a document and its current placement list.
 *
 * @param {Uint8Array} sourceBytes
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @param {import('./placements.js').Placement[]} placements
 */
export async function createSidecar(sourceBytes, pageGeometries, placements) {
  return {
    former: SIDECAR_VERSION,
    savedAt: new Date().toISOString(),
    source: {
      sha256: await hashBytes(sourceBytes),
      pageCount: pageGeometries.length,
      firstPageSize: firstPageSizeOf(pageGeometries),
    },
    placements,
  };
}

/** Pretty-printed, so a sidecar opened in a text editor is actually legible. */
export function serialiseSidecar(sidecar) {
  return JSON.stringify(sidecar, null, 2);
}

/** Parse sidecar JSON text. Throws on malformed JSON or a version this app doesn't understand. */
export function parseSidecar(text) {
  const parsed = JSON.parse(text);
  if (parsed?.former !== SIDECAR_VERSION) {
    throw new Error(`Not a former sidecar this version understands (found "former": ${parsed?.former}).`);
  }
  return parsed;
}

/**
 * Compare a loaded sidecar against the document it's being attached to, per SPEC.md's three
 * outcomes. A hash match always wins outright. Short of that, `pageCount` and `firstPageSize`
 * are treated as one combined gate rather than `pageCount` alone: SPEC.md states "page count
 * differs → refuse" and "pageCount and firstPageSize match → attach with a warning" as the two
 * named cases, but doesn't say what a same-page-count, different-first-page-size document should
 * do — refusing that too is the safer reading, since placement coordinates are absolute in
 * points and a differently-shaped first page is exactly the case most likely to misplace them.
 *
 * @param {object} sidecar  from `parseSidecar`
 * @param {Uint8Array} sourceBytes
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @returns {Promise<'match'|'changed'|'refuse'>}
 */
export async function compareSidecar(sidecar, sourceBytes, pageGeometries) {
  const sha256 = await hashBytes(sourceBytes);
  if (sidecar.source.sha256 === sha256) return 'match';

  const [w, h] = firstPageSizeOf(pageGeometries);
  const [sw, sh] = sidecar.source.firstPageSize;
  const sameShape = sidecar.source.pageCount === pageGeometries.length && sw === w && sh === h;
  return sameShape ? 'changed' : 'refuse';
}
