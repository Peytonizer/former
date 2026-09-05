/**
 * warnings.js — the pre-export checks (SPEC.md's warnings table).
 *
 * The refusals in that table (encrypted, corrupt or zero-page PDF; an unrecognised signature
 * image; a sidecar whose page count doesn't match) and the one export-dialog note (the full-font
 * embed's size estimate) are handled where the thing they're about already happens — doc.js,
 * signature.js and sidecar.js's load paths, and fonts.js's `fullFontByteSize` — because none of
 * them depend on the placement list. Everything here does: it looks at the current placements
 * and the mode about to be exported, and returns what a user should see *before* the file is
 * written, not after.
 *
 * `collectWarnings` is pure enough to unit test without a DOM — the one thing it can't do
 * without help is measure text, so a filled-mode auto-fit check is skipped unless the caller
 * hands it an already-embedded font (main.js has one anyway, from building the real export).
 */
import { autoFitOverflows } from './fonts.js';
import { visualSize } from './geometry.js';
import { findNameTypeConflicts } from './placements.js';
import { hasNoTransparency } from './signature.js';

/** @typedef {{ code: string, message: string }} Warning */

/** A short, human label for a placement in a message — its name if it has one, else its type
 * and page. */
function describe(placement) {
  if (placement.name) return `"${placement.name}"`;
  return `an unnamed ${placement.type} placement on page ${placement.page + 1}`;
}

/** Two placements share a name but not a type — export would otherwise fail outright. */
function nameTypeConflictWarnings(placements) {
  return findNameTypeConflicts(placements).map((conflict) => ({
    code: 'name-type-conflict',
    message: `"${conflict.name}" is used by both a ${conflict.types.join(' and a ')} placement — pick one type, or export will fail.`,
  }));
}

/** A placement whose rect falls outside its page's visual bounds. */
function outOfBoundsWarnings(placements, pageGeometries) {
  const warnings = [];
  for (const placement of placements) {
    const geometry = pageGeometries[placement.page];
    if (!geometry) continue;
    const { width, height } = visualSize(geometry);
    const { x, y, w, h } = placement.rect;
    if (x < 0 || y < 0 || x + w > width || y + h > height) {
      warnings.push({
        code: 'out-of-bounds',
        message: `${describe(placement)} on page ${placement.page + 1} extends past the page edge.`,
      });
    }
  }
  return warnings;
}

/** Layered and template both require a name to make a field at all; an unnamed placement is
 * silently left out otherwise (SPEC.md, "Names, and sharing a value"). */
function unnamedWarnings(placements, mode) {
  if (mode !== 'layered' && mode !== 'template') return [];

  const wouldBeExcluded = placements.filter((p) => {
    if (p.name) return false;
    if (p.type === 'signature') return mode === 'template' && p.asTextInTemplate;
    return true;
  });
  if (wouldBeExcluded.length === 0) return [];

  const plural = wouldBeExcluded.length !== 1;
  return [
    {
      code: 'unnamed',
      message: `${wouldBeExcluded.length} placement${plural ? 's' : ''} ${plural ? 'have' : 'has'} no name and will be left out of the ${mode} export. Name ${plural ? 'them' : 'it'} in the properties panel first.`,
    },
  ];
}

/** Template mode: a signature placement never becomes a signature field — say plainly what it
 * becomes instead, per placement, before the file is written. */
function signatureInTemplateWarnings(placements, mode) {
  if (mode !== 'template') return [];
  return placements
    .filter((p) => p.type === 'signature')
    .map((placement) => ({
      code: 'signature-in-template',
      message: placement.asTextInTemplate
        ? `The signature placement on page ${placement.page + 1} becomes a blank text field the recipient can type their name into.`
        : `The signature placement on page ${placement.page + 1} is left out of the template — nothing is put there.`,
    }));
}

/** Filled mode only: a JPEG signature carries an opaque white rectangle over whatever is under
 * it, since JPEG has no transparency. */
function jpegSignatureWarnings(placements, mode, signatureMimeTypes) {
  if (mode !== 'filled' || !signatureMimeTypes) return [];
  return placements
    .filter((p) => p.type === 'signature' && hasNoTransparency(signatureMimeTypes.get(p.imageId)))
    .map((placement) => ({
      code: 'jpeg-signature',
      message: `The signature on page ${placement.page + 1} is a JPEG, which has no transparency — its white box will show over the page.`,
    }));
}

/** Filled mode only: an auto-fit (fontSize: 0) placement that doesn't fit even at the smallest
 * allowed size. Needs a font to measure with — see the module comment. */
function autoFitWarnings(placements, mode, filledFont) {
  if (mode !== 'filled' || !filledFont) return [];
  return placements
    .filter((p) => (p.type === 'text' || p.type === 'dropdown') && p.fontSize === 0 && p.value)
    .filter((p) => autoFitOverflows(filledFont, p.value, p.rect.w, { multiline: p.multiline, maxHeight: p.rect.h }))
    .map((placement) => ({
      code: 'auto-fit-overflow',
      message: `${describe(placement)} on page ${placement.page + 1} won't fully fit its box even at the smallest auto-fit size.`,
    }));
}

/**
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @param {'filled'|'layered'|'template'} mode
 * @param {{ signatureMimeTypes?: Map<string, string>, filledFont?: import('pdf-lib').PDFFont }} [context]
 * @returns {Warning[]}
 */
export function collectWarnings(placements, pageGeometries, mode, context = {}) {
  return [
    ...nameTypeConflictWarnings(placements),
    ...outOfBoundsWarnings(placements, pageGeometries),
    ...unnamedWarnings(placements, mode),
    ...signatureInTemplateWarnings(placements, mode),
    ...jpegSignatureWarnings(placements, mode, context.signatureMimeTypes),
    ...autoFitWarnings(placements, mode, context.filledFont),
  ];
}
