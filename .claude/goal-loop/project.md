# Fablecut: project facts for the goal loop

What the goal-loop skill needs to know about this repository. The protocol is in the skill; this file
says how to check, run and look at **this** code. Keep it short and true, and fix it when you learn otherwise.

```bash
S=.claude/skills/goal-loop/scripts       # generic: gates.sh, sweep.sh, cdp.mjs, montage.swift, pdfpng.swift
P=.claude/goal-loop                      # this repo: project.md, gates, screens, serve.sh
export TMPDIR=<the session's scratchpad>   # logs, data and shots stay out of the repo
export TEMP="$TMPDIR" TMP="$TMPDIR"        # Windows: Node's os.tmpdir() reads these, not TMPDIR (tests leave studio-test-* dirs there)
export CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"   # Windows only: cdp.mjs finds Chrome by itself on macOS
swift $S/montage.swift out.png 0.5 a.png b.png      # screenshots side by side (macOS only)
```

Machines: iteration 1 ran on Windows; iteration 2 was built on macOS 15.5 (Intel i5-10600, 12 threads,
Node 24.21), continued on Windows 11 (i9-14900KF, 32 threads, 64 GB, Node 24.19, FFmpeg from winget,
Claude Code CLI `~/.local/bin/claude.exe`, Git Bash for the scripts; no git identity there: commit with
`git -c user.name=Narcis13 -c user.email=Narcis75@gmail.com commit`; shell heredocs drop backslashes) and
its final audit ran on a third machine: **macOS 15.4 on an Apple M2 (8 cores), Node 24.15, FFmpeg 6.0 in
`/opt/homebrew/bin`, Chrome in `/Applications`, git identity set, `swift` available.** On that Mac the
`claude` CLI is a shell alias, so child processes don't find it: give Run now
`STUDIO_CLAUDE_BIN=$HOME/.claude/local/claude`. Its disk is small (about 6 GB free): one full showcase
with renders is about 2 GB, so delete scratch data dirs when done. Render times and emoji pixels are
per machine: take the hash and speed baselines again on the machine that compares them
(`git worktree add <dir> 6c9f8cf`, link `node_modules` into it, `npm run showcase`, `scripts/hashes.mjs`).
A fresh checkout needs `npm ci`. FFmpeg up to 6.0 warns "Thread message queue blocking" when frames
arrive faster than it encodes; the render log drops that line (`quietLog` in `src/render/video.js`).
Always set `STUDIO_DATA`: scripts default to `./data`, the user's studio.

## Kind

- **UI:** web (the studio, `src/ui`, served by `src/server`). There is also an MCP server and a library.
- **Browser:** both. Headless (`cdp.mjs`, `sweep.sh`) for the sweep and the evidence;
  Claude in Chrome (`mcp__claude-in-chrome__*`) for interactive workflows (drag and drop, on-canvas handles,
  uploads, the ask-the-agent flow), recorded as GIFs.

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
- FFmpeg is found through `FFMPEG_PATH`, then PATH, then `%LOCALAPPDATA%\Microsoft\WinGet\Links` on Windows.
- The studio serves `src/ui` and `src/core` straight from the repo, so a running studio shows edits to
  those files at the next page load (also half-finished ones, while agents are editing).
- Scripted workflows with real mouse, keyboard and file-drop input in headless Chrome:
  `STUDIO_DATA=<dir> node scripts/workflows-v2.mjs http://127.0.0.1:8791 <out-dir> [canvas layers playground request uploads live]`
  (driver: `scripts/lib/browser.mjs`). They change the data they run on.
- Claude in Chrome: more than one browser can be connected to the account (a Mac and this PC were);
  the one in use must be on the machine that runs the studio, or 127.0.0.1 is refused. Ask the user which.
