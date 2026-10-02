# Progress

Goal: **Fablecut**, a studio app for making videos with code, where every clip leaves reusable
building blocks behind. Assets (parameterized JS functions, images, sounds, fonts) live in a
versioned SQLite library; clips are declarative compositions that pin asset versions; frames render
from one asset runtime in both the studio preview and the FFmpeg export; an MCP server lets Claude
Code create and edit assets and clips; three showcase clips prove the compounding. Brief:
`INITIAL_PROMPT.md`.

Started 2026-10-02 on branch `main` at `53f094f`.

**Next:** integrate and verify the studio UI the subagent built (`src/ui`, sweep with `.claude/goal-loop/screens`), then M8: build the showcase into a clean data dir, `npm run evidence` + `npm run verify` into `docs/showcase/`, drive the playground and a render in the built-in browser, README.

## Contract (Done means)

| # | criterion | verified by | evidence | status |
|---|---|---|---|---|
| G1 | Every gate in `.claude/goal-loop/gates` passes (typecheck, lint, tests) | `gates.sh` | Log | open |
| G2 | Zero console/network problems on every studio screen at 1440×900 and 390×844 | `sweep.sh` + built-in browser console | Log, `docs/showcase/studio/` | open |
| G3 | Showcase reproducible from the repo: `npm run showcase` rebuilds library + 3 clips from an empty data dir through the MCP server | final audit on empty data | `showcase/`, Log | open |
| D1 | Three showcase clips made in order through the MCP pipeline, each 30–120 s, ≥1 vertical 1080×1920 and ≥1 horizontal 1920×1080, zero errors in render and server logs | `showcase/build.mjs` (MCP client) + render rows (`log` empty, status done) + server log grep | `docs/showcase/clips/*.mp4`, `docs/showcase/reports/renders.json` | open |
| D2 | Clip 1 creates its own assets; clip 2 reuses ≥3 clip-1 assets; clip 3 reuses assets from clip 1 and clip 2; DB records it; lineage view shows it; a script prints it | `npm run report:reuse` + lineage screenshot | `docs/showcase/reports/reuse.txt`, `docs/showcase/studio/lineage-*.png` | open |
| D3 | Each clip is a valid MP4: H.264 + AAC, expected resolution/fps, ≥30 s, yuv420p, faststart | `ffprobe` JSON per clip | `docs/showcase/reports/<clip>.ffprobe.json` | open |
| D4 | Each clip has a non-silent audio track | `ffmpeg volumedetect` mean/max volume | `docs/showcase/reports/<clip>.audio.txt` | open |
| D5 | Each clip's contact sheet (FFmpeg `tile`) looked at frame by frame: nothing blank, broken, clipped, garbled or overflowing | FFmpeg tile sheets from the MP4s, read with the Read tool | `docs/showcase/sheets/<clip>-*.png`, Log | open |
| D6 | ≥6 distinct text-animation assets in the library; the three clips use ≥4 of them | `search_assets tags:[text-animation]` + reuse report | `docs/showcase/reports/text-animations.txt` | open |
| D7 | An asset used in a clip composes ≥2 other assets, ≥3 levels deep | `list_clip_assets` depth + `get_asset` deps | `docs/showcase/reports/composition-depth.txt` | open |
| D8 | Versioning holds: a clip-1 asset is edited through MCP into a new version; clip 1 re-renders to the same frame hashes; a clip pinning the new version differs | `scripts/verify.mjs` (MCP `frame_hashes` before/after + repinned copy) | `docs/showcase/reports/versioning.json` | open |
| D9 | Rendering is deterministic: two renders of the same clip give identical sampled frame hashes | two full renders, compare `stats.frameHashes` | `docs/showcase/reports/determinism.json` | open |
| D10 | MCP server works end to end: scripted client searches, creates, edits to a new version, renders a frame to PNG, starts a render that completes; a broken asset is rejected with a useful error and nothing crashes; registered in `.mcp.json` | `test/mcp.test.js` over stdio | Log (test names), `.mcp.json` | open |
| D11 | Studio UI works: library search + filter, asset playground (param change updates preview), clip preview with scrubbing, render queue with a live render, gallery playing a finished clip, lineage view; at 1440×900 and 390×844 | sweep + interactions driven with `cdp.mjs --js` and the built-in browser | `docs/showcase/studio/*.png` | open |
| D12 | Asset-playground workflow and starting a render from the UI are driven in a real browser and recorded (GIF, or screenshot sequence) | built-in browser (`mcp__Claude_Browser__*`) | `docs/showcase/studio/workflow-*.png` | open |
| D13 | Render speed measured: seconds to render a 30 s 1080p clip on this machine, with method; target < 5 min | render stats of the showcase clips (wall clock, frames/s, workers) | `docs/showcase/reports/render-speed.md` | open |
| D14 | Tests cover the asset contract (schema validation, determinism, composition, version pinning), composition→frames, the DB layer, the MCP tools | `npm test` | `test/*.test.js`, Log | open |
| D15 | README explains running the studio, writing an asset, using the MCP server from Claude Code, making a clip; links the three clips | read it | `README.md` | open |
| D16 | Same asset code drives preview and render (one runtime, `src/core`), preview frame ≈ rendered frame | side-by-side of browser preview vs server frame | `docs/showcase/studio/preview-vs-render.png` | open |
| D17 | Asset code runs isolated with timeouts; a bad asset can't crash server or studio | tests (endless loop, throw) + UI check with a failing asset | Log | open |
| D18 | Repo hygiene: no DB/scratch/caches committed; fonts' licenses in repo; MP4s committed only if < 50 MB each | `git status`, `ls -la docs/showcase/clips` | Log | open |

