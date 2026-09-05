/**
 * render.js — pdf.js page rendering and the thumbnail rail.
 *
 * Not unit-tested (there is no render.test.js in SPEC.md's fixture set): this module is DOM and
 * pdf.js glue, and its correctness is what the page looks like — verified by running the dev
 * server and looking, not by asserting on canvas pixels. `geometry.js` is the tested part of
 * the coordinate story; this module only has to hand pdf.js a scale and a page index; pdf.js
 * applies /Rotate itself when it builds a viewport, so the canvas it produces is already in
 * visual space.
 *
 * See CLAUDE.md's "DIAGNOSING IN A BROWSER" note before assuming a stalled render is a bug here:
 * a backgrounded tab suspends requestAnimationFrame, and `page.render(...).promise` never
 * settles in a hidden tab — no error, nothing in the console.
 */
// Must run before the `pdfjs-dist` import below, which calls `Map.prototype.getOrInsertComputed`
// at the top of its own module graph on some code paths — see mapUpsertPolyfill.js.
import './mapUpsertPolyfill.js';
import * as pdfjs from 'pdfjs-dist';

// A constructed worker (via pdfWorkerEntry.js), not a bare `workerSrc` URL, so the worker's own
// realm gets its own copy of the same polyfill before pdfjs-dist's worker script runs in it —
// see pdfWorkerEntry.js and mapUpsertPolyfill.js for why.
pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorkerEntry.js', import.meta.url), {
  type: 'module',
});

/**
 * Start a pdf.js loading task for `bytes` and wait for the document.
 *
 * pdf.js detaches the buffer it is handed, which would leave the caller holding an emptied
 * array if it were the same one `doc.js` already loaded with pdf-lib — so pass a copy, not the
 * original. The loading task, not the document proxy, owns the document's lifetime: call
 * `task.destroy()` on it when done. `doc.destroy()` does not exist.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ task: import('pdfjs-dist').PDFDocumentLoadingTask, pdfJsDoc: import('pdfjs-dist').PDFDocumentProxy }>}
 */
export async function openForRendering(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const pdfJsDoc = await task.promise;
  return { task, pdfJsDoc };
}

/**
 * Render one page into an existing canvas at the given zoom scale (pdf.js's points-to-pixels
 * factor — 1 means one CSS pixel per point). Resizes the canvas to fit.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfJsDoc
 * @param {number} pageIndex  0-based, matching Placement.page
 * @param {HTMLCanvasElement} canvas
 * @param {{ scale: number }} options
 * @returns {Promise<import('pdfjs-dist').PageViewport>}
 */
export async function renderPageInto(pdfJsDoc, pageIndex, canvas, { scale }) {
  const page = await pdfJsDoc.getPage(pageIndex + 1); // pdf.js pages are 1-based
  const viewport = page.getViewport({ scale });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();
  return viewport;
}

/**
 * A page's un-rotated width in points, for sizing a thumbnail before it is rendered.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfJsDoc
 * @param {number} pageIndex
 */
async function nativeWidth(pdfJsDoc, pageIndex) {
  const page = await pdfJsDoc.getPage(pageIndex + 1);
  return page.getViewport({ scale: 1 }).width;
}

/**
 * Build a thumbnail rail: one small rendered canvas per page, each wrapped in a button, appended
 * into `container`. Rendered sequentially — thumbnails are wanted in order anyway, and
 * rendering every page of a long document at once holds all of them in memory simultaneously.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfJsDoc
 * @param {HTMLElement} container
 * @param {{ onSelect?: (pageIndex:number) => void, width?: number }} [options]
 * @returns {Promise<HTMLButtonElement[]>}
 */
export async function buildThumbnailRail(pdfJsDoc, container, { onSelect, width = 96 } = {}) {
  const fragment = document.createDocumentFragment();
  const buttons = [];

  for (let i = 0; i < pdfJsDoc.numPages; i += 1) {
    // oxlint-disable-next-line no-await-in-loop
    const nw = await nativeWidth(pdfJsDoc, i);
    const canvas = document.createElement('canvas');
    // oxlint-disable-next-line no-await-in-loop
    await renderPageInto(pdfJsDoc, i, canvas, { scale: width / nw });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumbnail';
    button.dataset.page = String(i);
    button.setAttribute('aria-label', `Page ${i + 1}`);
    button.append(canvas);
    button.addEventListener('click', () => onSelect?.(i));

    buttons.push(button);
    fragment.append(button);
  }

  container.replaceChildren(fragment);
  return buttons;
}

/** Mark which thumbnail is current; clears the mark from every other one. */
export function setActiveThumbnail(buttons, pageIndex) {
  for (const button of buttons) {
    button.classList.toggle('active', Number(button.dataset.page) === pageIndex);
  }
}
