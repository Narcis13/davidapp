# Progress

Goal: **Fablecut iteration 2: a studio you direct, a library that compounds.** Ask the agent from inside
the studio (a request queue in the database, worked by Claude Code over MCP, results as proposals you
compare and accept, live updates, optional "Run now" through the `claude` CLI); tweak and keep (versions
from params, presets, metadata edits, version diffs, a real code editor); free layout per format
(transforms, per-format overrides, keyframes, on-canvas manipulation); draggable layers and a full editor;
new asset kinds (motion, transition, effect, precomps, masks), procedural 3D, uploads with SVG
sanitising and agent descriptions; a library built for thousands of assets; a measured compounding loop
proven by clips 4, 5 and 6. Brief: `ITERATION_2_PROMPT.md`. Iteration 1's record:
`docs/progress/2026-10-02-fablecut-studio.md`.

Started 2026-10-06 on branch `main` at `f24ab12`.

**Next:** M2, events and live updates (events table, SSE), then the request queue and proposals
(`src/studio/requests.js`), MCP tools, HTTP routes, Run now with a stub `claude`.

## Contract (Done means)

Evidence goes in `docs/showcase/v2/` (`reports/`, `sheets/`, `studio/`, `gifs/`) with `INDEX.md`;
MP4s go on the GitHub release `showcase-v2`.

