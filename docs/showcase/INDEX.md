# Showcase evidence

Three clips made in order through the studio's MCP server (`npm run showcase` replays the 51 tool
calls in [`showcase/plan.mjs`](../../showcase/plan.mjs) on an empty data directory), plus the
checks that the properties the studio promises actually hold. This folder is a committed snapshot
of what `npm run evidence` and `npm run verify` write to `output/showcase/` from that data
directory, without the videos: the MP4s are attached to the
[`showcase-v1` release](https://github.com/Narcis13/davidapp/releases/tag/showcase-v1); the studio screenshots come from
the screen sweep (`.claude/goal-loop/screens`) and a scripted workflow.

## The clips

| clip | file | format | sheets (one frame per second, in order) |
|---|---|---|---|
| 1 · Every frame is a function | [clip-1-every-frame.mp4](https://github.com/Narcis13/davidapp/releases/download/showcase-v1/clip-1-every-frame.mp4) · [srt](posters/clip-1-every-frame.srt) | vertical 1080×1920, 30 fps, 32 s | [1](sheets/clip-1-every-frame-1.png) · [2](sheets/clip-1-every-frame-2.png) |
| 2 · The library compounds | [clip-2-compounding.mp4](https://github.com/Narcis13/davidapp/releases/download/showcase-v1/clip-2-compounding.mp4) · [srt](posters/clip-2-compounding.srt) | horizontal 1920×1080, 30 fps, 32 s | [1](sheets/clip-2-compounding-1.png) · [2](sheets/clip-2-compounding-2.png) |
| 3 · What's new in Fablecut | [clip-3-release-notes.mp4](https://github.com/Narcis13/davidapp/releases/download/showcase-v1/clip-3-release-notes.mp4) · [srt](posters/clip-3-release-notes.srt) | square 1080×1080, 30 fps, 32 s | [1](sheets/clip-3-release-notes-1.png) · [2](sheets/clip-3-release-notes-2.png) |

## Contract → evidence

| # | what was promised | evidence |
|---|---|---|
| D1 | Three clips, 30–120 s, one vertical and one horizontal, made through the pipeline with no errors in the render logs | [reports/renders.json](reports/renders.json) (`status`, `ffmpegLog`, `error` per render), the MP4s above |
| D2 | Clip 1 creates, clip 2 reuses ≥ 3 from clip 1, clip 3 reuses from both; recorded in the database and shown in the studio | [reports/reuse.txt](reports/reuse.txt), [studio/lineage-desktop.png](studio/lineage-desktop.png), [studio/lineage-phone.png](studio/lineage-phone.png) |
| D3 | Valid MP4s: H.264 + AAC, expected size and frame rate, ≥ 30 s | [clip 1](reports/clip-1-every-frame.ffprobe.json) · [clip 2](reports/clip-2-compounding.ffprobe.json) · [clip 3](reports/clip-3-release-notes.ffprobe.json) |
| D4 | A non-silent audio track in each | [clip 1](reports/clip-1-every-frame.audio.txt) · [clip 2](reports/clip-2-compounding.audio.txt) · [clip 3](reports/clip-3-release-notes.audio.txt) |
| D5 | Contact sheets looked at frame by frame | [sheets/](sheets) (six sheets of 16 frames, cut from the MP4s with FFmpeg's `tile`) |
| D6 | ≥ 6 text-animation assets, ≥ 4 used by the clips | [reports/text-animations.txt](reports/text-animations.txt) |
| D7 | A used asset composes ≥ 2 others, ≥ 3 levels deep | [reports/composition-depth.txt](reports/composition-depth.txt) |
| D8 | An asset of clip 1 edited through MCP into a new version; clip 1 unchanged; a clip pinning the new version differs | [reports/versioning.json](reports/versioning.json) |
| D9 | Two renders of the same clip give the same frame hashes | [reports/determinism.json](reports/determinism.json) |
| D11 | Studio screens at 1440×900 and 390×844 | [studio/](studio): `library`, `playground`, `clips`, `editor`, `renders`, `gallery`, `gallery-player`, `lineage`, each `-desktop` and `-phone`; a render in progress: [studio/renders-live-desktop.png](studio/renders-live-desktop.png) |
| D12 | Playground and render workflows driven in a real browser (Claude in Chrome, recorded with its GIF tool) | [studio/workflow-playground.gif](studio/workflow-playground.gif): change a colour and a word, safe zone, format, exact frame · [studio/workflow-render.gif](studio/workflow-render.gif): scrub the clip, start a render from the editor, watch the queue, play the result in the gallery |
| D13 | Render speed, measured | [reports/render-speed.md](reports/render-speed.md) |
| D16 | Preview and render come from the same asset code | [studio/preview-vs-render.png](studio/preview-vs-render.png) |

D10 (MCP end to end), D14 (tests) and D17 (isolation) are checked by the test suite: `npm test`.

`clip-1-repinned`, the fourth clip in `reuse.txt` and in the lineage screenshots, is the copy of
clip 1 that `npm run verify` makes to show what version 2 of the word reveal changes.
