// Entry point — wires the UI to the pipeline: doc.js, render.js and, from this stage, the
// editor overlay in editor/canvas.js. Placements.js's placement list is the single source of
// document state (`placements`, below); every other piece of state here is transient UI state.
//
// The three typefaces are self-hosted via @fontsource — never a font CDN link, which the CSP
// blocks outright and which SPEC.md rules out for the same privacy reason as every other network
// request. Weights are limited to what the UI actually sets (see style.css's --font-* uses)
// rather than importing every cut Fraunces Variable ships, to keep the bundle down.
import '@fontsource-variable/fraunces/full.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-mono/400.css';

import { PDFDocument } from 'pdf-lib';

import { hasExistingFields, importExistingFields } from './acroform.js';
import { createEditorCanvas } from './editor/canvas.js';
import { createPropertiesPanel } from './editor/properties.js';
import { visualSize } from './geometry.js';
import { loadDocument } from './doc.js';
import { buildThumbnailRail, openForRendering, renderPageInto, setActiveThumbnail } from './render.js';
import { embedSubsetFont, fullFontByteSize } from './fonts.js';
import {
  createSignaturePad,
  deleteSignature,
  hasNoTransparency,
  listSignatures,
  loadSignature,
  saveSignature,
  sniffImageType,
} from './signature.js';
import { compareSidecar, createSidecar, parseSidecar, serialiseSidecar } from './sidecar.js';
import { collectWarnings } from './warnings.js';
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
  signatureList: document.querySelector('[data-signature-list]'),
  signatureCanvas: document.querySelector('[data-signature-canvas]'),
  signatureClearPad: document.querySelector('[data-signature-clear-pad]'),
  signatureLabel: document.querySelector('[data-signature-label]'),
  signatureSaveDrawn: document.querySelector('[data-signature-save-drawn]'),
  signatureUpload: document.querySelector('[data-signature-upload]'),
  signatureMessage: document.querySelector('[data-signature-message]'),
  importPrompt: document.querySelector('[data-import-prompt]'),
  importPromptText: document.querySelector('[data-import-prompt-text]'),
  importFields: document.querySelector('[data-import-fields]'),
  skipImport: document.querySelector('[data-skip-import]'),
  saveSidecar: document.querySelector('[data-save-sidecar]'),
  loadSidecar: document.querySelector('[data-load-sidecar]'),
  sidecarMessage: document.querySelector('[data-sidecar-message]'),
  exportWarnings: document.querySelector('[data-export-warnings]'),
  exportWarningsList: document.querySelector('[data-export-warnings-list]'),
  proceedExport: document.querySelector('[data-proceed-export]'),
  cancelExport: document.querySelector('[data-cancel-export]'),
  previewFilled: document.querySelector('[data-preview-filled]'),
  previewLayered: document.querySelector('[data-preview-layered]'),
  previewTemplate: document.querySelector('[data-preview-template]'),
  previewBar: document.querySelector('[data-preview-bar]'),
  previewLabel: document.querySelector('[data-preview-label]'),
  previewPrev: document.querySelector('[data-preview-prev]'),
  previewNext: document.querySelector('[data-preview-next]'),
  closePreview: document.querySelector('[data-close-preview]'),
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
/** The pdf-lib document doc.js already parsed, held only while the import prompt is showing. */
let pendingImportDoc = null;
/** @type {{ task: import('pdfjs-dist').PDFDocumentLoadingTask, pdfJsDoc: object } | null} */
let previewTask = null;
let previewPageIndex = 0;

// Shared by both the canvas and the properties panel, so a change made in either place is
// reflected in the other: the panel can rename or re-value a placement whose label the canvas
// draws, and the canvas can move or delete one the panel is currently showing.
function handlePlacementsChange(next) {
  placements = next;
  editor.render();
}

/** @type {import('./signature.js').StoredSignature[]} */
let savedSignatures = [];

