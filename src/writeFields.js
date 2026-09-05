/**
 * writeFields.js — writers 2 and 3: create real AcroForm fields, optionally setting their values.
 *
 * Layered ("create the fields and set the values") and template ("create the fields and leave
 * them empty") are one code path, verified safe (SPEC.md, "The round-trip question — answered"):
 * `writeLayered` and `writeTemplate` below are both a thin call into the same internal writer,
 * which keeps the two modes' geometry bugs identical rather than doubled.
 *
 * Three rules from SPEC.md are load-bearing here and are asserted in this file's tests, not just
 * described:
 *
 * - **The widget rectangle rule.** `field.addToPage` does not take a rect array — it computes
 *   one internally from `{ x, y, width, height, rotate, borderWidth }`, and the rule for getting
 *   the same visual box as the other writers collapses to: `x, y` = `userFromVisual` of the
 *   placement's own visual bottom-left, `width`/`height` = the placement's **visual** size (not
 *   swapped), `rotate` = the page's own rotation, `borderWidth: 0`. Two more defaults must be
 *   overridden explicitly with the key present (`backgroundColor`, `borderColor`), because
 *   pdf-lib tests `'backgroundColor' in options`, not its truthiness.
 * - **One field, many widgets.** `form.createTextField(name)` is called once per field name;
 *   every placement sharing that name calls `addToPage` on the *same* field object. Calling
 *   `createTextField` twice with one name throws — this is why `placements.js`'s `groupByName`
 *   exists.
 * - **Tab order.** Each page's `/Annots` is sorted once, after every widget has been added, by
 *   descending visual `y` then ascending visual `x` — in **visual** space, not user space, or a
 *   rotated page tabs sideways. Widgets are added in field-then-placement order as the placement
 *   list is walked, which is not the visual order, so this is a real reorder, not a formality.
 *
 * Text placements only at this stage — ticks, dropdowns and radio groups arrive at build stage
 * 10 for all three writers together. An unnamed placement is skipped, not an error: naming is a
 * required field in these two modes (SPEC.md, "Names, and sharing a value"), but the properties
 * panel that would let a user type one in doesn't exist until stage 10 either.
 */
import { degrees, PDFBool, PDFName } from 'pdf-lib';

import { embedFullFont } from './fonts.js';
import { userFromVisual } from './geometry.js';
import { groupByName } from './placements.js';

/**
 * The `FieldAppearanceOptions` for one placement's widget, per the widget rectangle rule.
 *
 * @param {import('./placements.js').Placement} placement
 * @param {import('./geometry.js').PageGeometry} geometry
 */
function widgetOptions(placement, geometry) {
  const anchor = userFromVisual(geometry, placement.rect.x, placement.rect.y);
  return {
    x: anchor.x,
    y: anchor.y,
    width: placement.rect.w,
    height: placement.rect.h,
    rotate: degrees(geometry.rotate),
    borderWidth: 0,
    // The keys must be present even though the values are undefined — pdf-lib checks
    // `'backgroundColor' in options`, not truthiness, and its own defaults are opaque white and
    // a black 1pt border, either of which would cover the printed form the template sits on.
    backgroundColor: undefined,
    borderColor: undefined,
  };
}

/** The refs currently in a page's `/Annots`, in order, or `[]` if it has none. */
function annotRefs(page) {
  const annots = page.node.Annots();
  if (!annots) return [];
  return Array.from({ length: annots.size() }, (_, i) => annots.get(i));
}

/**
 * Sort every page's `/Annots` by visual tab order: descending visual `y` (top of the page
 * first), then ascending visual `x`. `widgetsByPage` holds, for each page, the `{ ref, placement
 * }` pairs added to it, in the order they were added — not the order they belong in, which is
 * exactly why this reorder is a separate pass over the whole document rather than something done
 * as each widget is created.
 *
 * @param {import('pdf-lib').PDFPage[]} pages
 * @param {Map<number, {ref: import('pdf-lib').PDFRef, placement: import('./placements.js').Placement}[]>} widgetsByPage
 */
function sortAnnotsByTabOrder(pdfDoc, pages, widgetsByPage) {
  for (const [pageIndex, widgets] of widgetsByPage) {
    if (widgets.length === 0) continue;
    const sorted = widgets.toSorted((a, b) => {
      const ra = a.placement.rect;
      const rb = b.placement.rect;
      return rb.y - ra.y || ra.x - rb.x;
    });
    pages[pageIndex].node.set(PDFName.of('Annots'), pdfDoc.context.obj(sorted.map((w) => w.ref)));
  }
}

/**
 * The shared writer. Creates one field per name, adds a widget per placement sharing that name,
 * sorts each page's tab order, then generates appearances and sets `NeedAppearances` — both are
 * needed, because a field with neither looks like an empty box in macOS Preview in particular.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @param {{ setValues: boolean }} options
 * @returns {Promise<Uint8Array>}
 */
async function writeFields(pdfDoc, placements, pageGeometries, { setValues }) {
  const font = await embedFullFont(pdfDoc);
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();

  const named = placements.filter((p) => p.type === 'text' && p.name);
  /** @type {Map<number, {ref: import('pdf-lib').PDFRef, placement: import('./placements.js').Placement}[]>} */
  const widgetsByPage = new Map();

  for (const [name, group] of groupByName(named)) {
    const field = form.createTextField(name);
    for (const placement of group) {
      const page = pages[placement.page];
      const before = new Set(annotRefs(page));
      field.addToPage(page, widgetOptions(placement, pageGeometries[placement.page]));
      const ref = annotRefs(page).find((r) => !before.has(r));

      if (!widgetsByPage.has(placement.page)) widgetsByPage.set(placement.page, []);
      widgetsByPage.get(placement.page).push({ ref, placement });

      if (setValues) field.setText(placement.value || '');
    }
  }

  sortAnnotsByTabOrder(pdfDoc, pages, widgetsByPage);

  // Both matter: a field with neither has no rendered appearance at all until something makes
  // one, and there is no `setNeedAppearances` API in pdf-lib 1.17.1 — verified, the string
  // doesn't appear anywhere in the package — so the raw dict write is the supported approach.
  form.updateFieldAppearances(font);
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

  return pdfDoc.save();
}

/**
 * Layered export: create the fields and set their values. The recipient can edit them further.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @returns {Promise<Uint8Array>}
 */
export async function writeLayered(pdfDoc, placements, pageGeometries) {
  return writeFields(pdfDoc, placements, pageGeometries, { setValues: true });
}

/**
 * Template export: create the same fields, empty. A scan of a printed form becomes fillable.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./placements.js').Placement[]} placements
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries
 * @returns {Promise<Uint8Array>}
 */
export async function writeTemplate(pdfDoc, placements, pageGeometries) {
  return writeFields(pdfDoc, placements, pageGeometries, { setValues: false });
}
