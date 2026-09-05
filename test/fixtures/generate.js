/**
 * Generates every fixture in this directory. Run with `npm run fixtures`.
 *
 * The fixtures are generated rather than collected so that they are unambiguously synthetic —
 * this is a public repo and a real form, a real signature or anything carrying a real name must
 * never end up in its history — and so that a fixture can be reasoned about: when a test fails
 * on `rotated.pdf`, the rectangle it expects to find is written down here rather than being a
 * property of a binary nobody can read.
 *
 * Two fixtures pdf-lib cannot produce (`zero-pages.pdf`, `encrypted.pdf`) are assembled by hand
 * from a minimal object list — see SPEC.md's notes on `PDFDocument.create()` silently adding a
 * blank page to an empty document.
 *
 * Image fixtures are built as PNGs by the little encoder below (no image dependency), then
 * converted with macOS `sips` where a real JPEG is needed. That makes this script macOS-only,
 * which is acceptable: the fixtures are committed, so only someone regenerating them needs sips.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from 'pdf-lib';

import { userFromVisual, visualSize } from '../../src/geometry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = (name) => join(HERE, name);

// ---------------------------------------------------------------------------------------------
// PDFs
// ---------------------------------------------------------------------------------------------

/** Draws a hairline border and a label so a rendered page can be told apart at a glance. */
function decorate(page, label) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 12,
    y: 12,
    width: width - 24,
    height: height - 24,
    borderColor: rgb(0.75, 0.75, 0.78),
    borderWidth: 1,
  });
  page.drawText(label, { x: 28, y: height - 48, size: 16, color: rgb(0.1, 0.1, 0.12) });
}

/**
 * The user-space axis-aligned bounding box a rectangle drawn at visual `vRect` needs, on a page
 * with geometry `g`. `page.drawRectangle` is a raw content-stream rectangle with no notion of
 * "visual" space, unlike `drawText`/`drawImage` under the "Drawing under rotation" rule — a
 * plain rectangle has no inherent up direction, so mapping its four corners through
 * `userFromVisual` and taking their bounding box is enough; there is no anchor to pre-rotate.
 */
function visualRectToUserRect(g, vRect) {
  const corners = [
    userFromVisual(g, vRect.x, vRect.y),
    userFromVisual(g, vRect.x + vRect.width, vRect.y),
    userFromVisual(g, vRect.x, vRect.y + vRect.height),
    userFromVisual(g, vRect.x + vRect.width, vRect.y + vRect.height),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** 2 pages, 595x842, rotate 0, no fields — the ordinary case. */
async function makeFlatA4() {
  const doc = await PDFDocument.create();
  decorate(doc.addPage([595, 842]), 'flat-a4 — page 1');
  decorate(doc.addPage([595, 842]), 'flat-a4 — page 2');
  writeFileSync(out('flat-a4.pdf'), await doc.save());
}

/**
 * One page at each of /Rotate 0, 90, 180, 270. Every page carries a rectangle drawn at the same
 * fixed **visual** position — 10% in from the visual left edge, 15% down from the visual top,
 * 20% of visual width wide and 5% of visual height tall — so a test can assert a placement at
 * that same visual rectangle lines up with what is drawn, on every rotation.
 *
 * This is the known value referred to in SPEC.md's fixture list; a later stage's tests read
 * this comment rather than re-deriving the fraction.
 */
async function makeRotated() {
  const doc = await PDFDocument.create();
  for (const rotate of [0, 90, 180, 270]) {
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(rotate));
    decorate(page, `rotated — /Rotate ${rotate}`);

    const g = { x0: 0, y0: 0, w: 595, h: 842, rotate };
    const { width, height } = visualSize(g);
    const vRect = { x: width * 0.1, y: height * 0.8, width: width * 0.2, height: height * 0.05 };
    const uRect = visualRectToUserRect(g, vRect);
    page.drawRectangle({ ...uRect, color: rgb(0.73, 0.83, 0.93) });
  }
  writeFileSync(out('rotated.pdf'), await doc.save());
}

/** A page whose CropBox origin is not (0,0) — the assumption that quietly ruins placement. */
async function makeCropped() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([655, 932]); // an A4 area plus a 30/45pt bleed
  decorate(page, 'cropped — CropBox origin (30, 45)');
  page.node.set(
    PDFName.of('CropBox'),
    doc.context.obj([PDFNumber.of(30), PDFNumber.of(45), PDFNumber.of(625), PDFNumber.of(887)]),
  );
  writeFileSync(out('cropped.pdf'), await doc.save());
}