const properties = createPropertiesPanel({
  container: els.properties,
  getPlacements: () => placements,
  getSignatures: () => savedSignatures,
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
  onActivate: () => properties.focus(),
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
    els.saveSidecar.disabled = true;
    els.previewFilled.disabled = true;
    els.previewLayered.disabled = true;
    els.previewTemplate.disabled = true;
    return;
  }

  if (current) await current.task.destroy();
  await closePreview();
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
  els.saveSidecar.disabled = false;
  els.previewFilled.disabled = false;
  els.previewLayered.disabled = false;
  els.previewTemplate.disabled = false;
  els.sidecarMessage.textContent = '';

  // Detected via the same pdf-lib document doc.js already loaded to read page geometry — a
  // separate parse isn't needed just to ask getForm().getFields(). SPEC.md, "Existing AcroForm
  // fields": offer to import rather than silently drawing over a form that already works.
  if (hasExistingFields(result.pdfDoc)) {
    pendingImportDoc = result.pdfDoc;
    const count = result.pdfDoc.getForm().getFields().length;
    els.importPromptText.textContent = `This PDF already has ${count} form field${count === 1 ? '' : 's'}. Import them as placements you can edit, or start blank and leave them alone.`;
    els.importPrompt.hidden = false;
  } else {
    pendingImportDoc = null;
    els.importPrompt.hidden = true;
  }

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
    // A keyboard user who just picked a create tool needs somewhere to press Enter — the
    // overlay isn't a normal Tab stop (see editor/canvas.js), so this is how it's reached.
    if (button.dataset.tool !== 'select') editor.focusOverlay();
  });
}

els.duplicate.addEventListener('click', () => editor.duplicateSelected());
els.deletePlacement.addEventListener('click', () => editor.deleteSelected());

els.importFields.addEventListener('click', () => {
  if (!pendingImportDoc) return;
  const { placements: imported, unsupported } = importExistingFields(pendingImportDoc, pageGeometries);
  handlePlacementsChange([...placements, ...imported]);
  els.importPrompt.hidden = true;
  pendingImportDoc = null;
  if (unsupported.length > 0) {
    setMessage(
      `Imported ${imported.length} field widget(s). ${unsupported.length} button/option-list field(s) — ${unsupported.join(', ')} — aren't supported and are left untouched.`,
    );
  }
});

els.skipImport.addEventListener('click', () => {
  els.importPrompt.hidden = true;
  pendingImportDoc = null;
});

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

/** Every export re-parses a fresh document — see the comment on `sourceBytes` above. The
 * resolved signature map is harmless to pass to writeLayered/writeTemplate too; neither declares
 * a fourth parameter, so they simply ignore it. */
async function runExport(writer, suffix) {
  if (!sourceBytes) return;
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const signatureImages = await resolveSignatureImages();
  const bytes = await writer(pdfDoc, placements, pageGeometries, signatureImages);
  downloadBytes(bytes, derivedFileName(sourceFileName, suffix));
}

/** Holds the export a warning is currently blocking, so "Export anyway" knows what to run. */
let pendingExport = null;

/**
 * Check `placements` against `mode` (SPEC.md's warnings table) before writing anything. With
 * nothing to say, exports immediately — the common case stays frictionless. With something to
 * say, shows it and waits for an explicit "Export anyway" or "Cancel" instead of running.
 */
async function withWarningsChecked(writer, suffix, mode) {
  if (!sourceBytes) return;

  const signatureMimeTypes = new Map(savedSignatures.map((s) => [s.id, s.mimeType]));
  // Auto-fit overflow is filled-mode only and needs a font to measure with; a throwaway embed
  // on an otherwise-empty document is cheap next to actually writing the export.
  const filledFont = mode === 'filled' ? await embedSubsetFont(await PDFDocument.create()) : undefined;

  const warnings = collectWarnings(placements, pageGeometries, mode, { signatureMimeTypes, filledFont });

  if (warnings.length === 0) {
    await runExport(writer, suffix);
    return;
  }

  pendingExport = { writer, suffix };
  els.exportWarningsList.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w.message;
      return li;
    }),
  );
  els.exportWarnings.hidden = false;
}

