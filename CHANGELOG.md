# Changelog

All notable changes to former are recorded here. One line per meaningful change; version
headings are cut when a meaningful chunk of work lands, not on every commit.

## Unreleased

- Project scaffolded: README, changelog, licence and the ignore rules, ahead of the first
  build stage.
- Build stage 1: `package.json` (Vite, Vitest, oxlint, pdf-lib, pdfjs-dist, the self-hosted
  fonts), `vite.config.js` with the build-time CSP injection copied from lodger, `CNAME`, and an
  `index.html` shell with a placeholder `main.js` and a minimal `style.css`. No deploy workflow
  yet — that lands at stage 18.
- Build stage 2: `geometry.js`, copied from lodger — the visual/user-space transform and
  rotation normalisation — plus `visualFromUser`, which former needs for importing existing
  AcroForm widgets and lodger never did. Tested against all four rotations, a non-zero CropBox
  origin, and the worked example from SPEC.md.
- Build stage 3: the fixture generator and its seven PDF/image fixtures (flat, rotated, cropped,
  an existing AcroForm, encrypted, zero-page, and a synthetic signature/JPEG/HEIC trio), verified
  against pdf-lib in a Node probe.
- Build stage 4: `doc.js` (load a PDF, refuse an encrypted, corrupt or zero-page document, extract
  per-page CropBox/rotation geometry) and `placements.js` (the pure placement-list model: create,
  update, remove, duplicate, group by name, and the shared-name/different-type conflict check),
  both with full test coverage.
- Build stage 5: `render.js` wires up pdf.js — one page on screen, a thumbnail rail, zoom and page
  navigation — with `main.js` driving it from `doc.js`'s load result. Verified in a real browser
  that a fixture rectangle lands at the same visual position across all four page rotations.