- Emoji draw with the system emoji font (Apple Color Emoji on macOS, Segoe UI Emoji on Windows; Skia's font fallback), so emoji pixels, and the hashes of
  frames that show them, are per OS. `scripts/hashes.mjs` records and compares the showcase hashes on one machine.

## Screens and viewports

```bash
bash $S/sweep.sh http://127.0.0.1:8791 "$TMPDIR/sweep"    # every screen in $P/screens
node $S/cdp.mjs shot "<url>" out.png --size 390x844 --mobile [--full|--scroll] --js "…"
```

- Viewports: 1440×900 desktop, 390×844 phone.
- The first headless Chrome launch after a while can take longer than `cdp.mjs` waits ("chrome did not
  start"); `sweep.sh` still prints `ok` for that screen. Check that every screen's PNG exists, and reshoot a missing one.
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
- Write source files with the Write tool or the Edit tool rather than shell heredocs.
- UI text: short, sentence case, no exclamation marks.

## Studio UI selectors

The UI is vanilla ES modules in `src/ui` (`app.js` router, `lib/*` shared parts, `screens/*` one module per
route). Every control below has a `data-testid`; drive them with `cdp.mjs --js` by setting `.value` and
dispatching `input` (text, number, range, colour) or `change` (select), or by `.click()`.

| screen | testids |
|---|---|
| shell | `nav-library` `nav-clips` `nav-renders` `nav-gallery` `nav-lineage`, `render-badge` (hidden when nothing is queued or running) |
| library `/` | `search`, `sort`, `density` (+`data-value`), `filter-type` `filter-kind` `filter-format` `filter-origin` `filter-used-by` (facet groups) → `facet` (+`data-facet`, `data-value`), `tag-filter` (+`data-tag`), `collection-link`, `recent-link`, `facets-toggle` (phone), `clear-filters`, `result-count`, `asset-grid` (virtualized; scroll box `.vgrid-scroll`), `asset-card` (+`data-slug`, `aria-selected`), `detail-panel` → `detail-close` `favorite-toggle` `feature-toggle`, `bulk-bar` → `bulk-tag-input` `bulk-add-tag` `bulk-remove-tag` `bulk-collection` `bulk-favorite` `bulk-add-to-clip`, `upload-button` `upload-input` `drop-zone` `upload-status` → `upload-row` (+`data-name`, `data-state`), `empty` |
| playground `/assets/<slug>?v=<n>&format=<name>` | `preview-canvas` (`dataset.frame`), `preview-error`, `play` (`dataset.playing`), `scrub`, `time`, `format-vertical` `format-horizontal` `format-square`, `toggle-safe` → `safe-overlay`, `duration`, `exact-frame` → `exact-frame-image` (+`exact-frame-close`), `play-audio` → `audio-player`, `stage-note`, `params`, `param-<name>` (number box; slider is `param-<name>-range`; nested `param-<name>.<i>.<field>`; arrays also `param-<name>-add` / `-remove`), `reset-params`, `version` (+`data-version`), `edit-source`, `source-view`, `source-editor`, `version-note`, `validate`, `save-version`, `cancel-edit`, `source-error`, `source-ok`, `draft-flag`, `details`, `deps`, `dependents`, `used-by` |
| clips `/clips` | `clip-card` (+`data-slug`), `clip-count`, `new-clip` → `new-clip-name` `new-clip-title` `new-clip-format` `new-clip-duration` `new-clip-create` `new-clip-error` |
| editor `/clips/<slug>` | `preview-canvas`, `preview-error`, `play`, `scrub`, `time`, `toggle-safe` → `safe-overlay`, `toggle-guides` → `guides-overlay`, `timeline`, `ruler`, `beat`, `playhead`, `item` (+`data-id`, `data-asset`), `zoom`, `zoom-fit`, `tl-position`, `add-item`, `inspector`, `inspector-empty`, `selected-id`, `item-asset`, `version-state`, `upgrade`, `change-asset`, `delete-item`, `item-start` `item-duration` `item-fadein` `item-fadeout` `item-opacity` `item-gain`, `param-<name>`, `reset-params`, `clip-duration`, `clip-background`, `save`, `unsaved`, `save-status`, `revision`, `render-button`, `remix` → `remix-format` `remix-name` `remix-create` `remix-error`, `editor-error`, `clip-assets` → `clip-asset` (+`data-relation`) |
| asset picker (dialog) | `asset-picker`, `picker-search`, `picker-option` (+`data-slug`) |
| renders `/renders` | `render-row` (+`data-id`, `data-status`), `render-frames`, `render-elapsed`, `render-stats`, `render-error`, `cancel-render`, `open-in-gallery`, `render-clip-select`, `start-render`, `render-count`, `render-message` |
| gallery `/gallery`, `/gallery/<render id>` | `gallery-card` (+`data-id`), `gallery-count`, `player` (video), `download-mp4`, `download-srt`, `render-assets` → `render-asset` |
| lineage `/lineage` | `lineage-clips` → `lineage-clip` (+`data-slug`), `lineage-sum`, `legend`, `lineage-matrix`, `lineage-col` (+`data-slug`), `lineage-row` (+`data-slug`), `lineage-cell` (+`data-how` created/as-is/new-version/fork/library, `data-clip`), `most-reused`, `reuse-report` |
| iteration 2, editor | on-canvas: `handle` (+`data-handle` move, nw, ne, se, sw, rotate; only for the selected layer), `snap-guide` (while dragging), inspector `tf-x` `tf-y` `tf-width` `tf-height` `tf-scale` `tf-rotation` `tf-space`, `layout-format`; layers: `.tl-row[data-track]` (top row = in front), `track-handle` (+`data-track`), `track-name`, `add-track` `add-track-type`, `undo` `redo` (Ctrl+Z / Ctrl+Y); `save-as-asset` → `precomp-dialog` (`precomp-name` `precomp-title` `precomp-replace` `precomp-items` `precomp-unsaved` `precomp-error` `precomp-save` `precomp-cancel`), then `precomp-status` `precomp-link`; `proposal-bar` while a proposal is previewed |
| iteration 2, ask the agent (playground, editor, `/requests/<id>`) | `agent-open` → `agent-panel`: `agent-input` `agent-send`, `agent-request`, `agent-thread` → `agent-message`, `agent-proposal` → `agent-preview` `agent-accept` `agent-reject` `agent-reject-reason`, `agent-reply-input` `agent-reply`, `agent-run-now` (only with the CLI) |
| iteration 2, playground | `keep` → `changed-count` `save-defaults` `save-preset` → `preset-name` `preset-title` `preset-create`; `metadata` → `meta-edit` → `meta-title` `meta-description` `meta-tags` `meta-save` `meta-reset`; `versions` → `diff-open` → `diff` (`diff-a` `diff-b` `diff-stats` `diff-view` `diff-frames`) |
| requests `/requests` | `request-input` `request-send` (goes to `/requests/<id>`), `request-filter` (+`data-status`), `request-list` → `request-row` (+`data-id`, `data-status`), `request-back` |
| any screen | `loading`, `empty`, `screen-error`; dialogs: `confirm` (`confirm-ok`, `confirm-cancel`) |

Recipes (all are `--js` expressions; wait ~500 ms after each step for the worker to draw):

```js
const $ = (s) => document.querySelector(s), fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
// library: search, filter
$('[data-testid=search]').value = 'text'; fire($('[data-testid=search]'), 'input');          // debounced 220 ms; URL becomes /?q=text
$('[data-testid=filter-kind] [data-value=visual]').click();                                   // URL becomes /?kind=visual
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
