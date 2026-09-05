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
  Fixed a real bug found in the process: a `hidden` viewer stayed visible after a refusal,
  because an author stylesheet's `display: grid` always outranks the user-agent `[hidden]` rule
  regardless of selector specificity.
- Build stage 6: the editor surface (`editor/canvas.js`) — drag out a rectangle to create a
  placement of the selected type, select, move, resize from a corner handle, duplicate and
  delete, mouse only. Placements render as absolutely-positioned DOM elements over the page
  canvas, per SPEC.md's "Preview and the editor surface". Fixed two more bugs found while
  verifying in a browser: the editor silently reverted to the Select tool after placing
  something while the toolbar kept the create tool's button highlighted, desyncing the visible
  state from the actual one, and the toolbar overflowed unreachably off-screen at ordinary
  widths for want of `flex-wrap`.
- Build stage 7: `writeFilled.js`, the first writer — text placements with an explicit font
  size, drawn straight into the page content stream with an embedded subset of Liberation Sans
  (`fonts.js`). An "Export (filled)" button downloads the result. Corrected a licence assumption
  in SPEC.md along the way: the Liberation Sans copy actually available without a network fetch
  (bundled in our own pinned `pdfjs-dist` dependency) is GPLv2 with Red Hat's font-embedding
  exception, not SIL OFL as assumed — the choice of font stands, only the label was wrong.
  Verified against SPEC.md's worked example (anchor and rotation) with a mocked `drawText`, and
  against the exported bytes themselves in a Node probe: real `Tj` text-showing operators on
  every page, at the right size, with each page's text matrix reflecting its own rotation.
- Build stage 8: `writeFields.js` — writers 2 and 3, layered and template, sharing one internal
  writer since creating fields and optionally setting their values is the same operation either
  way (SPEC.md, "The round-trip question — answered"). Text placements only, ticks/dropdowns/
  radio arrive with the properties panel at stage 10. Two "Export" buttons added alongside
  filled's. Verified against SPEC.md's widget-rectangle table at all four rotations, the
  one-field-many-widgets construction, and a tab-order sort proven in **visual** space (a test
  fixture deliberately creates widgets in the wrong order on a rotated page, where sorting in
  user space would still look right and be wrong). NeedAppearances and every widget's `/DA` and
  `/AP` appearance stream checked structurally in a Node probe, since this sandbox has no
  screen-recording permission for the macOS Preview open the build order calls for.
- Build stage 9: the cross-writer agreement test. For an identical text placement at every
  rotation, `writeFilled`'s drawn anchor and `writeFields`' widget anchor are asserted to agree
  exactly, by spying on both `page.drawText` and `PDFTextField.prototype.addToPage` rather than
  re-deriving the expected numbers — this guards against the two drifting apart in a future edit,
  which neither writer's own test would catch on its own. They agree, so this stage needed no
  planning-level escalation.
- Build stage 10: ticks, dropdowns and radio groups, in all three writers, plus the properties
  panel (`editor/properties.js`) to name a placement, set its value, and edit a dropdown's or
  radio group's options. Flagged and resolved a real gap in SPEC.md's placement model before
  writing any code: a radio group's several physical buttons need both "which option is this
  widget" and "which option is the group's current selection", which the original typedef only
  had one string for. Resolved by adding `optionValue` (fixed per widget) alongside the existing
  `value` (the group's shared selection, mirrored across every placement sharing a name, exactly
  as `name` already is) — see the amended SPEC.md and the new `placements.js` function this
  mirroring runs through, `updateGroup`. Verified end-to-end in a browser: naming two radio
  placements the same, giving each a distinct `optionValue`, and toggling "selected by default"
  on one correctly clears the other's checkbox on next selection. Also fixed a real bug found in
  the process: editing a placement through the properties panel updated the data but never
  re-rendered the canvas overlay, so a renamed placement's on-page label never appeared, until
  main.js was wired to re-render the canvas from both the panel's and the canvas's own changes.
- Build stage 11: fonts.js's auto-fit. `fontSize: 0` in filled mode now binary-searches the
  largest size that fits the box (and, for multiline, the wrapped height) with the embedded
  font's own `widthOfTextAtSize`, and multiline placements are actually wrapped and drawn as
  stacked lines, not one overflowing line. An export-size note now gives an honest ~KB estimate
  for the full font embed layered and template both need. Checked a real pdf-lib behaviour in a
  Node probe rather than assuming SPEC.md's "pass 0 through and let the viewer auto-size" holds
  literally: calling `setFontSize` at all marks a field dirty, and `PDFDocument.save()`
  unconditionally regenerates a dirty field's appearance with a real computed size, baking that
  into `/DA` regardless of what was asked for — `NeedAppearances` is what still delivers the
  auto-size intent to a compliant reader. SPEC.md corrected accordingly.
