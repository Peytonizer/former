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
 * Stage 7 needs only the filled writer's subset embed. The full subset-vs-full decision per
 * output mode, and auto-fit measurement, land at build stage 11.
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