| # | criterion | verified by | evidence | status |
|---|---|---|---|---|
| G1 | Every gate in `.claude/goal-loop/gates` passes (typecheck, lint, test) | `gates.sh` | Log | open |
| G2 | Zero console/network problems on every studio screen (old and new) at 1440×900 and 390×844 | `sweep.sh` on the showcase data + Chrome console reads | `docs/showcase/v2/studio/`, Log | open |
| G3 | The showcase is reproducible: `npm run showcase` rebuilds the library and clips 1–6 (with uploads, their descriptions, requests and renders) from an empty data dir | final audit on an empty dir | `showcase/`, Log | open |
| D1 | Nothing old breaks: after the iteration, a fresh `npm run showcase` gives clips 1–3 frame hashes **identical** to the baseline taken on this machine before any code change (120 dense + 18 render samples per clip); compositions saved in the old shape load, edit and render | `scripts/hashes.mjs --compare docs/showcase/v2/reports/baseline-hashes.json`; tests on a legacy composition fixture | `reports/hashes-final.txt`, test names | open |
| D2 | Ask the agent, end to end, in Claude in Chrome (GIF): create a request on an asset in the playground → Claude Code works it over MCP → the proposal appears live without reload and is compared with the current version (same frame, same params) → accepted → a new version | Chrome workflow + GIF; request thread from the DB | `gifs/ask-agent-asset.gif`, `reports/request-asset.json` | open |
| D3 | A clip-scoped request ("add a lower third at 0:03") produces a proposed clip edit that is accepted | Chrome or headless workflow + thread | `reports/request-clip.json`, screenshots | open |
| D4 | "Run now" completes one real request through the `claude` CLI (tools limited to the studio MCP server, timeout, cancel, progress streamed into the thread); without the CLI on PATH the button is hidden (tested; tests use a stub `claude`) | real run (≤10 runs total) + `test/agent-run.test.js` | `reports/run-now-thread.json`, resulting version | open |
| D5 | Tweak and keep, through the UI and MCP: params saved as a new version (new defaults); params saved as a preset, then used in a clip; metadata edited without a new code version; a version diff shown (source + frame); tests cover presets, metadata edits and pinning | UI workflow (headless/Chrome) + MCP tools + tests | `studio/playground-*.png`, test names | open |
| D6 | An item positioned, scaled, rotated and keyframed renders the same in the browser preview and in Node (pixel-diff threshold, diff image) | `scripts/parity.mjs` (headless Chrome preview vs Node frame) | `reports/parity-transform.json`, `studio/parity-transform-diff.png` | open |
| D7 | One composition with per-format overrides renders correctly in vertical, horizontal and square | frames/sheets of one clip in all three formats, read | `sheets/<clip>-{vertical,horizontal,square}.png` | open |
| D8 | On-canvas move, scale and rotate with snapping, driven in Chrome (GIF); inspector fields stay in sync | Chrome workflow | `gifs/on-canvas.gif` | open |
| D9 | Layers: dragging a track or an item to another layer changes the rendered z-order (a title goes from in front of a shape to behind it, checked in the rendered frame); undo restores, redo reapplies; drag recorded in Chrome (GIF); tests cover the composition operations | Chrome GIF + pixel check of the Node frame + `test/composition.test.js` | `gifs/layers-drag.gif`, `reports/zorder.json` | open |
| D10 | New kinds: ≥4 `motion`, ≥3 `transition`, ≥4 `effect` assets, ≥1 precomp made from layers in the editor, masks/mattes; each kind has contract tests (validation, determinism, preview/render parity); every kind appears in the showcase | tests + library listing + parity script + showcase | `reports/kinds.json`, test names | open |
| D11 | 3D: ≥3 procedural 3D assets; two renders give identical frame hashes; preview matches render; a clip uses a 3D piece with 2D text both behind and in front of it; a baked alpha sequence is reused in a second clip | tests + parity + render hashes + lineage | `reports/3d.json`, `sheets/` | open |
| D12 | Uploads: PNG, JPG and SVG uploaded by drag-and-drop in Chrome (GIF); a hostile SVG (script, `onload`, external `href`, `foreignObject`) is sanitised or rejected (tested); the agent describes and tags every uploaded image through MCP (image content), and they are then found by those tags in library search; test images are made here, not downloaded | Chrome GIF + `test/uploads.test.js` + MCP + search | `gifs/uploads.gif`, `reports/uploads.json` | open |
| D13 | Library at scale on a synthetic library of 5,000 assets: search API p95 < 100 ms (measured); the library screen shows results within 1.5 s; scrolling to the end keeps the DOM node count bounded (measured); facet counts correct (tested); keyboard navigation and bulk tagging work; clean at 1440×900 and 390×844 | `scripts/synth-library.mjs` + `scripts/bench-library.mjs` + headless | `reports/library-scale.json`, `studio/library-5000-*.png` | open |
| D14 | Clips 4, 5, 6 (30 s, 60 s, 90 s) built in that order through the MCP server and the request flow; 4 and 5 between them use every new feature (transforms + keyframes, per-format layouts, dragged layer order, motion, transitions, effects, a precomp, a preset, 3D, an uploaded image, an uploaded SVG) | feature checklist script over the compositions | `reports/features.json` | open |
| D15 | Clip 6 is the proof: built after clip 5 is rendered, mostly from what 4 and 5 made, reuses ≥1 asset from each of 4 and 5 and from clips 1 and 2; compared with clip 4 and with clip 5 it has less wall-clock build time, fewer MCP calls, less new asset code and a higher reuse share; and clearly less new asset code than any of clips 1–3 | MCP call log + compounding report | `reports/compounding.md` | open |
| D16 | At least one of clips 4–6 rendered in all three formats from one composition | renders with a `format` override | `reports/ffprobe-*.json` | open |
| D17 | Clips 4–6 are valid MP4s: H.264, AAC, yuv420p, faststart, expected size and fps, durations 30/60/90 s within one frame; non-silent audio; zero errors in render and server logs | `scripts/evidence.mjs` (ffprobe, volumedetect, logs) | `reports/<clip>.ffprobe.json`, `<clip>.audio.txt` | open |
| D18 | Contact sheets of clips 4–6 read frame by frame: nothing blank, clipped, garbled or overflowing | FFmpeg tile sheets, read | `sheets/`, Log | open |
| D19 | Extended reuse report: compounding table for clips 1–6 (MCP calls, new lines of asset code, reuse share, build time, build time per second of output) with a note on what made clip 6 cheaper | `reuse_report` / `scripts/compounding.mjs` | `reports/compounding.md`, `reports/reuse.txt` | open |
| D20 | MCP: every new capability has a tool (requests, proposals, presets, metadata, transforms and layers, uploads and descriptions, `suggest_assets`, baking), covered by the stdio client test; a broken asset of each new kind is rejected with a useful error and crashes nothing | `test/mcp.test.js` | test names | open |
| D21 | Live updates: the studio refreshes on library, clip and request changes, including changes made through MCP outside any request, without reloading | headless: MCP change while a page is open, DOM checked | `studio/live-*.png`, Log | open |
| D22 | Speed: a 30 s 1080p render re-measured on this machine with the method recorded; the 2D showcase clips 1–3 are no more than 10 % slower than the baseline; 3D and effects costs reported separately | `scripts/speed.mjs` vs `reports/baseline-speed.json` | `reports/render-speed.md` | open |
| D23 | Docs: `README.md`, `docs/ASSET_CONTRACT.md` (transforms, keyframes, every new kind) and `studio_guide` describe the new features, with clips 4, 5, 6 linked | read them | files | open |
| D24 | Repo hygiene: no database, renders, caches or scratch in git; MP4s only on the `showcase-v2` release; new dependencies justified under Decisions; test images and their descriptions reproducible from the repo | `git status`, `gh release view showcase-v2` | Log | open |

