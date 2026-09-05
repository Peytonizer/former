/**
 * acroform.js — detect and import a document's existing AcroForm fields.
 *
 * SPEC.md, "Existing AcroForm fields": if a document already has real fields, offer to import
 * them as placements rather than silently drawing on top — a form that already works must not
 * be degraded into an image annotation. Each widget of each field imports as one placement, all
 * sharing the field's name, which round-trips straight back out through `placements.js`'s own
 * "same field as…" grouping — no separate import-tracking structure is needed.
 *
 * Button and option-list fields are out of scope: their names are returned separately, in
 * `unsupported`, so the caller can say so and leave them completely alone. Every imported
 * placement is marked `fromExistingField: true` (build stage 13), which is what tells
 * `writeFilled.js` to set the real field's value and let `form.flatten()` bake it in, instead of
 * drawing fresh text or an image at the computed anchor the way a hand-drawn placement is.
 */
import { PDFButton, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField } from 'pdf-lib';

import { visualRectFromUserRect } from './geometry.js';
import { createPlacement } from './placements.js';

/** @returns {boolean} whether the document has any AcroForm fields at all. */
export function hasExistingFields(pdfDoc) {
  return pdfDoc.getForm().getFields().length > 0;
}

function placementTypeFor(field) {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'check';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFSignature) return 'signature';
  return null; // PDFButton, PDFOptionList, or anything pdf-lib adds later — unsupported
}

function currentValueFor(field, type) {
  if (type === 'text') return field.getText() ?? '';
  if (type === 'check') return field.isChecked();
  if (type === 'dropdown') return field.getSelected()[0] ?? '';
  if (type === 'radio') return field.getSelected() ?? '';
  return ''; // signature: nothing to read: pdf-lib exposes no way to read a digital signature's value
}

/**
 * Set a real, already-existing field's value from its imported placements' current value — the
 * write side of `currentValueFor`, used by `writeFilled.js`'s "set the values and flatten" path
 * (SPEC.md, "Existing AcroForm fields") for placements marked `fromExistingField`.
 *
 * @param {import('pdf-lib').PDFField} field
 * @param {import('./placements.js').Placement[]} group  every placement sharing this field's name
 */
export function applyImportedValue(field, group) {
  const type = placementTypeFor(field);
  const value = group[0].value;
  if (type === 'text') {
    field.setText(value || '');
  } else if (type === 'check') {
    if (value) field.check();
    else field.uncheck();
  } else if ((type === 'dropdown' || type === 'radio') && value) {
    field.select(value);
  }
  // signature: nothing to set — pdf-lib has no API for writing a digital signature's value.
}

/**
 * @typedef {{ placements: import('./placements.js').Placement[], unsupported: string[] }} ImportResult
 */

/**
 * Import every importable field's widgets as placements.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {import('./geometry.js').PageGeometry[]} pageGeometries  one per page, same order as
 *   `pdfDoc.getPages()`
 * @returns {ImportResult}
 */
export function importExistingFields(pdfDoc, pageGeometries) {
  const pages = pdfDoc.getPages();
  const placements = [];
  const unsupported = [];

  for (const field of pdfDoc.getForm().getFields()) {
    if (field instanceof PDFButton || field instanceof PDFOptionList) {
      unsupported.push(field.getName());
      continue;
    }

    const type = placementTypeFor(field);
    if (!type) {
      unsupported.push(field.getName());
      continue;
    }

    const value = currentValueFor(field, type);
    // Widget order matches getOptions() order — both are populated by matching
    // addOptionToPage(option, ...) calls in the same sequence (verified in a Node probe).
    const radioOptions = type === 'radio' ? field.getOptions() : null;

    field.acroField.getWidgets().forEach((widget, index) => {
      const pageIndex = pages.findIndex((p) => p.ref === widget.P());
      if (pageIndex === -1) return; // an orphaned widget with no page to place it on

      const rect = visualRectFromUserRect(pageGeometries[pageIndex], widget.getRectangle());
      const placement = createPlacement({ page: pageIndex, type, rect });
      placement.name = field.getName();
      placement.value = value;
      placement.fromExistingField = true;
      if (type === 'dropdown') placement.options = field.getOptions();
      if (type === 'radio') {
        placement.options = radioOptions;
        placement.optionValue = radioOptions[index] ?? '';
      }

      placements.push(placement);
    });
  }

  return { placements, unsupported };
}