els.exportFilled.addEventListener('click', () => withWarningsChecked(writeFilled, 'filled', 'filled'));
els.exportLayered.addEventListener('click', () => withWarningsChecked(writeLayered, 'layered', 'layered'));
els.exportTemplate.addEventListener('click', () => withWarningsChecked(writeTemplate, 'template', 'template'));

els.proceedExport.addEventListener('click', async () => {
  if (!pendingExport) return;
  const { writer, suffix } = pendingExport;
  pendingExport = null;
  els.exportWarnings.hidden = true;
  await runExport(writer, suffix);
});

els.cancelExport.addEventListener('click', () => {
  pendingExport = null;
  els.exportWarnings.hidden = true;
});

// --- Preview the output ------------------------------------------------------------------------
// SPEC.md, "Preview and the editor surface": renders the exported bytes back through pdf.js, so
// a geometry regression is caught before a user finds it. It never computes a placement of its
// own — the whole point is to trust the same bytes an export would actually produce, not a
// second calculation that could quietly drift from the first.

async function renderPreviewPage(index) {
  if (!previewTask) return;
  previewPageIndex = Math.max(0, Math.min(previewTask.pdfJsDoc.numPages - 1, index));
  await renderPageInto(previewTask.pdfJsDoc, previewPageIndex, els.canvas, { scale: ZOOM_STEPS[zoomIndex] });
  els.previewLabel.textContent = `page ${previewPageIndex + 1} of ${previewTask.pdfJsDoc.numPages}`;
}

/** Back to the live editor: closes the preview task and redraws the actual current page. */
async function closePreview() {
  if (!previewTask) return;
  await previewTask.task.destroy();
  previewTask = null;
  els.overlay.hidden = false;
  els.previewBar.hidden = true;
  if (current) await showPage(pageIndex);
}

async function showPreview(writer, label) {
  if (!sourceBytes) return;
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const signatureImages = await resolveSignatureImages();
  const bytes = await writer(pdfDoc, placements, pageGeometries, signatureImages);

  if (previewTask) await previewTask.task.destroy();
  previewTask = await openForRendering(bytes);
  previewPageIndex = 0;

  els.overlay.hidden = true; // the placement layer describes the editor's page, not the preview's
  els.previewBar.hidden = false;
  els.previewLabel.textContent = `${label} — page 1 of ${previewTask.pdfJsDoc.numPages}`;
  await renderPreviewPage(0);
}

els.previewFilled.addEventListener('click', () => showPreview(writeFilled, 'filled export'));
els.previewLayered.addEventListener('click', () => showPreview(writeLayered, 'layered export'));
els.previewTemplate.addEventListener('click', () => showPreview(writeTemplate, 'template export'));
els.previewPrev.addEventListener('click', () => renderPreviewPage(previewPageIndex - 1));
els.previewNext.addEventListener('click', () => renderPreviewPage(previewPageIndex + 1));
els.closePreview.addEventListener('click', () => closePreview());

// --- Signatures ------------------------------------------------------------------------------
// Independent of any loaded document — signatures are saved once and reused across sessions
// (SPEC.md, "Signature storage"), so this section works whether or not a PDF is open.

function setSignatureMessage(text) {
  els.signatureMessage.textContent = text ?? '';
}

async function refreshSignatureList() {
  savedSignatures = await listSignatures();

  els.signatureList.replaceChildren(
    ...savedSignatures.map((signature) => {
      const item = document.createElement('div');
      item.className = 'signature-item';

      const img = document.createElement('img');
      img.alt = signature.label;
      img.src = URL.createObjectURL(new Blob([signature.bytes], { type: signature.mimeType }));

      const label = document.createElement('span');
      label.textContent = signature.label;

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = '✕';
      clear.setAttribute('aria-label', `Clear "${signature.label}"`);
      clear.addEventListener('click', async () => {
        await deleteSignature(signature.id);
        await refreshSignatureList();
      });

      item.append(img, label, clear);
      return item;
    }),
  );

  properties.render(); // the "which signature" picker's option list may have just changed
}

