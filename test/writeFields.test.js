import { PDFBool, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createPlacement, updatePlacement } from '../src/placements.js';
import { writeLayered, writeTemplate } from '../src/writeFields.js';

/** A single 595x842 page at the given rotation, with no other content. */
async function blankPage(rotate) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  if (rotate) page.setRotation({ type: 'degrees', angle: rotate });
  const geometry = { x0: 0, y0: 0, w: 595, h: 842, rotate };
  return { pdfDoc, geometry };
}

function named(placement, name) {
  return updatePlacement([placement], placement.id, { name })[0];
}

async function widgetRectOf(bytes) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const [widget] = form.getFields()[0].acroField.getWidgets();
  return widget.getRectangle();
}

describe('writeFields — the widget rectangle rule', () => {
  // SPEC.md's verified table: a 120x20 visual box, visual bottom-left (100, 50), on a 595x842
  // page, at each of the four rotations.
  const cases = [
    { rotate: 0, rect: { x: 100, y: 50, w: 120, h: 20 } },
    { rotate: 90, rect: { x: 525, y: 100, w: 20, h: 120 } },
    { rotate: 180, rect: { x: 375, y: 772, w: 120, h: 20 } },
    { rotate: 270, rect: { x: 50, y: 622, w: 20, h: 120 } },
  ];

  for (const { rotate, rect } of cases) {
    it(`produces the documented /Rect at /Rotate ${rotate}`, async () => {
      const { pdfDoc, geometry } = await blankPage(rotate);
      const placement = named(
        createPlacement({ page: 0, type: 'text', rect: { x: 100, y: 50, w: 120, h: 20 } }),
        'field',
      );

      const bytes = await writeTemplate(pdfDoc, [placement], [geometry]);
      const found = await widgetRectOf(bytes);

      expect(found).toEqual({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });
    });
  }
});

describe('writeFields — one field, many widgets', () => {
  it('creates one field with a widget per placement sharing its name', async () => {
    const { pdfDoc, geometry } = await blankPage(0);
    pdfDoc.addPage([595, 842]);
    pdfDoc.addPage([595, 842]);
    const geometries = [geometry, geometry, geometry];

    const a = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }), 'signed');
    const b = named(createPlacement({ page: 2, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }), 'signed');

    const bytes = await writeTemplate(pdfDoc, [a, b], geometries);
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();

    expect(form.getFields()).toHaveLength(1);
    expect(form.getFields()[0].acroField.getWidgets()).toHaveLength(2);
    expect(doc.getPages()[0].node.Annots()?.size()).toBe(1);
    expect(doc.getPages()[2].node.Annots()?.size()).toBe(1);
  });

  it('skips unnamed placements — naming is required but has no UI yet', async () => {
    const { pdfDoc, geometry } = await blankPage(0);
    const unnamed = createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } });

    const bytes = await writeTemplate(pdfDoc, [unnamed], [geometry]);
    const doc = await PDFDocument.load(bytes);

    expect(doc.getForm().getFields()).toHaveLength(0);
  });
});

