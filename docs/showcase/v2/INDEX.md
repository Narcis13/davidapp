# Showcase evidence, iteration 2

Clips 4, 5 and 6 were built live, in that order, through the studio's MCP server and its request
flow (journals: [`showcase/journal/`](../../../showcase/journal)); `npm run showcase` replays clips
1 to 6 on an empty data directory. This folder is a committed snapshot of what the evidence scripts
write from that data directory, without the videos: the MP4s are on the
[`showcase-v2` release](https://github.com/Narcis13/davidapp/releases/tag/showcase-v2).

The final audit ran on an Apple M2 Mac (macOS 15.4, Node 24.15, FFmpeg 6.0) from an empty data dir:
`npm run showcase` (107 steps, 9 renders), then `scripts/hashes.mjs`, `scripts/evidence-v2.mjs`,
`scripts/reports-v2.mjs`, `scripts/parity.mjs`, `scripts/speed-compare.mjs`, the screen sweep and
`scripts/workflows-v2.mjs`. The iteration was built on another Mac and on Windows; hashes and render
times are per machine, so each was compared with a baseline taken on the same machine from the code
before the iteration (a worktree of `6c9f8cf`). The Windows results are kept next to the Mac ones.

## The clips

| clip | file | format | contact sheet (16 frames, in order) |
|---|---|---|---|
| 4 · Direct the studio | [horizontal](https://github.com/Narcis13/davidapp/releases/download/showcase-v2/clip-4-direct-the-studio.mp4) · [vertical](https://github.com/Narcis13/davidapp/releases/download/showcase-v2/clip-4-direct-the-studio-vertical.mp4) · [square](https://github.com/Narcis13/davidapp/releases/download/showcase-v2/clip-4-direct-the-studio-square.mp4) | one composition, 1920×1080 / 1080×1920 / 1080×1080, 30 fps, 30 s | [horizontal](sheets/clip-4-direct-the-studio.png) · [vertical](sheets/clip-4-direct-the-studio-vertical.png) · [square](sheets/clip-4-direct-the-studio-square.png) |
| 5 · A library in 3D | [mp4](https://github.com/Narcis13/davidapp/releases/download/showcase-v2/clip-5-a-library-in-3d.mp4) | vertical 1080×1920, 30 fps, 60 s | [sheet](sheets/clip-5-a-library-in-3d.png) |
| 6 · What the library holds | [mp4](https://github.com/Narcis13/davidapp/releases/download/showcase-v2/clip-6-what-the-library-holds.mp4) | square 1080×1080, 30 fps, 90 s | [sheet](sheets/clip-6-what-the-library-holds.png) |

## Contract → evidence

| # | what was promised | evidence |
|---|---|---|
| G1 | Typecheck, lint and tests pass | `npm run typecheck`, `npm run lint`, `npm test` (153 tests) |
| G2 | Every studio screen, old and new, clean at 1440×900 and 390×844 | [studio/sweep-desktop.png](studio/sweep-desktop.png) · [studio/sweep-phone.png](studio/sweep-phone.png) (contact sheets of the sweep), [reports/sweep.txt](reports/sweep.txt) (0 console or network problems) |
| G3 | The showcase rebuilds from an empty data dir | `npm run showcase`; [reports/renders.json](reports/renders.json) |
| D1 | Nothing old breaks: clips 1 to 3 hash the same as before the iteration | [reports/hashes-final-macos-m2.txt](reports/hashes-final-macos-m2.txt) against [baseline-hashes-macos-m2.json](reports/baseline-hashes-macos-m2.json); on Windows: [hashes-final.txt](reports/hashes-final.txt) against [baseline-hashes.json](reports/baseline-hashes.json). Old-shape compositions: `test/composition.test.js` ("composition v1 shapes normalize to exactly what they were", "an identity transform draws the same pixels as a v1 full-frame item") |
| D2 | Ask the agent from the playground, in Chrome: request → Claude Code over MCP → proposal live, compared → accepted as a new version | [gifs/ask-agent-asset.gif](gifs/ask-agent-asset.gif), thread [reports/request-asset.json](reports/request-asset.json) |
| D3 | A clip request ("add a lower third at 0:03") proposes a clip edit that is accepted | [reports/request-clip.json](reports/request-clip.json) (clip 5's request), [gifs/workflow-request.gif](gifs/workflow-request.gif) (from the editor, scripted) |
| D4 | Run now completes a real request through the `claude` CLI; without the CLI the button is hidden | [reports/run-now-thread.json](reports/run-now-thread.json); `test/requests.test.js` ("Run now: hidden without the claude CLI; …", timeout, cancel, the stub's tool limits) |
| D5 | Tweak and keep: params as a new version, as a preset used in a clip, metadata without a version, a version diff | [gifs/workflow-playground.gif](gifs/workflow-playground.gif), `studio/playground-*.png`; `test/kinds.test.js` (presets, metadata, defaults), `test/mcp.test.js` ("tweak and keep … over MCP") |
| D6 | Positioned, scaled, rotated and keyframed item: preview = Node render | [reports/parity.json](reports/parity.json) (case `transform`, and nine more), diff image [studio/parity-transform-diff.png](studio/parity-transform-diff.png) |
| D7 | One composition with per-format overrides in all three formats | the three clip 4 sheets above |
| D8 | On-canvas move, scale and rotate with snapping, in Chrome | [gifs/on-canvas-move-snap.gif](gifs/on-canvas-move-snap.gif), [gifs/on-canvas-rotate-scale.gif](gifs/on-canvas-rotate-scale.gif) (Claude in Chrome); [gifs/workflow-canvas.gif](gifs/workflow-canvas.gif) with every value checked in [reports/workflows.json](reports/workflows.json) |
| D9 | Dragging a layer changes the rendered z-order; undo and redo | [gifs/layers-drag.gif](gifs/layers-drag.gif) (Claude in Chrome), [gifs/workflow-layers.gif](gifs/workflow-layers.gif); Node frames [studio/zorder-title-behind.png](studio/zorder-title-behind.png) → [studio/zorder-title-in-front.png](studio/zorder-title-in-front.png), [reports/zorder.json](reports/zorder.json); `test/composition.test.js` |
| D10 | ≥ 4 motions, ≥ 3 transitions, ≥ 4 effects, a precomp from the editor, masks; contract tests | [reports/kinds.json](reports/kinds.json); `test/kinds.test.js`, `test/parity.test.js` |
| D11 | ≥ 3 procedural 3D assets, identical hashes over two renders, preview = render, text behind and in front, a baked sequence reused | [reports/3d.json](reports/3d.json); `test/solid.test.js`; parity cases `3d` and `sequence` |
| D12 | PNG, JPG and SVG dropped in Chrome; hostile SVG sanitised; the agent describes every upload and search finds them | [gifs/uploads.gif](gifs/uploads.gif) (Claude in Chrome), [gifs/workflow-uploads.gif](gifs/workflow-uploads.gif) (files dropped from outside); [reports/uploads.json](reports/uploads.json); `test/uploads.test.js` |
| D13 | 5,000 assets: search p95 < 100 ms, results < 1.5 s, bounded DOM, facets right, keyboard and bulk tagging | [reports/library-scale.json](reports/library-scale.json), [studio/library-5000-desktop.png](studio/library-5000-desktop.png), [studio/library-5000-phone.png](studio/library-5000-phone.png); `test/library-scale.test.js` |
| D14 | Clips 4 and 5 use every new feature | [reports/features.json](reports/features.json) |
| D15 | Clip 6 is cheaper than clips 4 and 5 on every measure | [reports/compounding.md](reports/compounding.md) (+ [compounding.json](reports/compounding.json)) |
| D16 | One clip in all three formats | clip 4: [horizontal](reports/clip-4-direct-the-studio.ffprobe.json) · [vertical](reports/clip-4-direct-the-studio-vertical.ffprobe.json) · [square](reports/clip-4-direct-the-studio-square.ffprobe.json) |
| D17 | Valid MP4s with audio, clean logs | [reports/renders.json](reports/renders.json) and the five `*.ffprobe.json` |
| D18 | Contact sheets read frame by frame | [sheets/](sheets) |
| D19 | Compounding table for clips 1 to 6 | [reports/compounding.md](reports/compounding.md), [reports/reuse.txt](reports/reuse.txt) |
| D20 | An MCP tool for every new capability; broken assets of each kind rejected | `test/mcp.test.js`, `test/kinds.test.js` ("a broken asset of each new kind is rejected …") |
| D21 | Live updates from MCP changes, no reload | [gifs/workflow-live.gif](gifs/workflow-live.gif), `studio/live-*.png`; `test/requests.test.js` ("HTTP: the event stream pushes changes from another process …") |
| D22 | Render speed against the code before the iteration; 3D and effects costs apart | [reports/render-speed-macos-m2.md](reports/render-speed-macos-m2.md) (this Mac), [reports/render-speed.md](reports/render-speed.md) (Windows) |
| D23 | Docs | [README](../../../README.md), [ASSET_CONTRACT](../../ASSET_CONTRACT.md), [COOKBOOK](../../COOKBOOK.md), `studio_guide` |
