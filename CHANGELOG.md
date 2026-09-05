# Changelog

All notable changes to former are recorded here. One line per meaningful change; version
headings are cut when a meaningful chunk of work lands, not on every commit.

## Unreleased

- Removed the top navigation bar linking to the other strata sites, added and then dropped in
  the same unreleased window: it meant rebuilding and redeploying this app every time the
  family menu changed elsewhere. Only the strata hub carries the bar now; the palette import
  below is unaffected.
- The palette moves out of this repo into `strata-kit`, carried here as a submodule at
  `vendor/strata-kit` and imported. It was a hand-kept copy of lodger's and had drifted: the
  page ground was `#faf6f0` where the specification says `#fbf7f4`, so the background is now a
  shade warmer and matches its sibling exactly. The placement-edge colours stay here, since
  they are former's alone.

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
- Build stage 12: signature.js — draw on a canvas (smoothed with quadratic curves through
  consecutive midpoints) or upload a PNG/JPEG, sniffed by magic number and never trusted by
  extension or claimed MIME type. Saved to IndexedDB — the one deliberate exception to "nothing
  is persisted" — with a one-click clear visible in the main UI at all times, not buried in a
  settings pane, and more than one signature allowed at once. `writeFilled.js` now draws the
  saved image at a signature placement's anchor; `writeFields.js` never creates a field for one
  (SPEC.md is explicit that a signature can't become one), except in template mode, where
  `asTextInTemplate: true` substitutes an ordinary empty text field so the recipient can type
  their name. Verified end-to-end in a browser: drawing, saving, uploading (including the
  JPEG-has-no-transparency warning and the not-a-PNG-or-JPEG refusal), clearing, and picking a
  saved signature for a placement through the properties panel, through to a clean filled export.
- Build stage 13: acroform.js — detect a document's existing AcroForm fields and offer to import
  them rather than silently drawing over a form that already works. Each widget imports as one
  placement, sharing its field's name and read via `geometry.js`'s new `visualRectFromUserRect`
  (the inverse of the widget rectangle rule, promoted out of the fixture generator now that a
  real production consumer needs it too). Button and option-list fields are reported as
  unsupported and left untouched, not imported. `writeFilled.js` gives an imported placement
  (marked `fromExistingField`) a genuinely different path from a hand-drawn one: it sets the real
  field's value and calls `form.flatten()` once for the whole document, rather than drawing fresh
  text at the computed anchor — the two paths coexist correctly in one export. Flagged and
  resolved a second real model gap before writing this stage's code: nothing in the original
  Placement shape said "this came from a real field", which set-and-flatten vs. draw needs to
  know and a rename must not silently change. Verified end-to-end in a browser: the prompt
  correctly counts a document's fields, both import and skip leave the right placements behind,
  and an imported document exports cleanly through the flatten path.
- Build stage 14: sidecar.js — save and load the JSON sidecar (the placement list plus a SHA-256
  fingerprint of the source PDF, small enough to email), with the three load outcomes SPEC.md
  describes: a hash match attaches silently, a hash mismatch with the same page count and first
  page size attaches with a warning to check every placement, and anything else is refused,
  naming the page count it was saved against. A same-page-count-but-different-first-page-size
  document — a case SPEC.md's prose doesn't spell out — is treated as a refusal too, on the
  reasoning that placement coordinates are absolute in points and that shape change is exactly
  what would misplace them. A loaded sidecar's signature placements are checked against this
  browser's current saved signatures and named in the message if any need reselecting — no new
  placement field for this, since `imageId` pointing at nothing already shows correctly as
  unselected in the properties panel's picker. Verified end-to-end in a browser by intercepting
  the app's own real "Save sidecar" download (capturing the `Blob` at `URL.createObjectURL`,
  since the download itself is inert in this sandbox) and loading it back: an unchanged document
  attaches silently and restores the placement exactly, and a different-page-count document is
  correctly refused.
