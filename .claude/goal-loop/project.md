# Fablecut: project facts for the goal loop

What the goal-loop skill needs to know about this repository. The protocol is in the skill; this file
says how to check, run and look at **this** code. Keep it short and true, and fix it when you learn otherwise.

```bash
S=.claude/skills/goal-loop/scripts       # generic: gates.sh, sweep.sh, cdp.mjs (the .swift helpers are macOS only)
P=.claude/goal-loop                      # this repo: project.md, gates, screens, serve.sh
export TMPDIR="$LOCALAPPDATA/Temp/claude/<session>/scratchpad"                 # logs, data and shots stay out of the repo
export CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"         # cdp.mjs does not look for Chrome on Windows
```

## Kind

- **UI:** web (the studio, `src/ui`, served by `src/server`). There is also an MCP server and a library.
- **Browser:** both. Headless (`cdp.mjs`, `sweep.sh`) for the sweep and the evidence; the desktop app's
  built-in browser (`mcp__Claude_Browser__*`) for interactive workflows (playground, scrubbing, starting a render).

## Gates

```bash
bash $S/gates.sh            # runs $P/gates: typecheck, lint, test
```

- Tests are `test/*.test.js`, run by `node --test` (`npm test`). A new file matching that glob runs.
- Style: `node:test` + `node:assert/strict`; fixtures in `test/helpers.js` (`tempStudio()`, `seedAssets()`).
  See `test/library.test.js`. Tests render at 320×180 so they stay fast.
- Typecheck is `tsc --checkJs` (non-strict) over everything except `src/ui`; annotate option objects with JSDoc.
- There is no build step: the browser loads `src/ui` and `src/core` as ES modules.

## Running it for verification

```bash
bash $P/serve.sh fresh 8791 "$TMPDIR/data"    # empty data (only the bundled fonts), own port
bash $P/serve.sh seed  8791 "$TMPDIR/data"    # empty data + the showcase library and clips (no renders)
STUDIO_DATA="$TMPDIR/data" node scripts/dev-seed.mjs   # or: a tiny fixture library with one finished render
bash $P/serve.sh stop  8791 "$TMPDIR/data"
```

- The user's own studio: port 8787, data in `./data` (git-ignored). Never touch either.
- Server log: `<data-dir>/server.log`. A line starting with `ERROR` is a server error; API lines are `METHOD url status ms`.
- The MCP server opens the same data dir: `STUDIO_DATA=<dir> node scripts/mcp.mjs call <tool> '<json>'`.
- FFmpeg is found through `FFMPEG_PATH`, then PATH, then `%LOCALAPPDATA%\Microsoft\WinGet\Links`.

## Screens and viewports

```bash
bash $S/sweep.sh http://127.0.0.1:8791 "$TMPDIR/sweep"    # every screen in $P/screens
node $S/cdp.mjs shot "<url>" out.png --size 390x844 --mobile [--full|--scroll] --js "…"
```

- Viewports: 1440×900 desktop, 390×844 phone.
- Screens: `/` library · `/assets/<slug>` playground · `/clips` · `/clips/<slug>` editor · `/renders` · `/gallery` · `/lineage`.
- Selectors and interaction recipes: see "Studio UI selectors" below.

## Where things live

```
src/core/     the asset runtime, shared by Node and the browser (engine, schema, text layout, composition)
src/render/   Node host: vm sandbox, Skia canvas, worker pool, FFmpeg pipeline, WAV + beat detection
src/db/       SQLite schema
src/studio/   services: library (assets), clips, renders (queue), lineage; studio.js wires them
src/mcp/      MCP tools and stdio server
src/server/   HTTP API + static files
src/ui/       the studio web app (vanilla ES modules); preview.js + preview-worker.js run src/core in a Web Worker
assets/       every function asset's source, flat (name.v2.js = version 2); scripts/sync-assets.mjs pushes them
clips/        one folder per clip, compose.mjs = its composition
showcase/     plan.mjs + build.mjs: replays the three showcase clips through MCP
fonts/        bundled OFL fonts and their licenses
```

- A new asset capability touches `src/core/runtime.js` (the `f` object), `docs/ASSET_CONTRACT.md`, and a test.
- A new service method usually wants an MCP tool (`src/mcp/tools.js`) and an HTTP route (`src/server/http.js`).

## Showcase and evidence

- `npm run showcase` (= `node showcase/build.mjs`) rebuilds the library and renders the three clips through the
  MCP server into `STUDIO_DATA`. `--no-render` builds the library and clips only.
- `npm run evidence` / `verify` write to `output/showcase/` (git-ignored). A snapshot without videos is committed in
  `docs/showcase/` (`posters/`, `sheets/`, `reports/`, `studio/`) with an `INDEX.md`
  mapping each contract item to its files. MP4s go on a GitHub release, never in git. Loop screenshots stay in the scratchpad.
- Finished PROGRESS.md files move to `docs/progress/<YYYY-MM-DD>-<slug>.md`.

## Conventions

- Commit style: see `git log` (imperative title, bulleted body).
- Node 24, ES modules, plain JS with JSDoc. New dependencies need a reason in PROGRESS.md **Decisions**.
- Write source files with the Write tool: Git Bash heredocs containing JS break in this harness.
- UI text: short, sentence case, no exclamation marks.

## Studio UI selectors

The UI is vanilla ES modules in `src/ui` (`app.js` router, `lib/*` shared parts, `screens/*` one module per
route). Every control below has a `data-testid`; drive them with `cdp.mjs --js` by setting `.value` and
dispatching `input` (text, number, range, colour) or `change` (select), or by `.click()`.

