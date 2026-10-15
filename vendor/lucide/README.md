# Lucide icons (vendored)

The `kit-icon` asset draws icons from [Lucide](https://lucide.dev), an open-source icon set under the **ISC licence**
(the full text is in `LICENSE`, copied unchanged from the package; some icons derive from Feather, MIT, and the file
says so). Nothing is fetched at run time and no dependency is added: the icons are plain SVG files kept here.

- **Where it came from:** the npm package `lucide-static`, version in `VERSION.json` (`npm pack lucide-static@<version>`,
  unpacked once into a scratch folder). `UPSTREAM-README.md` is that package's own README.
- **What is here:** `icons/<name>.svg`, the curated set of about 150 icons for explainers and marketing videos (the
  list is `CURATED` in `scripts/vendor-icons.mjs`), `LICENSE`, `UPSTREAM-README.md`, `VERSION.json`.
- **How the asset gets them:** `node scripts/vendor-icons.mjs` converts every element of every SVG (path, circle,
  ellipse, rect, line, polyline, polygon) to path data on Lucide's 24 × 24 grid and rewrites the generated block of
  `assets/kit-icon.js`. `node scripts/vendor-icons.mjs --check` fails when the asset is not what the SVGs give.
- **Updating or changing the set:** unpack a newer `lucide-static`, then
  `node scripts/vendor-icons.mjs --from <unpacked folder>/package` (copies the listed SVGs, the licence, the README
  and the version, then regenerates the asset). Edit `CURATED` first to add or drop icons. A changed `kit-icon.js`
  is a new version of the asset: clips that pinned version 1 keep drawing what they drew.