Status: `open` → `pass` (with evidence) or `blocked` (see Blocked).

## Milestones

1. [x] **Engine**: asset contract + runtime (`src/core`), text layout, schema, seeded RNG, Node host with vm sandbox, worker pool with watchdog (D14, D17)
2. [x] **Library + clips + render pipeline**: SQLite schema, versioned assets with validation, pinned clips, audio synth + beat detection, parallel frame render → FFmpeg, queue with progress/cancel (D14, D9 groundwork)
3. [x] **MCP server**: 25 tools, `.mcp.json`, scripted stdio client test (D10)
4. [ ] **Studio server + UI**: HTTP API, library, playground, clip editor, queue, gallery, lineage; preview worker running the same runtime (D11, D16, G2)
5. [x] **Showcase clip 1** (vertical): 28 assets (easing, spring, themes, 8 text animations, graphics, scenes, synth music, a baked image) + composition; renders in ~6 s (D1–D7; evidence is collected in M8)
6. [x] **Showcase clip 2** (horizontal): 7 new assets, 24 reused from clip 1, `text-word-reveal` edited to v2 through MCP (D2, D8)
7. [x] **Showcase clip 3** (square): 3 new assets + a baked sound, 25 reused from clip 1 and 5 from clip 2 (D2)
8. [ ] **Verification + docs**: verify script (versioning, determinism, reuse, speed), contact sheets read, browser-driven workflows, README, reviewer pass (D8, D9, D12, D13, D15)
9. [ ] **Final audit**: clean data dir, rebuild showcase from the repo, all gates, full sweep, every contract item checked

## Decisions

