// Entry point — wires the UI to the pipeline: doc.js, render.js and, from this stage, the
// editor overlay in editor/canvas.js. Placements.js's placement list is the single source of
// document state (`placements`, below); every other piece of state here is transient UI state.
import { PDFDocument } from 'pdf-lib';

import { createEditorCanvas } from './editor/canvas.js';
import { createPropertiesPanel } from './editor/properties.js';
import { visualSize } from './geometry.js';
import { loadDocument } from './doc.js';
import { buildThumbnailRail, openForRendering, renderPageInto, setActiveThumbnail } from './render.js';
import { fullFontByteSize } from './fonts.js';
import { writeFilled } from './writeFilled.js';
import { writeLayered, writeTemplate } from './writeFields.js';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const DEFAULT_ZOOM_INDEX = 2; // 1x

const REFUSAL_MESSAGES = {
  encrypted: 'This PDF is password-protected. Remove the protection in the tool that made it, then try again.',
  corrupt: 'This file could not be read as a PDF.',
  'zero-pages': (result) => `This PDF has no pages (found ${result.pageCount}).`,
};

const els = {
  input: document.querySelector('[data-input]'),
  pickerValue: document.querySelector('[data-value]'),
  messages: document.querySelector('[data-messages]'),
  viewer: document.querySelector('[data-viewer]'),
  thumbnails: document.querySelector('[data-thumbnails]'),
  canvas: document.querySelector('[data-page-canvas]'),
  overlay: document.querySelector('[data-overlay]'),
  pageLabel: document.querySelector('[data-page-label]'),
  zoomLabel: document.querySelector('[data-zoom-label]'),
  prevPage: document.querySelector('[data-prev-page]'),
  nextPage: document.querySelector('[data-next-page]'),
  zoomIn: document.querySelector('[data-zoom-in]'),
  zoomOut: document.querySelector('[data-zoom-out]'),
  tools: [...document.querySelectorAll('[data-tool]')],
  duplicate: document.querySelector('[data-duplicate-placement]'),
  deletePlacement: document.querySelector('[data-delete-placement]'),
  exportFilled: document.querySelector('[data-export-filled]'),
  exportLayered: document.querySelector('[data-export-layered]'),
  exportTemplate: document.querySelector('[data-export-template]'),
  exportSizeNote: document.querySelector('[data-export-size-note]'),
  properties: document.querySelector('[data-properties]'),
  build: document.querySelector('[data-build]'),
};

if (els.build) els.build.textContent = import.meta.env.VITE_COMMIT_SHA;

// An honest size estimate up front (SPEC.md, "Fonts") — the full font embed layered and
// template both need is several hundred kilobytes, and a user who doesn't know why would
// otherwise assume the export is broken. Filled mode subsets, so it isn't quoted here.
if (els.exportSizeNote) {
  const kb = Math.round(fullFontByteSize() / 1024);
  els.exportSizeNote.textContent = ` Layered and template each add ~${kb} KB for the full font embed.`;
}

/** @type {{ task: import('pdfjs-dist').PDFDocumentLoadingTask, pdfJsDoc: object } | null} */
let current = null;
/** The original file bytes, kept so every export re-parses a fresh pdf-lib document rather than
 * writing into one that a previous export already mutated. */
let sourceBytes = null;
let sourceFileName = 'document.pdf';
/** @type {import('./doc.js').DocPageGeometry[]} */
let pageGeometries = [];
/** @type {import('./placements.js').Placement[]} */
let placements = [];
let thumbnailButtons = [];
let pageIndex = 0;
let zoomIndex = DEFAULT_ZOOM_INDEX;

// Shared by both the canvas and the properties panel, so a change made in either place is
// reflected in the other: the panel can rename or re-value a placement whose label the canvas
// draws, and the canvas can move or delete one the panel is currently showing.
function handlePlacementsChange(next) {
  placements = next;
  editor.render();
}

const properties = createPropertiesPanel({
  container: els.properties,
  getPlacements: () => placements,
  onChange: handlePlacementsChange,
});

