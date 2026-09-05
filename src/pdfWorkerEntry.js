/**
 * pdfWorkerEntry.js — a thin wrapper around pdfjs-dist's own worker script, whose only job is
 * to install mapUpsertPolyfill.js before that script runs, in the worker's own JS realm — see
 * that file for why. A dynamic import, not a static one: static imports are hoisted and
 * evaluate before this module's own top-level statements run, which would install the polyfill
 * too late. The dynamic import below only starts once the polyfill above it has already run.
 *
 * Loaded via render.js's `new Worker(new URL(...), { type: 'module' })`, not pdfjs-dist's own
 * `workerSrc` (a plain URL to its file, which is how render.js pointed at the worker before this
 * existed) — `GlobalWorkerOptions.workerPort` takes an already-constructed `Worker` instead, so
 * this file can run first inside it.
 */
import './mapUpsertPolyfill.js';

await import('pdfjs-dist/build/pdf.worker.min.mjs');