- **Render stack: `@napi-rs/canvas` (Skia) in Node worker threads → raw RGBA → FFmpeg stdin.** Weighed against headless Chrome + canvas capture. Skia-in-Node: no browser to manage, raw frames with no PNG encode, trivially parallel across worker threads, CPU raster is deterministic (frame hashes are stable), ~16 ms/frame at 1080×1920 in the spike. Chrome: pixel-identical to the browser preview and richer text shaping, but capture is slow (PNG/base64 over CDP), GPU paths make hashes less trustworthy, and it is a heavy dependency for a server. The preview keeps "one source of truth" because the *same runtime module and the same asset source* run in the browser against the browser's Canvas 2D (also Skia); the server can always render the exact frame for comparison. *(overrule if you want Chrome-exact output)*
- **Asset contract**: one `asset({...})` call per source; `render(f, p)` is a pure function of `(f.t, p)`; kinds `visual` / `value` / `audio`; metadata and parameter schema live in the source and are extracted on save; `uses` are pinned to exact versions when a version is saved. Long form in `docs/ASSET_CONTRACT.md`.
- **Easing, springs, themes are assets, not engine built-ins**, so "scene → lower-third → text reveal → easing" is a real call tree and they show up in lineage. The engine's `f.lib` holds only math, color, text layout, noise, beat and DSP helpers.
- **Isolation**: asset code runs only in worker threads, each asset in its own `vm` context with no host globals, `Math.random`/`Date.now` guarded; a pool watchdog terminates a worker that overruns its timeout. In the browser preview the same code runs in a Web Worker with a watchdog. This is protection against buggy code, not a security boundary against hostile code.
- **SQLite via `node:sqlite`** (built into Node 24): no native dependency. FTS5 for search. Triggers make `asset_versions` rows immutable at the database level.
- **Queue lives in the database**, so the MCP server and the web server share it; whichever process runs a runner claims jobs atomically. A stale heartbeat marks an orphaned job failed.
- **Beats come from the audio**: music is synthesized by `audio` assets, then analysed (low-band energy flux) into `f.clip.beats`.
- **Audio items are separate FFmpeg inputs** mixed with `adelay/afade/volume/amix/alimiter` (the brief asks for FFmpeg to mix); a clip with no audio items gets a silent AAC track.
- **Emoji use the system emoji font** (Segoe UI Emoji on Windows) via fallback: the open Noto Color Emoji subsets (COLRv1) did not render in Skia's Node build. Text layout treats emoji/ZWJ sequences as single graphemes. Emoji pixels therefore depend on the OS.
- **Typecheck gate** is `tsc --checkJs` (non-strict) over everything except `src/ui`; the UI is covered by ESLint and the browser sweep. Plain JS + JSDoc, no build step, so the browser loads `src/core` directly.
- **Clip edits bump a revision; renders snapshot the composition** they were made from, so the gallery can always say exactly what was rendered.
- **The showcase is a replayable plan** (`showcase/plan.mjs`): an ordered list of MCP tool calls that `showcase/build.mjs` sends to the real MCP server over stdio. Building it into an empty data dir reproduces the library, the lineage and the three renders. While authoring I rebuilt from scratch on every iteration, so the committed history is clean (each asset at v1, one v2).
- **Square 1080×1080 for clip 3** (the brief's bonus format), so the three clips cover all three formats.
- **Strict render logs**: any line FFmpeg writes at warning level fails the showcase build; audio inputs are opened with `-guess_layout_max 0` so a WAV without a channel mask does not produce one.
- **A reused version is credited to the clip it was made for**: clip 3 using `text-word-reveal@2` counts as reuse from clip 2.
- Additions beyond the brief: `validate_asset` dry-run filmstrips, clip contact sheets without encoding, `bake_asset` (frame → image asset with lineage), `remix_clip`, `repin_clip`, SRT export from `cues` params, `value` asset previews, per-render sampled frame hashes.

## Blocked

- *(none)*

## Notes

- Git Bash heredocs with JS inside (`<<'EOF'` containing backticks/quotes) fail in this harness: write source files with the Write tool.
- `export TMPDIR=$LOCALAPPDATA/Temp/claude/C--dev-davidapp/<session>/scratchpad` before gates; `CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"` for `cdp.mjs`.
- FFmpeg is not on PATH in Git Bash; the app finds it via `FFMPEG_PATH`, PATH, then `%LOCALAPPDATA%\Microsoft\WinGet\Links`.
- A killed child's `exitCode` stays null on Windows; track `'close'` instead (bit `renderVideo` once).
- WAVs are written as WAVE_FORMAT_EXTENSIBLE so FFmpeg does not warn "Guessed Channel Layout".
- Errors thrown inside a vm context are from another realm: no `instanceof Error`.
- Don't write `\n` or `\t` inside `node - <<'EOF'` patch scripts: they land in the file as real newlines/tabs. Use the Edit tool for lines with escapes.
- Text animations settle into the same pixels in v1 and v2 of `text-word-reveal`; the versions differ only while words arrive, so `verify.mjs` compares frames from the first second of the item.
- FFmpeg `fps=1` contact sheets sample just before each beat, so `beat-bars` look flat there; they do jump (see the clip sheets rendered with `render_clip_frame`).
- `node --test` needs the glob `"test/*.test.js"` on Windows (a bare `test/` is taken as a module path).

## Log

- 2026-10-02: baseline: empty repo (only the goal-loop skill and the brief). Spikes: Skia canvas + woff2 fonts + emoji fallback OK, raw RGBA → FFmpeg pipe OK (60 frames 1080×1920 in 1.26 s), `node:sqlite` FTS5 OK.
- 2026-10-02: M1–M3 done. Gates: typecheck PASS, lint PASS, test PASS (40 tests: core 15, library 12, pipeline 8, mcp 5). Verified by tests: broken assets rejected with asset name + line; endless loop killed by watchdog; version pinning by frame hash; MP4 probes as h264/yuv420p/aac with faststart; two renders give equal sampled hashes; MCP client over stdio creates, edits, renders.
- 2026-10-02: M4 server side (HTTP API, Range media, preview worker running `src/core` in a Web Worker: checked headless, clip + asset frames draw). UI screens delegated to a subagent (`src/ui`), still running.
- 2026-10-02: M5–M7: 38 showcase assets and 3 compositions authored; `showcase/build.mjs` replays 49 MCP calls on an empty data dir in ~23 s including the three renders (clip 1: 6.3 s, clip 2: 7.9 s, clip 3: 4.6 s for 32 s each, 8 workers). Looked at every frame of all six FFmpeg contact sheets (16 tiles each): no blank, clipped or overflowing frames; fixed along the way: lost code indentation (text layout now keeps leading whitespace), a visible box from the kinetic flash, low-contrast stat labels, tiny lower-thirds and badge digits, a pink accent on a pink background. `scripts/verify.mjs`: clip 1 unchanged after the v2 edit (18 hashes), re-pinned copy differs while the words arrive, second renders of all three clips match the first (18 hashes each). Gates: typecheck PASS, lint PASS, test PASS (42).
