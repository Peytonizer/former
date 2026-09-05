// Entry point — wires the UI to the pipeline (doc.js, placements.js, render.js, editor/*).
// Stage 1 scaffold only: nothing here yet but the build's commit stamp in the footer.

const buildEl = document.querySelector('[data-build]');
if (buildEl) {
  buildEl.textContent = import.meta.env.VITE_COMMIT_SHA;
}