/** A real AcroForm — a text field, a checkbox, a dropdown and a radio group — for the import path. */
async function makeHasFields() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  decorate(page, 'has-fields');
  const form = doc.getForm();

  const name = form.createTextField('name');
  name.addToPage(page, { x: 60, y: 740, width: 220, height: 20, borderWidth: 0 });

  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 60, y: 700, width: 16, height: 16, borderWidth: 0 });

  const state = form.createDropdown('state');
  state.addOptions(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']);
  state.addToPage(page, { x: 60, y: 660, width: 100, height: 20, borderWidth: 0 });

  const contact = form.createRadioGroup('contact');
  contact.addOptionToPage('email', page, { x: 60, y: 620, width: 16, height: 16, borderWidth: 0 });
  contact.addOptionToPage('phone', page, { x: 100, y: 620, width: 16, height: 16, borderWidth: 0 });

  writeFileSync(out('has-fields.pdf'), await doc.save());
}

/**
 * Assemble a minimal PDF by hand from a list of indirect objects, with a correct cross-
 * reference table. Used for the two fixtures pdf-lib cannot produce itself.
 *
 * @param {string[]} objects  each a complete "N 0 obj ... endobj" string, in order from 1
 * @param {string} trailerEntries  the trailer dictionary's contents, without the << >>
 */
function minimalPdf(objects, trailerEntries) {
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} ${trailerEntries} >>\n`;
  pdf += `startxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

/**
 * A structurally valid PDF with no pages at all.
 *
 * Hand-written because pdf-lib cannot make one: `PDFDocument.create()` starts with zero pages,
 * but `save()` silently adds a blank A4 page to an empty document, so a fixture built the
 * obvious way is a one-page PDF that quietly passes the test it was meant to fail.
 */
function makeZeroPages() {
  writeFileSync(
    out('zero-pages.pdf'),
    minimalPdf(
      [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
      ],
      '/Root 1 0 R',
    ),
  );
}

/**
 * A PDF whose trailer declares an /Encrypt dictionary.
 *
 * Hand-written because pdf-lib cannot produce encrypted output and qpdf isn't a dependency
 * worth adding for one fixture. It is enough for its purpose: pdf-lib decides a document is
 * encrypted by looking for /Encrypt in the trailer, so this exercises the real refusal path.
 * The document is not actually encrypted, and former never attempts to decrypt anything.
 */
function makeEncrypted() {
  writeFileSync(
    out('encrypted.pdf'),
    minimalPdf(
      [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n',
        '4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -1 >>\nendobj\n',
      ],
      '/Root 1 0 R /Encrypt 4 0 R',
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// A minimal PNG encoder. Enough for flat-coloured test artwork, and it means the fixture
// generator has no image dependency of its own.
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** @param {{width:number, height:number, rgba:(x:number,y:number)=>[number,number,number,number]}} spec */
function encodePng({ width, height, rgba }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; // filter type 0 (None) — simplest, and these images are tiny
    p += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = rgba(x, y);
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
      p += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True when (x, y) falls within `thickness` of the segment (x0,y0)-(x1,y1). */
function onSegment(x, y, x0, y0, x1, y1, thickness) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
  const px = x0 + t * dx;
  const py = y0 + t * dy;
  return Math.hypot(x - px, y - py) <= thickness;
}

/**
 * Stand-in artwork for a signature: two overlapping ink-coloured strokes on transparency.
 * Deliberately not a real signature.
 */
function sigPixels(width, height) {
  return (x, y) => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const onA = onSegment(cx, cy, width * 0.1, height * 0.3, width * 0.45, height * 0.75, height * 0.06);
    const onB = onSegment(cx, cy, width * 0.4, height * 0.7, width * 0.9, height * 0.25, height * 0.06);
    if (onA || onB) return [42, 31, 40, 255];
    return [0, 0, 0, 0];
  };
}

function sips(args) {
  execFileSync('/usr/bin/sips', args, { stdio: 'pipe' });
}

function makeImages() {
  const tmp = join(HERE, '.tmp');
  mkdirSync(tmp, { recursive: true });

  // With transparency, as a saved signature ought to be.
  writeFileSync(out('sig.png'), encodePng({ width: 240, height: 120, rgba: sigPixels(240, 120) }));

  // sips won't produce the opaque-white-background JPEG the warning is about from a
  // transparent source, so build an explicitly opaque one to convert.
  const opaque = encodePng({
    width: 240,
    height: 120,
    rgba: (x, y) => {
      const [r, g, b, a] = sigPixels(240, 120)(x, y);
      return a === 0 ? [255, 255, 255, 255] : [r, g, b, 255];
    },
  });
  const opaquePath = join(tmp, 'opaque.png');
  writeFileSync(opaquePath, opaque);
  sips([opaquePath, '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', '--out', out('sig.jpg')]);

  // Not an image former accepts. Just enough of an ISO base media file for the sniffer to
  // recognise the brand and name it in the refusal.
  const ftyp = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypheic', 'ascii'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('heicmif1', 'ascii'),
  ]);
  writeFileSync(out('not-an-image.heic'), ftyp);

  rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  await makeFlatA4();
  await makeRotated();
  await makeCropped();
  await makeHasFields();
  makeZeroPages();
  makeEncrypted();
  makeImages();
  console.log('fixtures written to', HERE);
}

await main();
