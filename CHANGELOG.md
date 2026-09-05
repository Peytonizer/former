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