Status: `open` → `pass` (with evidence) or `blocked` (see Blocked).

## Milestones

0. [x] **Baseline**: project.md for macOS (committed on its own), frame-hash and speed baselines, contract and plan
1. [x] **Composition v2 in the runtime**: transforms, per-format overrides, keyframes with easing, image layers, layer ops (move track/item, lock/solo/mute, rename), render in another format; old path untouched; tests (D1, D6 groundwork, D7, D9 tests)
2. [ ] **Events, requests and proposals**: events table + SSE, request queue, proposals with accept/reject/reply and conflict rules, MCP tools, HTTP routes, Run now with a stub `claude` (D2–D4 backend, D20, D21)
3. [ ] **New asset kinds**: motion, transition, effect (`f.lib.fx`), masks/mattes, precomps (`f.layers`, save as asset), presets, metadata overlay, version diff, save-params-as-defaults (D5 backend, D10)
4. [ ] **3D and baking**: `f.lib.solid` software rasterizer, ≥3 3D assets, sequence assets baked from any visual asset (D11)
5. [ ] **Uploads**: upload API, content-hash dedupe, palette, thumbnails, SVG sanitiser + vector model, needs-description queue, MCP image results (D12 backend)
6. [ ] **Library at scale (backend)**: ranked search, facets with counts, sorting, favourites, collections, recent, featured, filmstrips, synthetic library + bench (D13 backend)
7. [ ] **Studio UI**: library overhaul, playground (editor, presets, diff, metadata, ask-agent thread), clip editor (on-canvas, keyframes, layers, undo, multi-select, split, snapping, track flags, waveforms, shortcuts, formats, kinds) (D2–D9, D12, D13, D21)
8. [ ] **Compounding loop**: `suggest_assets`, notes, usage examples, brand kit/theme, cookbook in `studio_guide`, MCP call log and compounding report (D15, D19)
9. [ ] **Clips 4 and 5**: authored through MCP and the request flow, rendered (all three formats for one), evidence (D14, D16–D18)
10. [ ] **Clip 6**: built after clip 5 renders, measured, compounding report (D15, D19)
11. [ ] **Browser workflows**: GIFs in Claude in Chrome: ask-agent, on-canvas, layers drag, uploads (D2, D8, D9, D12)
12. [ ] **Final audit**: speed, docs, reviewer pass, clean rebuild, hashes, sweep, evidence index, release (all)

## Decisions

