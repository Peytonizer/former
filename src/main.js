// Entry point — wires the UI to the pipeline: doc.js, render.js and, from this stage, the
// editor overlay in editor/canvas.js. Placements.js's placement list is the single source of
// document state (`placements`, below); every other piece of state here is transient UI state.
import { createEditorCanvas } from './editor/canvas.js';
import { visualSize } from './geometry.js';
import { loadDocument } from './doc.js';
import { buildThumbnailRail, openForRendering, renderPageInto, setActiveThumbnail } from './render.js';

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
  build: document.querySelector('[data-build]'),
};

if (els.build) els.build.textContent = import.meta.env.VITE_COMMIT_SHA;

/** @type {{ task: import('pdfjs-dist').PDFDocumentLoadingTask, pdfJsDoc: object } | null} */
let current = null;
/** @type {import('./doc.js').DocPageGeometry[]} */
let pageGeometries = [];
/** @type {import('./placements.js').Placement[]} */
let placements = [];
let thumbnailButtons = [];
let pageIndex = 0;
let zoomIndex = DEFAULT_ZOOM_INDEX;

const editor = createEditorCanvas({
  overlay: els.overlay,
  getPlacements: () => placements,
  getPageIndex: () => pageIndex,
  getVisualHeight: () => visualSize(pageGeometries[pageIndex]).height,
  getScale: () => ZOOM_STEPS[zoomIndex],
  onChange: (next) => {
    placements = next;
  },
  onSelectionChange: (id) => {
    els.duplicate.disabled = !id;
    els.deletePlacement.disabled = !id;
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
    return;
  }

  if (current) await current.task.destroy();
  current = await openForRendering(bytes);
  pageGeometries = result.pages;
  placements = [];
  pageIndex = 0;
  zoomIndex = DEFAULT_ZOOM_INDEX;

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
