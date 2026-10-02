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
showcase/     asset sources and clip compositions of the three showcase clips, and build.mjs that replays them through MCP
fonts/        bundled OFL fonts and their licenses
```

- A new asset capability touches `src/core/runtime.js` (the `f` object), `docs/ASSET_CONTRACT.md`, and a test.
- A new service method usually wants an MCP tool (`src/mcp/tools.js`) and an HTTP route (`src/server/http.js`).

## Showcase and evidence

- `npm run showcase` (= `node showcase/build.mjs`) rebuilds the library and renders the three clips through the
  MCP server into `STUDIO_DATA`. `--no-render` builds the library and clips only.
- Committed evidence goes in `docs/showcase/` (`clips/`, `sheets/`, `reports/`, `studio/`) with an `INDEX.md`
  mapping each contract item to its files. Loop screenshots stay in the scratchpad.
- Finished PROGRESS.md files move to `docs/progress/<YYYY-MM-DD>-<slug>.md`.

## Conventions

- Commit style: see `git log` (imperative title, bulleted body).
- Node 24, ES modules, plain JS with JSDoc. New dependencies need a reason in PROGRESS.md **Decisions**.
- Write source files with the Write tool: Git Bash heredocs containing JS break in this harness.
- UI text: short, sentence case, no exclamation marks.