- **Hash baseline on this machine** (macOS, Apple Color Emoji): `scripts/hashes.mjs` records, per showcase clip, the 18 sampled hashes of its first render and 120 dense frames (every 8th) drawn through MCP `frame_hashes`. Two builds from empty data dirs matched exactly. `docs/showcase/v2/reports/baseline-hashes.json`.
- **Speed baseline**: `scripts/speed.mjs`, three renders per clip on the iteration-1 code, median `renderSeconds`: clip 1 27.4 s, clip 2 30.1 s, clip 3 17.0 s (8 workers). Run-to-run spread is about ±15 % on this machine, so the final comparison uses more runs, interleaved, on a quiet machine. `reports/baseline-speed.json`.
- **Old shape = old code path.** Composition v2 is a superset of v1: every new field is optional. An item with none of them (no transform, keyframes, motions, effects, mask, transition, format override) is drawn by exactly the iteration-1 code, so old clips stay byte-identical. Anything new goes through a new path.
- **Transform model.** A visual item gets `transform: { space, x, y, width, height, anchorX, anchorY, scale, scaleX, scaleY, rotation }`. `space` is `frame` (default) or `safe`; x, y, width, height are fractions of that rectangle, so a layout means the same thing in every format. The item draws into a width×height box (that is its `f.width/f.height`; a full-frame box keeps the frame's safe zone), the box's anchor point sits at (x, y), and the box is scaled and rotated (degrees) about the anchor. Opacity and blend stay item fields. The legacy `box` is read as a transform with the same box. Drawing is a canvas transform, not a resample, so vectors stay sharp.
- **Per-format overrides**: `item.formats[vertical|horizontal|square] = { transform?, keyframes?, params?, hidden? }`, merged over the base (transform and params key by key). The composition's own format edits the base; the editor's other format tabs edit that format's override. Remix and `start_render { format }` render one composition in another format with that format's overrides.
- **Keyframes**: `item.keyframes[prop] = [{ t, v, ease }]` with item-local t. Props: the transform fields, `opacity`, and `params.<name>` for numeric and colour params. Easing names come from the `easing` asset family: the composition pins one (`composition.easing = "easing@1"`, added on first use), so a keyframe's curve is a library asset, versioned and traced like any other. Colours interpolate per channel in sRGB.
- **Layers**: tracks still draw bottom to top in array order. New edit ops `move_track { id, index }`, `move_item { id, track, index }`, `update_track { id, name, locked, hidden, solo, muted }`. Solo shows only soloed visual tracks; mute silences audio tracks.
- **Proposals are not drafts and not versions.** A *version* is immutable library content that clips pin. A *draft* is the user's unsaved source in the playground (client state, validated, never stored). A *proposal* is an agent's suggested change stored with its request: validated source, a new asset, clip edit operations or metadata, plus the base it was made against (asset version or clip revision), test frames and a thumbnail. It changes nothing until accepted; accepting turns it into a version (or a clip revision) with the note "accepted from request #n".
- **Concurrent edits.** An asset proposal made against v2 while the asset moved to v3 is a conflict on accept: the studio says so and offers "accept as v4 anyway" (nothing is lost; versions are immutable) or "ask the agent to rebase". A clip proposal is a list of edit operations plus the base revision; on accept they are re-applied to the current composition, so they rebase cleanly when the ids they touch still exist, and conflict otherwise. An editor with unsaved changes hears about a newer revision live and offers reload or keep (the revision guard refuses a blind overwrite).
- **Request lifecycle**: `open` (waiting for the agent) → `working` (claimed, with a lease and heartbeat; an expired lease returns it to open) → `review` (a pending proposal) → `done` (accepted, or completed by the agent with a reply) / `cancelled`. A user reply sends it back to `open` and supersedes the pending proposal when the next one arrives. Reject with a reason sends it back to `open`; reject without one closes it.
- **Live updates are driven by the database**: an `events` table written in the same transaction as every change (by any process); the web server tails it (cheap `PRAGMA data_version` check every 250 ms) and pushes server-sent events; the UI refreshes what it shows. The MCP process and the web server never talk directly.
- **Split keeps time**: items gained `offset` (seconds into the asset where the item starts) and `assetDuration` (the asset timeline it is cut from). `split_item` gives the second part offset = cut and both parts the whole asset duration, so the frames on both sides of a cut are identical (tested). Audio items honour the offset in the mix (`atrim=offset:offset+duration`).
- **Image layers**: a visual track takes image assets directly, drawn into the transformed box with `params.fit` contain (default), cover (cropped to the box) or fill.
- **Render in another format**: `start_render { format }` (and `renders.enqueue`) snapshot the composition reformatted, so one composition renders vertical, horizontal and square with each format's overrides; the render row records its format (`renders.format`, added by an idempotent column migration in `openDb`).
- *(more decisions are added as each milestone lands)*

## Blocked

- *(none)*

## Notes

- The first headless Chrome launch after a while can exceed `cdp.mjs`'s wait ("chrome did not start") and `sweep.sh` still prints `ok`: check every screen's PNG exists.
- `frame_hashes` takes at most 64 times per call; `start_render` waits at most 900 s.
- Render time on this machine varies ±15 % run to run (25–32 s for clip 1).
- `clips/history-of-ai/` is the user's own clip (not in the showcase plan); useful as a second old-shape composition.

## Log

- 2026-10-06: baseline on the iteration-1 code (`f24ab12`). `npm run showcase` on an empty dir: 50 steps, renders 25.0 / 26.7 / 15.7 s; a second empty-dir build reproduced all 360 dense hashes and 54 render samples. Speed: medians 27.4 / 30.1 / 17.0 s (3 runs). Gates: typecheck PASS, lint PASS, test PASS (56). Sweep on the showcase data: 17 screens, 0 problems (library reshot after a Chrome cold start); server log 0 ERROR lines.
- 2026-10-06: M1 done: `src/core/transform.js` (geometry, keyframes, per-format overrides), v2 normalization and validation, a new drawing path for v2 items and image layers (the v1 loop is untouched), easing pinned per composition, edit ops (move_track, move_item index, update_track, set_transform, keyframes, set_override, split_item, duplicate_item), audio offset/mute/solo, render in another format. `test/composition.test.js` (14): v1 shapes normalize unchanged, identity transform = v1 pixels, rotation/scale/keyframes/overrides/z-order/solo/images/split continuity checked on rendered pixels. Showcase rebuilt from empty: all 360 dense + 54 render hashes identical to the baseline. Gates: typecheck PASS, lint PASS, test PASS (70; one expected message changed from "takes visual assets" to "takes visual or image assets").