describe('writeFields — tab order', () => {
  it('sorts /Annots by descending visual y then ascending visual x, not creation order', async () => {
    const { pdfDoc, geometry } = await blankPage(0);
    // Created bottom-to-top, left-to-right — the reverse of correct tab order.
    const bottomLeft = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 50, h: 20 } }), 'c');
    const bottomRight = named(createPlacement({ page: 0, type: 'text', rect: { x: 200, y: 10, w: 50, h: 20 } }), 'd');
    const topLeft = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 700, w: 50, h: 20 } }), 'a');
    const topRight = named(createPlacement({ page: 0, type: 'text', rect: { x: 200, y: 700, w: 50, h: 20 } }), 'b');

    const bytes = await writeTemplate(pdfDoc, [bottomLeft, bottomRight, topLeft, topRight], [geometry]);
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPages()[0].node.Annots();
    const names = Array.from({ length: annots.size() }, (_, i) => {
      const widget = doc.context.lookup(annots.get(i));
      const field = doc.context.lookup(widget.get(PDFName.of('Parent')));
      return field.get(PDFName.of('T')).decodeText();
    });

    expect(names).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts in visual space, not user space, on a rotated page', async () => {
    // /Rotate 90: visual +y runs along user -x (see geometry.js). Two placements stacked in
    // visual y must end up in visual order even though their user-space y is identical.
    const { pdfDoc, geometry } = await blankPage(90);
    const visualTop = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 700, w: 50, h: 20 } }), 'top');
    const visualBottom = named(
      createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 50, h: 20 } }),
      'bottom',
    );

    // Creation order is deliberately bottom-then-top, the wrong order, so the sort is load-bearing.
    const bytes = await writeTemplate(pdfDoc, [visualBottom, visualTop], [geometry]);
    const doc = await PDFDocument.load(bytes);
    const annots = doc.getPages()[0].node.Annots();
    const names = Array.from({ length: annots.size() }, (_, i) => {
      const widget = doc.context.lookup(annots.get(i));
      const field = doc.context.lookup(widget.get(PDFName.of('Parent')));
      return field.get(PDFName.of('T')).decodeText();
    });

    expect(names).toEqual(['top', 'bottom']);
  });
});

describe('writeFields — appearances', () => {
  it('sets NeedAppearances on the AcroForm dict', async () => {
    const { pdfDoc, geometry } = await blankPage(0);
    const placement = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }), 'x');

    const bytes = await writeTemplate(pdfDoc, [placement], [geometry]);
    const doc = await PDFDocument.load(bytes);

    const needAppearances = doc.catalog
      .lookup(PDFName.of('AcroForm'))
      .get(PDFName.of('NeedAppearances'));
    expect(needAppearances).toBe(PDFBool.True);
  });
});

describe('writeLayered vs writeTemplate', () => {
  it('writeLayered sets the field value; writeTemplate leaves it empty', async () => {
    const { pdfDoc: doc1, geometry } = await blankPage(0);
    const placement = named(createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }), 'x');
    const filled = updatePlacement([placement], placement.id, { value: 'Hello' })[0];

    const layeredBytes = await writeLayered(doc1, [filled], [geometry]);
    const layered = await PDFDocument.load(layeredBytes);
    expect(layered.getForm().getTextField('x').getText()).toBe('Hello');

    const { pdfDoc: doc2 } = await blankPage(0);
    const templateBytes = await writeTemplate(doc2, [filled], [geometry]);
    const template = await PDFDocument.load(templateBytes);
    expect(template.getForm().getTextField('x').getText()).toBeUndefined();
  });
});

