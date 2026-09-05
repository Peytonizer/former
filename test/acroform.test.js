import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { hasExistingFields, importExistingFields } from '../src/acroform.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name));

/** geometry.js's PageGeometry for each page of a freshly-loaded fixture, in page order. */
function geometriesOf(pdfDoc) {
  return pdfDoc.getPages().map((page) => {
    const box = page.node.CropBox() ?? page.node.MediaBox();
    const [x0, y0, x1, y1] = box.asArray().map((n) => n.asNumber());
    return { x0, y0, w: x1 - x0, h: y1 - y0, rotate: page.getRotation().angle };
  });
}

describe('hasExistingFields', () => {
  it('is false for an ordinary flat document', async () => {
    const pdfDoc = await PDFDocument.load(fixture('flat-a4.pdf'));
    expect(hasExistingFields(pdfDoc)).toBe(false);
  });

  it('is true for a document with a real AcroForm', async () => {
    const pdfDoc = await PDFDocument.load(fixture('has-fields.pdf'));
    expect(hasExistingFields(pdfDoc)).toBe(true);
  });
});

describe('importExistingFields', () => {
  it('imports a text field at its own visual rect, unchecked, no value', async () => {
    const pdfDoc = await PDFDocument.load(fixture('has-fields.pdf'));
    const { placements } = importExistingFields(pdfDoc, geometriesOf(pdfDoc));

    const name = placements.find((p) => p.name === 'name');
    expect(name.type).toBe('text');
    expect(name.rect).toEqual({ x: 60, y: 740, w: 220, h: 20 });
    expect(name.value).toBe('');
    expect(name.fromExistingField).toBe(true);
  });

  it('imports a checkbox as check, unticked', async () => {
    const pdfDoc = await PDFDocument.load(fixture('has-fields.pdf'));
    const { placements } = importExistingFields(pdfDoc, geometriesOf(pdfDoc));

    const agree = placements.find((p) => p.name === 'agree');
    expect(agree.type).toBe('check');
    expect(agree.rect).toEqual({ x: 60, y: 700, w: 16, h: 16 });
    expect(agree.value).toBe(false);
  });

  it('imports a dropdown with its options, nothing selected', async () => {
    const pdfDoc = await PDFDocument.load(fixture('has-fields.pdf'));
    const { placements } = importExistingFields(pdfDoc, geometriesOf(pdfDoc));

    const state = placements.find((p) => p.name === 'state');
    expect(state.type).toBe('dropdown');
    expect(state.options).toEqual(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']);
    expect(state.value).toBe('');
  });

  it('imports a radio group as one placement per option, sharing a name', async () => {
    const pdfDoc = await PDFDocument.load(fixture('has-fields.pdf'));
    const { placements } = importExistingFields(pdfDoc, geometriesOf(pdfDoc));

    const contact = placements.filter((p) => p.name === 'contact');
    expect(contact).toHaveLength(2);
    expect(contact.map((p) => p.type)).toEqual(['radio', 'radio']);
    expect(contact.map((p) => p.optionValue).toSorted()).toEqual(['email', 'phone']);
    expect(contact.map((p) => p.rect)).toEqual([
      { x: 60, y: 620, w: 16, h: 16 },
      { x: 100, y: 620, w: 16, h: 16 },
    ]);
  });

  it('reports button and option-list fields as unsupported, importing nothing for them', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    form.createButton('submit').addToPage('Submit', page, { x: 10, y: 10, width: 80, height: 20, borderWidth: 0 });
    form.createOptionList('cities').addToPage(page, { x: 10, y: 50, width: 100, height: 60, borderWidth: 0 });

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const { placements, unsupported } = importExistingFields(reloaded, geometriesOf(reloaded));

    expect(placements).toEqual([]);
    expect(unsupported.toSorted()).toEqual(['cities', 'submit']);
  });

  it('reads a set value back for each type', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();

    const text = form.createTextField('name');
    text.addToPage(page, { x: 10, y: 10, width: 100, height: 20, borderWidth: 0 });
    text.setText('Jane');

    const check = form.createCheckBox('agree');
    check.addToPage(page, { x: 10, y: 50, width: 16, height: 16, borderWidth: 0 });
    check.check();

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const { placements } = importExistingFields(reloaded, geometriesOf(reloaded));

    expect(placements.find((p) => p.name === 'name').value).toBe('Jane');
    expect(placements.find((p) => p.name === 'agree').value).toBe(true);
  });

  it('places widgets from different pages on their own page index', async () => {
    const doc = await PDFDocument.create();
    const page0 = doc.addPage([595, 842]);
    const page1 = doc.addPage([595, 842]);
    const form = doc.getForm();
    const field = form.createTextField('signed');
    field.addToPage(page0, { x: 10, y: 10, width: 100, height: 20, borderWidth: 0 });
    field.addToPage(page1, { x: 20, y: 20, width: 100, height: 20, borderWidth: 0 });

    const bytes = await doc.save();
    const reloaded = await PDFDocument.load(bytes);
    const { placements } = importExistingFields(reloaded, geometriesOf(reloaded));

    expect(placements.map((p) => p.page).toSorted()).toEqual([0, 1]);
  });
});