const editor = createEditorCanvas({
  overlay: els.overlay,
  getPlacements: () => placements,
  getPageIndex: () => pageIndex,
  getVisualHeight: () => visualSize(pageGeometries[pageIndex]).height,
  getScale: () => ZOOM_STEPS[zoomIndex],
  onChange: handlePlacementsChange,
  onSelectionChange: (id) => {
    els.duplicate.disabled = !id;
    els.deletePlacement.disabled = !id;
    properties.select(id);
  },
});

function setMessage(text) {
  els.messages.textContent = text ?? '';
}

async function openFile(file) {
  setMessage('');
  els.pickerValue.textContent = file.name;

  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await loadDocument(bytes);
  if (!result.ok) {
    const message = REFUSAL_MESSAGES[result.reason];
    setMessage(typeof message === 'function' ? message(result) : message);
    els.viewer.hidden = true;
    els.exportFilled.disabled = true;
    els.exportLayered.disabled = true;
    els.exportTemplate.disabled = true;
    return;
  }

  if (current) await current.task.destroy();
  current = await openForRendering(bytes);
  sourceBytes = bytes;
  sourceFileName = file.name;
  pageGeometries = result.pages;
  placements = [];
  properties.select(null);
  pageIndex = 0;
  zoomIndex = DEFAULT_ZOOM_INDEX;
  els.exportFilled.disabled = false;
  els.exportLayered.disabled = false;
  els.exportTemplate.disabled = false;

  thumbnailButtons = await buildThumbnailRail(current.pdfJsDoc, els.thumbnails, {
    onSelect: (index) => showPage(index),
  });

  els.viewer.hidden = false;
  await showPage(0);
}

async function showPage(index) {
  if (!current) return;
  pageIndex = Math.max(0, Math.min(current.pdfJsDoc.numPages - 1, index));
  await renderPageInto(current.pdfJsDoc, pageIndex, els.canvas, { scale: ZOOM_STEPS[zoomIndex] });
  setActiveThumbnail(thumbnailButtons, pageIndex);
  els.pageLabel.textContent = `Page ${pageIndex + 1} of ${current.pdfJsDoc.numPages}`;
  els.zoomLabel.textContent = `${Math.round(ZOOM_STEPS[zoomIndex] * 100)}%`;
  editor.render();
}

els.input.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) openFile(file);
});

els.prevPage.addEventListener('click', () => showPage(pageIndex - 1));
els.nextPage.addEventListener('click', () => showPage(pageIndex + 1));

els.zoomOut.addEventListener('click', () => {
  zoomIndex = Math.max(0, zoomIndex - 1);
  showPage(pageIndex);
});
els.zoomIn.addEventListener('click', () => {
  zoomIndex = Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1);
  showPage(pageIndex);
});

for (const button of els.tools) {
  button.addEventListener('click', () => {
    editor.setTool(button.dataset.tool);
    for (const other of els.tools) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

els.duplicate.addEventListener('click', () => editor.duplicateSelected());
els.deletePlacement.addEventListener('click', () => editor.deleteSelected());

/** filename.pdf -> filename-filled.pdf, for a download name that says what it is. */
function derivedFileName(originalName, suffix) {
  const dot = originalName.lastIndexOf('.');
  return dot === -1 ? `${originalName}-${suffix}` : `${originalName.slice(0, dot)}-${suffix}${originalName.slice(dot)}`;
}

/** Save bytes to disk via a throwaway <a download>; blob: URLs need no network permission. */
function downloadBytes(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Every export re-parses a fresh document — see the comment on `sourceBytes` above. */
async function withFreshDocument(writer, suffix) {
  if (!sourceBytes) return;
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const bytes = await writer(pdfDoc, placements, pageGeometries);
  downloadBytes(bytes, derivedFileName(sourceFileName, suffix));
}

els.exportFilled.addEventListener('click', () => withFreshDocument(writeFilled, 'filled'));
els.exportLayered.addEventListener('click', () => withFreshDocument(writeLayered, 'layered'));
els.exportTemplate.addEventListener('click', () => withFreshDocument(writeTemplate, 'template'));