describe('writeFields — check, dropdown and radio (build stage 10)', () => {
  it('creates a checkbox and checks it in layered mode, leaves it unchecked in template mode', async () => {
    const rect = { x: 10, y: 10, w: 20, h: 20 };
    const ticked = named(createPlacement({ page: 0, type: 'check', rect }), 'agree');
    const filled = updatePlacement([ticked], ticked.id, { value: true })[0];

    const { pdfDoc: doc1, geometry: g1 } = await blankPage(0);
    const layeredBytes = await writeLayered(doc1, [filled], [g1]);
    const layered = await PDFDocument.load(layeredBytes);
    expect(layered.getForm().getCheckBox('agree').isChecked()).toBe(true);

    const { pdfDoc: doc2, geometry: g2 } = await blankPage(0);
    const templateBytes = await writeTemplate(doc2, [filled], [g2]);
    const template = await PDFDocument.load(templateBytes);
    expect(template.getForm().getCheckBox('agree').isChecked()).toBe(false);
  });

  it('sets a dropdown\'s options and selects the value in layered mode', async () => {
    const rect = { x: 10, y: 10, w: 100, h: 20 };
    const placement = named(createPlacement({ page: 0, type: 'dropdown', rect }), 'state');
    placement.options = ['NSW', 'VIC', 'QLD'];
    placement.value = 'VIC';

    const { pdfDoc, geometry } = await blankPage(0);
    const bytes = await writeLayered(pdfDoc, [placement], [geometry]);
    const doc = await PDFDocument.load(bytes);
    const dropdown = doc.getForm().getDropdown('state');

    expect(dropdown.getOptions()).toEqual(['NSW', 'VIC', 'QLD']);
    expect(dropdown.getSelected()).toEqual(['VIC']);
  });

  it('creates one radio group with a widget per option, at the right optionValue', async () => {
    const email = named(
      createPlacement({ page: 0, type: 'radio', rect: { x: 10, y: 10, w: 16, h: 16 } }),
      'contact',
    );
    email.optionValue = 'email';
    email.value = 'email';
    const phone = named(
      createPlacement({ page: 0, type: 'radio', rect: { x: 50, y: 10, w: 16, h: 16 } }),
      'contact',
    );
    phone.optionValue = 'phone';
    phone.value = 'email';

    const { pdfDoc, geometry } = await blankPage(0);
    const bytes = await writeLayered(pdfDoc, [email, phone], [geometry]);
    const doc = await PDFDocument.load(bytes);
    const form = doc.getForm();

    expect(form.getFields()).toHaveLength(1);
    const radioGroup = form.getRadioGroup('contact');
    expect(radioGroup.acroField.getWidgets()).toHaveLength(2);

    // The widgets' own on-state keys are pdf-lib's internal auto-generated indices, not the
    // option strings — the human-readable identity lives in the field's export-values array
    // (/Opt) instead, which is what getOptions()/getSelected()/select() key off. This is what
    // optionValue exists to feed (SPEC.md, "The placement model"): each widget was added with
    // its own optionValue as pdf-lib's `option` argument, so both must be present, in the order
    // the placements were given, and the group's shared value must be the selected one.
    expect(radioGroup.getOptions()).toEqual(['email', 'phone']);
    expect(radioGroup.getSelected()).toBe('email');
  });

  it('leaves the radio group unselected in template mode', async () => {
    const email = named(
      createPlacement({ page: 0, type: 'radio', rect: { x: 10, y: 10, w: 16, h: 16 } }),
      'contact',
    );
    email.optionValue = 'email';
    email.value = 'email';

    const { pdfDoc, geometry } = await blankPage(0);
    const bytes = await writeTemplate(pdfDoc, [email], [geometry]);
    const doc = await PDFDocument.load(bytes);

    expect(doc.getForm().getRadioGroup('contact').getSelected()).toBeUndefined();
  });
});

describe('writeFields — font size (build stage 11)', () => {
  it('sets a text field\'s explicit font size', async () => {
    const placement = named(
      createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }),
      'x',
    );
    placement.fontSize = 18;

    const { pdfDoc, geometry } = await blankPage(0);
    const bytes = await writeTemplate(pdfDoc, [placement], [geometry]);
    const doc = await PDFDocument.load(bytes);

    expect(doc.getForm().getTextField('x').acroField.getDefaultAppearance()).toContain(' 18 Tf');
  });

  it('never leaves a literal 0 (auto) font size in the saved file for fontSize: 0', async () => {
    // setFontSize(0) is still called (SPEC.md's "pass 0 through to pdf-lib"), but pdf-lib marks
    // the field dirty as a side effect of calling setFontSize at all, and PDFDocument.save()
    // unconditionally regenerates a dirty field's appearance with a real computed size — verified
    // in a Node probe, since this isn't one of SPEC.md's own verified claims. So "passing 0
    // through" doesn't survive as literal 0 in the output regardless of what we do here; what
    // actually still delivers the auto-size intent to a real viewer is NeedAppearances, which
    // tells a compliant one to disregard our baked appearance and /DA and compute its own.
    const placement = named(
      createPlacement({ page: 0, type: 'text', rect: { x: 10, y: 10, w: 100, h: 20 } }),
      'x',
    );
    // fontSize already defaults to 0 from createPlacement.

    const { pdfDoc, geometry } = await blankPage(0);
    const bytes = await writeTemplate(pdfDoc, [placement], [geometry]);
    const doc = await PDFDocument.load(bytes);

    const da = doc.getForm().getTextField('x').acroField.getDefaultAppearance();
    const [, size] = da.match(/(\d+(?:\.\d+)?) Tf/);
    expect(Number(size)).toBeGreaterThan(0);
  });
});
