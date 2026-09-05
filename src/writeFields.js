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
 * Text, check, dropdown and radio are all handled (stage 10); signature is not, in the sense that
 * there is no signature field type — SPEC.md is explicit that a signature can never become one.
 * What a signature placement becomes is mode-dependent and decided once, up front, by
 * `resolveSignatures`: in **template** mode, `asTextInTemplate: true` turns it into an ordinary
 * text placement (so it flows through every rule above unchanged) and `false` drops it entirely;
 * in **layered** mode it is always dropped — SPEC.md's "Signatures" describes this choice only
 * for template, and a signature is fundamentally something *you* already provided, not a value
 * the recipient a layered export is meant for would fill in themselves. Either way, the actual
 * signature *image* is never drawn here — only `writeFilled.js` can place an image at all.
 *
 * An unnamed placement is skipped, not an error: naming is required in these two modes (SPEC.md,
 * "Names, and sharing a value"), but the properties panel that would let a user type one in
 * doesn't fully exist yet either.
 *
 * A radio group is one field with several widgets, same as text, but each widget represents a
 * different **option** rather than a repeat of the same value — `addOptionToPage(optionValue,
 * page, opts)` instead of `addToPage(page, opts)` — and the group's current selection is set
 * once, on the field, from whichever placement's `value` happens to be present (they are all the
 * same string, mirrored across the group like `name`; see `placements.js`).
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

/** One field-creating call per placement type. `form.createXField(name)` throws if `name` is
 * already used by a *different* type — the reason `findNameTypeConflicts` exists in
 * `placements.js` as a pre-export warning rather than a crash discovered here. */
const FIELD_CREATORS = {
  text: (form, name) => form.createTextField(name),
  check: (form, name) => form.createCheckBox(name),
  dropdown: (form, name) => form.createDropdown(name),
  radio: (form, name) => form.createRadioGroup(name),
};

/** Add one placement's widget to `page`, dispatching on type — radio is the one shape that
 * doesn't take `addToPage` directly. */
function addWidget(field, type, page, placement, geometry) {
  const options = widgetOptions(placement, geometry);
  if (type === 'radio') field.addOptionToPage(placement.optionValue, page, options);
  else field.addToPage(page, options);
}

/** Set a field's value from its group's shared `value` (SPEC.md, "the round-trip question"). */
function applyValue(field, type, group) {
  const value = group[0].value;
  if (type === 'text') {
    field.setText(value || '');
  } else if (type === 'check') {
    if (value) field.check();
    else field.uncheck();
  } else if (value) {
    field.select(value); // dropdown and radio both expose select(value)
  }
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
 * Turn each signature placement into whatever it becomes in this mode, before anything else
 * runs. Layered drops every one; template turns `asTextInTemplate: true` into a plain text
 * placement (empty value — nothing is ever drawn here) and drops the rest.
 *
 * @param {import('./placements.js').Placement[]} placements
 * @param {boolean} setValues  true for layered, false for template
 */
function resolveSignatures(placements, setValues) {
  return placements
    .map((p) => {
      if (p.type !== 'signature') return p;
      if (setValues) return null; // layered: never a field, never a substitute
      return p.asTextInTemplate ? { ...p, type: 'text', value: '' } : null;
    })
    .filter(Boolean);
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

  const named = resolveSignatures(placements, setValues).filter((p) => p.name);
  /** @type {Map<number, {ref: import('pdf-lib').PDFRef, placement: import('./placements.js').Placement}[]>} */
  const widgetsByPage = new Map();

  for (const [name, group] of groupByName(named)) {
    const type = group[0].type;
    const field = FIELD_CREATORS[type](form, name);
    if (type === 'dropdown') field.setOptions(group[0].options);

    for (const placement of group) {
      const page = pages[placement.page];
      const before = new Set(annotRefs(page));
      addWidget(field, type, page, placement, pageGeometries[placement.page]);
      const ref = annotRefs(page).find((r) => !before.has(r));

      if (!widgetsByPage.has(placement.page)) widgetsByPage.set(placement.page, []);
      widgetsByPage.get(placement.page).push({ ref, placement });
    }

    // setFontSize needs a /DA string to already exist on the field, which only the widget it
    // was just given creates. 0 is passed through per SPEC.md's "Fonts" — auto-fit is only
    // filled mode's own calculation, so a fontSize of 0 here means "let the viewer size it" —
    // but it does not survive as a literal 0 in the saved file: calling setFontSize at all marks
    // the field dirty, and PDFDocument.save() unconditionally regenerates a dirty field's
    // appearance with a real computed size, baking that same number into /DA as a side effect.
    // Both facts verified in a Node probe, since neither is one of SPEC.md's own verified claims.
    // NeedAppearances (set below) is what actually still delivers "let the viewer size it" to a
    // compliant reader, which disregards our baked appearance and /DA and computes its own.
    // Check and radio have no text of their own, so neither field type exposes setFontSize.
    if (type === 'text' || type === 'dropdown') field.setFontSize(group[0].fontSize);

    if (setValues) applyValue(field, type, group);
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
