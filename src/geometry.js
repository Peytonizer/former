/**
 * geometry.js — the coordinate model.
 *
 * Copied from lodger's src/geometry.js, not imported — see CLAUDE.md, "Relationship to
 * lodger". A fix here should be carried across to the sibling repo on purpose. Only the
 * transform itself is copied; lodger's stamp-layout functions belong to its own placement
 * problem, not former's.
 *
 * This is the single place in former that reasons about page rotation, and it is pure: plain
 * numbers in, plain numbers out, no pdf-lib types and no DOM. The editor, all three writers and
 * the preview all call it, which is the only thing keeping them in agreement.
 *
 * The problem it solves: PDF user space has its origin at the bottom-left of the page box and
 * is measured in points, but a page also carries a /Rotate value that the viewer applies when
 * displaying it, and a CropBox whose origin is not always (0, 0). A placement dropped "in the
 * top-left corner" means the top-left corner *as the reader sees it*, which on a page rotated
 * 270° is nowhere near the top-left in user space.
 *
 * See SPEC.md, "The coordinate model", for the derivation and the worked example asserted below.
 */

/**
 * @typedef {Object} PageGeometry
 * @property {number} x0      Lower-left x of the CropBox (or MediaBox) in user space.
 * @property {number} y0      Lower-left y of the CropBox (or MediaBox) in user space.
 * @property {number} w       Box width in points.
 * @property {number} h       Box height in points.
 * @property {0|90|180|270} rotate  Normalised /Rotate value.
 */

/**
 * Normalise a raw /Rotate value to one of 0, 90, 180, 270.
 *
 * Returns the rounded angle plus whether rounding was needed, because a page whose /Rotate is
 * not a multiple of 90 is malformed and the user deserves a warning rather than a placement
 * silently drawn at an angle we invented.
 *
 * @returns {{rotate: 0|90|180|270, rounded: boolean}}
 */
export function normaliseRotation(raw) {
  const n = Number.isFinite(raw) ? raw : 0;
  const wrapped = ((n % 360) + 360) % 360;
  const snapped = (Math.round(wrapped / 90) * 90) % 360;
  return {
    rotate: /** @type {0|90|180|270} */ (snapped),
    rounded: Math.abs(wrapped - snapped) > 1e-9 && Math.abs(wrapped - snapped - 360) > 1e-9,
  };
}

/**
 * The page's size as the reader sees it. A 90°- or 270°-rotated portrait page is displayed
 * landscape, so its visual width is the box's height.
 *
 * @param {PageGeometry} g
 * @returns {{width:number, height:number}}
 */
export function visualSize(g) {
  return g.rotate === 90 || g.rotate === 270
    ? { width: g.h, height: g.w }
    : { width: g.w, height: g.h };
}

/**
 * Map a point in visual space (origin at the bottom-left of the page *as displayed*, x right,
 * y up, in points) to PDF user space.
 *
 * A viewer rotates the page clockwise by /Rotate to display it, so this is the inverse of that
 * rotation, composed with the box's own origin offset.
 *
 * @param {PageGeometry} g
 * @param {number} vx
 * @param {number} vy
 * @returns {{x:number, y:number}}
 */
export function userFromVisual(g, vx, vy) {
  switch (g.rotate) {
    case 0:
      return { x: g.x0 + vx, y: g.y0 + vy };
    case 90:
      // Displayed landscape: visual +x runs up the box, visual +y runs left across it.
      return { x: g.x0 + g.w - vy, y: g.y0 + vx };
    case 180:
      return { x: g.x0 + g.w - vx, y: g.y0 + g.h - vy };
    case 270:
      // Displayed landscape the other way: visual +x runs down the box, visual +y runs right.
      return { x: g.x0 + vy, y: g.y0 + g.h - vx };
    default:
      throw new Error(`Unsupported rotation: ${g.rotate}`);
  }
}

/**
 * Map a point in PDF user space back to visual space — the inverse of `userFromVisual`.
 *
 * lodger only ever wrote, so its copy of this function existed purely to prove the transform in
 * tests. former also *reads*: importing an existing AcroForm field means taking a widget's
 * `/Rect`, given in user space, and placing it on the visual editor canvas, so this direction is
 * load-bearing here, not just a test helper.
 *
 * @param {PageGeometry} g
 * @returns {{x:number, y:number}}
 */
export function visualFromUser(g, ux, uy) {
  const bx = ux - g.x0;
  const by = uy - g.y0;
  switch (g.rotate) {
    case 0:
      return { x: bx, y: by };
    case 90:
      return { x: by, y: g.w - bx };
    case 180:
      return { x: g.w - bx, y: g.h - by };
    case 270:
      return { x: g.h - by, y: bx };
    default:
      throw new Error(`Unsupported rotation: ${g.rotate}`);
  }
}