| screen | testids |
|---|---|
| shell | `nav-library` `nav-clips` `nav-renders` `nav-gallery` `nav-lineage`, `render-badge` (hidden when nothing is queued or running) |
| library `/` | `search`, `filter-type` `filter-kind` `filter-format` `filter-origin` `filter-used-by` (selects), `tag-filter` (+`data-tag`), `clear-filters`, `result-count`, `asset-grid`, `asset-card` (+`data-slug`), `empty` |
| playground `/assets/<slug>?v=<n>&format=<name>` | `preview-canvas` (`dataset.frame`), `preview-error`, `play` (`dataset.playing`), `scrub`, `time`, `format-vertical` `format-horizontal` `format-square`, `toggle-safe` → `safe-overlay`, `duration`, `exact-frame` → `exact-frame-image` (+`exact-frame-close`), `play-audio` → `audio-player`, `stage-note`, `params`, `param-<name>` (number box; slider is `param-<name>-range`; nested `param-<name>.<i>.<field>`; arrays also `param-<name>-add` / `-remove`), `reset-params`, `version` (+`data-version`), `edit-source`, `source-view`, `source-editor`, `version-note`, `validate`, `save-version`, `cancel-edit`, `source-error`, `source-ok`, `draft-flag`, `details`, `deps`, `dependents`, `used-by` |
| clips `/clips` | `clip-card` (+`data-slug`), `clip-count`, `new-clip` → `new-clip-name` `new-clip-title` `new-clip-format` `new-clip-duration` `new-clip-create` `new-clip-error` |
| editor `/clips/<slug>` | `preview-canvas`, `preview-error`, `play`, `scrub`, `time`, `toggle-safe` → `safe-overlay`, `toggle-guides` → `guides-overlay`, `timeline`, `ruler`, `beat`, `playhead`, `item` (+`data-id`, `data-asset`), `zoom`, `zoom-fit`, `tl-position`, `add-item`, `inspector`, `inspector-empty`, `selected-id`, `item-asset`, `version-state`, `upgrade`, `change-asset`, `delete-item`, `item-start` `item-duration` `item-fadein` `item-fadeout` `item-opacity` `item-gain`, `param-<name>`, `reset-params`, `clip-duration`, `clip-background`, `save`, `unsaved`, `save-status`, `revision`, `render-button`, `remix` → `remix-format` `remix-name` `remix-create` `remix-error`, `editor-error`, `clip-assets` → `clip-asset` (+`data-relation`) |
| asset picker (dialog) | `asset-picker`, `picker-search`, `picker-option` (+`data-slug`) |
| renders `/renders` | `render-row` (+`data-id`, `data-status`), `render-frames`, `render-elapsed`, `render-stats`, `render-error`, `cancel-render`, `open-in-gallery`, `render-clip-select`, `start-render`, `render-count`, `render-message` |
| gallery `/gallery`, `/gallery/<render id>` | `gallery-card` (+`data-id`), `gallery-count`, `player` (video), `download-mp4`, `download-srt`, `render-assets` → `render-asset` |
| lineage `/lineage` | `lineage-clips` → `lineage-clip` (+`data-slug`), `lineage-sum`, `legend`, `lineage-matrix`, `lineage-col` (+`data-slug`), `lineage-row` (+`data-slug`), `lineage-cell` (+`data-how` created/as-is/new-version/fork/library, `data-clip`), `most-reused`, `reuse-report` |
| any screen | `loading`, `empty`, `screen-error`; dialogs: `confirm` (`confirm-ok`, `confirm-cancel`) |

Recipes (all are `--js` expressions; wait ~500 ms after each step for the worker to draw):

```js
const $ = (s) => document.querySelector(s), fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
// library: search, filter
$('[data-testid=search]').value = 'text'; fire($('[data-testid=search]'), 'input');          // debounced 220 ms; URL becomes /?q=text
$('[data-testid=filter-kind]').value = 'visual'; fire($('[data-testid=filter-kind]'), 'change');
$('[data-testid=tag-filter][data-tag=text-animation]').click();
// playground / editor: scrub and change a parameter (the canvas is a bitmaprenderer: copy it to a 2D canvas to read pixels)
$('[data-testid=scrub]').value = '1.5'; fire($('[data-testid=scrub]'), 'input');             // canvas.dataset.frame follows
$('[data-testid=param-text]').value = 'Hello'; fire($('[data-testid=param-text]'), 'input');
// editor: select an item, save, render
$('[data-testid=item][data-id=<item id>]').click();                                          // the inspector shows it
$('[data-testid=save]').click();                                                             // wait until [data-testid=unsaved] is hidden
$('[data-testid=render-button]').click();                                                    // lands on /renders; poll [data-testid=render-row].dataset.status
// editor: drag an item (pointer events on the block, then on window)
el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 50, clientY: y, pointerId: 1 }));
window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 50, clientY: y, pointerId: 1 }));
// source: a rejected draft shows its message in [data-testid=source-error] (the 422 is expected there)
$('[data-testid=edit-source]').click(); $('[data-testid=source-editor]').value = '…'; fire($('[data-testid=source-editor]'), 'input'); $('[data-testid=validate]').click();
```

- Space toggles play when focus is not in a field; ←/→ step one frame.
- A touch drag moves a timeline item only after it is selected (first tap selects), so a swipe still scrolls the timeline.
- `screens` lists the showcase slugs; `screens.fixture` is the same list for `scripts/dev-seed.mjs` data
  (`SCREENS=.claude/goal-loop/screens.fixture bash $S/sweep.sh …`). Quote paths that contain `&`.
- Phone screens use `--scroll` and desktop `--full`: stage heights are capped in px so a grown viewport does not change the layout.