const signaturePad = createSignaturePad(els.signatureCanvas);

els.signatureClearPad.addEventListener('click', () => signaturePad.clear());

els.signatureSaveDrawn.addEventListener('click', async () => {
  if (signaturePad.isEmpty()) {
    setSignatureMessage('Draw a signature first.');
    return;
  }
  const bytes = await signaturePad.toPngBytes();
  await saveSignature({
    id: crypto.randomUUID(),
    label: els.signatureLabel.value.trim() || 'Signature',
    mimeType: 'image/png',
    bytes,
  });
  signaturePad.clear();
  els.signatureLabel.value = '';
  setSignatureMessage('');
  await refreshSignatureList();
});

els.signatureUpload.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.value = ''; // so choosing the same file again still fires 'change'

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniffImageType(bytes);
  if (!mimeType) {
    setSignatureMessage('That file is not a PNG or JPEG. Re-export it as one of those and try again.');
    return;
  }

  await saveSignature({ id: crypto.randomUUID(), label: els.signatureLabel.value.trim() || 'Signature', mimeType, bytes });
  els.signatureLabel.value = '';
  setSignatureMessage(
    hasNoTransparency(mimeType)
      ? 'Saved. Note: a JPEG has no transparency, so it will carry a white box over whatever is under it.'
      : '',
  );
  await refreshSignatureList();
});

await refreshSignatureList();

/** Every signature placement's imageId that has something saved, resolved to its bytes — the
 * shape writeFilled.js's signatureImages parameter wants. Only filled mode ever draws one. */
async function resolveSignatureImages() {
  const ids = new Set(placements.filter((p) => p.type === 'signature' && p.imageId).map((p) => p.imageId));
  const map = new Map();
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop
    const stored = await loadSignature(id);
    if (stored) map.set(id, stored.bytes);
  }
  return map;
}

// --- Sidecar -----------------------------------------------------------------------------------

function setSidecarMessage(text) {
  els.sidecarMessage.textContent = text ?? '';
}

/** filename.pdf -> filename.sidecar.json */
function sidecarFileName(originalName) {
  const dot = originalName.lastIndexOf('.');
  const stem = dot === -1 ? originalName : originalName.slice(0, dot);
  return `${stem}.sidecar.json`;
}

els.saveSidecar.addEventListener('click', async () => {
  if (!sourceBytes) return;
  const json = serialiseSidecar(await createSidecar(sourceBytes, pageGeometries, placements));
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = sidecarFileName(sourceFileName);
  link.click();
  URL.revokeObjectURL(url);
});

els.loadSidecar.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  event.target.value = ''; // so choosing the same file again still fires 'change'

  if (!sourceBytes) {
    setSidecarMessage('Open the PDF this sidecar belongs to first.');
    return;
  }

  let sidecar;
  try {
    sidecar = parseSidecar(await file.text());
  } catch (error) {
    setSidecarMessage(`That doesn't look like a former sidecar: ${error.message}`);
    return;
  }

  const outcome = await compareSidecar(sidecar, sourceBytes, pageGeometries);
  if (outcome === 'refuse') {
    setSidecarMessage(
      `This sidecar was saved against a ${sidecar.source.pageCount}-page document; this one doesn't match closely enough. Not attaching it.`,
    );
    return;
  }

  handlePlacementsChange(sidecar.placements);
  properties.select(null);

  const missingSignatures = sidecar.placements.filter(
    (p) => p.type === 'signature' && p.imageId && !savedSignatures.some((s) => s.id === p.imageId),
  ).length;

  const parts = [];
  if (outcome === 'changed') {
    parts.push('The document has changed since this sidecar was saved — check every placement.');
  }
  if (missingSignatures > 0) {
    parts.push(
      `${missingSignatures} signature placement(s) need their image reselected — it's no longer saved in this browser.`,
    );
  }
  setSidecarMessage(parts.join(' ') || 'Sidecar attached.');
});