- Build stage 15: warnings.js — the pre-export checks from SPEC.md's warnings table that depend
  on the placement list (the refusals and the font-size note were already handled where the thing
  they're about happens, in doc.js/signature.js/sidecar.js/fonts.js). Covers a name shared by
  different types, a placement extending past the page edge, an unnamed placement that layered or
  template would silently drop, what a signature placement becomes in template mode, a JPEG
  signature's transparency warning, and filled mode's auto-fit text that doesn't fit even at the
  smallest size — the last two skip cleanly with no font supplied rather than throwing, since
  `warnings.js` itself stays DOM- and pdf-lib-instance-free otherwise. Wired into the export
  buttons as a real gate: no warnings exports immediately as before, any warnings show first with
  "Export anyway"/"Cancel", reusing the same show-a-prompt-and-wait pattern stage 13's import
  prompt already established. Verified end-to-end in a browser: an unnamed placement blocks
  layered export with the right message, naming it then re-exporting proceeds with no warnings,
  and "Export anyway" on a template export with an unnamed placement completes cleanly.
- Build stage 16: keyboard access for the editor surface, and a preview mode. Every placement is
  a real tab stop in the same order `writeFields.js` gives the exported `/Annots` — descending
  visual y, then ascending visual x — so tabbing through the page previews the eventual field
  order. Arrow keys nudge the selected placement by a point (10 with Shift), Delete/Backspace
  removes it, and Enter either opens the properties panel on a selected placement or, with a
  creation tool active and nothing selected, creates one at a default position without ever
  touching the mouse. A "Preview the output" row renders the filled/layered/template bytes straight
  back through pdf.js in place of the editor, so what SPEC.md promises the export contains can be
  checked without leaving the tab. Fixed a real bug found while verifying by keyboard: the drag
  handler's `event.preventDefault()`, needed to stop a click starting a text selection, was also
  suppressing the browser's own native click-to-focus, so clicking a placement selected it without
  ever giving it real DOM focus — arrow keys and Delete then silently did nothing until the user
  tabbed away and back. Fixed by focusing the clicked placement explicitly, looked up fresh in the
  live DOM by id after selection's own re-render rather than off the original event target, which a
  first attempt at the fix still got wrong. Verified the full keyboard path — focus, nudge,
  Delete, both Enter behaviours, tab order, and preview open/close — by dispatching real
  `KeyboardEvent`s at genuinely focused elements; this sandbox's synthetic mouse clicks turned out
  to land at the wrong page coordinate for anything below the fold once the stage 10-15 panels
  pushed the canvas down the page, which is a test-environment limitation and not a finding about
  the app.
- Build stage 17: the full macaron palette, copied from lodger's light and dark tables rather
  than the stage 1-16 placeholder tokens, plus the self-hosted type — Fraunces for the wordmark
  and headings, DM Sans for everything else, DM Mono for page counts, zoom, file sizes and the
  build hash, all bundled through `@fontsource` rather than a font CDN, which the CSP already
  refuses. Every card, button and control now uses lodger's own radius and shadow tokens instead
  of ad hoc values, and borders that mark a boundary use `--border`/`--border-strong` rather than
  reusing the ink colour. Placement fills moved from an ad hoc 35% to the specified 12% opacity
  so the page underneath stays legible, and each placement now carries a small type-glyph badge
  in its top-left corner in its own edge colour — `Aa`/`✓`/`✎`/`▾`/`◉` for text/check/signature/
  dropdown/radio — so type is never told apart by colour alone, per SPEC.md's own rule. Checked
  against a fixture page at 100% zoom in a real browser: all five types read clearly together,
  selection's accent ring stays visually distinct from every type's own edge colour, and the dark
  theme (which this sandbox defaults to) renders every surface, control and placement correctly
  from the same tokens with no separate dark-mode styling needed anywhere. Fixed a real layout
  bug found in the process, pre-dating this stage: the export row's note text had no way to wrap
  onto its own line, so it collapsed into an unreadably narrow column once three buttons were
  present — given `flex-wrap` and a full-width `flex-basis`, matching the pattern the sidecar row
  already used for its own note.
- Build stage 18, the last of the build order: `.github/workflows/deploy.yml`. Every push to
  `main` now runs `npm ci`, `npm run lint`, `npm test` and `npm run build`, copies `CNAME` into
  `dist/` (the Vite build doesn't know about it, and Pages needs it alongside `index.html` to
  serve the custom domain), then deploys via `actions/deploy-pages` — the same shape as lodger's
  own workflow, including Node 24 for the same reason: `pdfjs-dist` 6 and Vitest 5 both need
  Node ≥22.13, and on Node 20 `npm ci` wedges indefinitely with an `EBADENGINE` warning instead
  of failing outright. Repo Settings → Pages → Source needs setting to "GitHub Actions" once, by
  hand, for this to take effect — not something a workflow file can do for itself. Ran every step
  locally against the committed lockfile before pushing, since this is the one commit type this
  project has no way to rehearse in CI first: it's what turns CI on.
- Fixed a real pdf-lib bug that stage 18's own first CI run caught immediately: `JpegEmbedder`
  reads a JPEG's SOI marker with `new DataView(imageData.buffer)` — the whole underlying
  `ArrayBuffer`, ignoring `byteOffset`/`byteLength` — which only gives the right answer for a
  `Uint8Array` that owns its buffer outright. `fs.readFileSync` handed back exactly the
  dangerous shape on the Linux CI runner (confirmed with a throwaway diagnostic: a 5735-byte
  JPEG at byteOffset 56888 into a 65536-byte pool buffer) though never locally, and threw "SOI
  not found in JPEG" against bytes that are a perfectly valid JPEG on disk. `writeFilled.js` now
  copies signature bytes onto a fresh buffer before handing them to `embedJpg`/`embedPng`. First
  attempt used `bytes.slice()` and shipped, tested green, then failed the *exact same way* on
  the very next CI run: `Buffer.prototype.slice()` is overridden to behave like `subarray()` for
  backwards compatibility and returns a view over the same memory, not a copy, so it silently
  left the same wrong byteOffset in place — the regression test had built its reproduction
  buffer as a plain `Uint8Array`, whose real `.slice()` does copy, so it never exercised the
  Buffer-specific override it was meant to guard against. Corrected to `new Uint8Array(bytes)`,
  and the test rebuilt with `Buffer.concat`/`.subarray()` so it actually is a `Buffer` view — the
  same shape `fs.readFileSync` produced in CI — confirmed to fail against the first, broken fix
  and pass against the corrected one. One more round-trip through CI found a second, smaller
  slip in that same test: it asserted the constructed view's `byteOffset` was exactly `16`, which
  assumed `Buffer.concat` itself always returns a buffer that owns its own memory from byte 0 —
  true locally, not true on the CI runner, where `Buffer.concat`'s own result was itself a pool
  slice with a non-zero base. Loosened to asserting only what the test actually needs: a non-zero
  offset, not a specific one.
- A light/dark toggle, copied from lodger's own: a button in the masthead flips `data-theme` on
  `<html>` between the two palettes regardless of the system setting. Not remembered between
  visits — former's whole privacy claim is that nothing is persisted except a signature the user
  explicitly saves, and a toggle setting isn't worth qualifying that for — so the page follows
  the system preference again on every reload until switched for that visit.
- The JSON sidecar removed entirely — `sidecar.js`, its tests, the "Save/Load sidecar" row, and
  every mention in the UI and README. It added a second way to bring placements into a session
  (import from a sidecar, alongside importing a PDF's own existing AcroForm fields) for a
  narrow use case, and Matt asked for it to go.
- Layout: the shell was capped at a 44rem reading measure everywhere, including the PDF viewer
  itself, so a loaded page rendered in a cramped column regardless of screen size. The masthead,
  signature panel and file picker keep that measure (`.narrow`), but the shell itself now runs
  up to 78rem, so the thumbnail rail, page and properties panel actually get room. The toolbar
  row for picking a placement type (Text/Tick/Signature/Dropdown/Radio) now sits directly above
  the page canvas, with the export/preview controls moved below it, so the tool you're choosing
  and the page you're dragging on are no longer separated by several rows of buttons.
- Matched lodger's own theme more closely, now that the palette is shared through `strata-kit`:
  the confectionery gradient wash behind the masthead, the expressive `Fraunces Variable` wordmark
  treatment (`SOFT`/`WONK` axes, a `clamp()`-sized display weight), and the privacy line as a
  pistachio status pill rather than plain text. All copied straight from lodger's `style.css`.
