# Iteration 3 evidence: finished videos, checked by the studio

Each contract item of `PROGRESS.md` and where it is shown. Paths are relative to this folder unless they start
with `test/`, `src/` or `scripts/`. The MP4s are on the GitHub release
[`showcase-v3`](https://github.com/Narcis13/davidapp/releases/tag/showcase-v3); everything here was made on the
Windows 11 PC (i9-14900KF) from a fresh `npm run showcase` into an empty data dir, unless noted.

The videos:

| clip | file on the release | length, size | loudness (FFmpeg `ebur128` on the file) | report |
|---|---|---|---|---|
| 7 A video that checks itself | `clip-7-a-video-that-checks-itself.mp4` | 62 s, 1920×1080, 30 fps | see the report | `reports/clip-7-horizontal.render-report.json` |
| 7, vertical render of the same composition | `clip-7-a-video-that-checks-itself-vertical.mp4` | 62 s, 1080×1920, 30 fps | see the report | `reports/clip-7-vertical.render-report.json` |
| 8 Cuvinte pe ritm | `clip-8-cuvinte-pe-ritm.mp4` | 38.4 s, 1080×1920, 30 fps | see the report | `reports/clip-8-vertical.render-report.json` |

## General

| # | item | evidence |
|---|---|---|
| G1 | gates (typecheck, lint, test) | `PROGRESS.md` Log: 287 tests pass |
| G2 | every screen clean at 1440×900 and 390×844, server log without ERROR | `reports/sweep.txt`, `studio/sweep/*.png` |
| G3 | the showcase rebuilds from an empty data dir | `reports/showcase-build.txt` (the build's steps), `showcase/`, `PROGRESS.md` Log |

## Nothing old breaks

| # | item | evidence |
|---|---|---|
| D1 | clips 1–6 and `history-of-ai` hashes identical to the baseline; old shapes load, edit, render | `reports/baseline-hashes.json` (taken before any code change), `reports/hashes-final.txt` (the comparison); tests `composition v1 shapes normalize to exactly what they were`, `typed markers: the old shape normalizes to itself…`, `layout report: recording and suppressing change nothing when off`, `fonts: the Latin Extended alias comes right after the family; Latin pixels are unchanged…` |

## Narration and captions

| # | item | evidence |
|---|---|---|
| D2 | narration asset; word timings from word lists, character alignment, whisper.cpp; a new take keeps word ids | `test/words.test.js` (`importWords: …` for Deepgram, OpenAI, AssemblyAI, ElevenLabs, whisper.cpp `-ojf`, `-oj`, `-ml 1`); `test/narration.test.js` `a narration imports whisper.cpp word timings…`; clip 7: `reports/clip-7-voice.json` |
| D3 | `f.clip.words` in every asset | `test/narration.test.js` `words reach assets as f.clip.words…`; clip 7's `word-strip` and `text-captions@2` read them |
| D4 | word anchors (start, keyframe, marker) within 2 frames, also after a re-timed take; the anchor report | `test/narration.test.js` `…anchors land within 2 frames of their words, and stay after a re-timed take`; clip 7's 31 anchors: `reports/clip-7-voice.json` (`anchors`) |
| D5 | transcript check: slip, drop, insertion; case, punctuation and numerals pass | `test/words.test.js` `checkTranscript: a planted slip, drop and insertion are each named with their index` and `checkTranscript: only case, punctuation and numerals differ -> ok`; `test/narration.test.js`; clip 7 checked against two transcripts: `reports/clip-7-voice.json` (`transcript`) |
| D6 | caption pages obey every rule; edits over MCP and in the composition | `test/captions.test.js` (numbers with units, names, long words, punctuation, short gaps, lead, minDuration, 32/20 chars, structure edits, `checkPages`); MCP `caption_pages` and the `caption_*` edit ops in `test/mcp.test.js` `iteration 3 over MCP…` |
| D7 | `text-captions@2` marks the spoken word from the real times, size floor, caption lane | `test/narration.test.js` `caption pages come from the words; the highlight follows the real word times…`; `studio/captions-highlight.png` |
| D8 | SRT, WebVTT and words JSON on every render; parse back to the script; burned in or file only | `test/captions.test.js` `toSrt and toVtt: exact text, and a round trip…`; `test/narration.test.js` `captions burned in or file only…`; clip 7: `reports/clip-7-horizontal.srt`, `.vtt`, `.words.json` (and the vertical ones) |

## The mix

| # | item | evidence |
|---|---|---|
| D9 | gain keyframes and ducking: the same samples in the preview and the render | `test/mix.test.js`; `test/narration.test.js` `the mix: gain keyframes and ducking are in the WAV the preview plays, which is the one the render encodes`; every render stores `stats.mixSha1` |
| D10 | loudness on every render; −14 LUFS ±1, TP ≤ −1 dBTP on the file; the limiter case says so | `test/loudness.test.js` (JS against FFmpeg `ebur128`), `test/narration.test.js` `a loudness target is met on the encoded file…`; clips 7 and 8: the `loudness` block of each render report |
| D11 | stems; music under the voice in LU; silences; clipping | `test/narration.test.js` `stems export without editing the clip, measured…`; clip 7: `reports/clip-7-voice.json` (`audio`: music under the voice) |

## Text and layout

| # | item | evidence |
|---|---|---|
| D12 | size floors: `fit` stops, then an error in the validator and the render; opt-in | `test/layout-report.test.js` `size floors: …` (both) |
| D13 | layout report boxes within 2 px (scaled, rotated, keyframed, moving); MCP tool | `test/layout-report.test.js` `layout report: …`; MCP `layout_report` in `test/mcp.test.js` |
| D14 | glyph coverage from the font files; flagged per asset and clip before a render | `test/glyphs.test.js`; `check_clip`'s `glyphs` class in `test/checks.test.js` |
| D15 | overlays in the editor and in `render_clip_frame`, never in a render | `gifs/workflow-v3-overlays.gif`, `gifs/workflow-v3-overlays-mobile.gif`, `studio/v3-overlays.png`; `test/checks.test.js` `render_clip_frame overlays: …` (the frame hash is the frame's own) |
| D16 | `check_clip`: every class on a seeded clip; clips 1–6 reviewed (clip 5's REUSE letters); the editor lists issues and jumps | `test/checks.test.js` `check_clip finds every class of issue…`; `reports/check-clips.md` / `.json`, `studio/check-clip-5-reuse-letters.png`; `gifs/workflow-v3-issues.gif`, `studio/v3-issues.png` |
| D17 | platform profiles with cited sources; tightest edge; `f.safe` opt-in | `src/core/platforms.js` (each profile's `source` and retrieval date); `test/platforms.test.js` |

## Fonts

| # | item | evidence |
|---|---|---|
| D18 | ă â î ș ț in both cases, every bundled family, preview and Node, no system glyph, within parity | `reports/parity.json` (case `latin-ext`, all pass), `studio/latin-ext-f2.png` … `-f18.png` (preview, Node, difference); `test/glyphs.test.js` `every bundled family draws Romanian text`; D1 for the old hashes |

## Inspection and the render report

| # | item | evidence |
|---|---|---|
| D19 | frames, hashes and sheets in another format and from a draft | `test/layout-report.test.js` `inspection: frames, hashes and sheets of a clip in another format and of an unsaved draft`; `test/mcp.test.js` |
| D20 | the render report on every render, from the file; sheets with the times drawn | `test/report.test.js`; `reports/clip-7-horizontal.render-report.json`, `reports/clip-7-vertical.render-report.json`, `reports/clip-8-vertical.render-report.json`; `sheets/*-encoded-*.png`; `gifs/workflow-v3-report.gif`, `studio/v3-report-dialog.png`, `studio/v3-report-gallery.png` |
| D21 | typed markers on the timeline; old markers load as notes | `test/layout-report.test.js` `typed markers: …`; `gifs/workflow-v3-markers.gif`, `gifs/workflow-v3-markers-mobile.gif` |

## Sync, MCP, UI

| # | item | evidence |
|---|---|---|
| D22 | `sync-assets` refuses to undo a studio change; `--pull`; `--force` | `test/sync.test.js` |
| D23 | every new capability over MCP, bad inputs get useful errors | `test/mcp.test.js` `iteration 3 over MCP: …; bad inputs get useful errors` |
| D24 | words and markers on the timeline, gain automation and ducking, loudness and the report, issues, overlays: real input, GIFs, both viewports | `scripts/workflows-v3.mjs`; `reports/workflows-v3.json` (67 checks, all pass); `gifs/workflow-v3-{words,markers,audio,report,issues,overlays}.gif` and the two `-mobile` GIFs; `studio/v3-*.png` |

## The two videos

| # | item | evidence |
|---|---|---|
| D25 | clip 7: voiced, ~60 s, horizontal + vertical, captions burned in; gates in order over MCP, journalled; checks pass; MP4 specs, loudness, music 16–20 LU under the voice | `../../../work/clip-7-a-video-that-checks-itself/` (gate messages; no owner approved any gate), `../../../showcase/journal/clip-7-a-video-that-checks-itself.jsonl`, `reports/clip-7-*.render-report.json`, `reports/clip-7-voice.json`, `reports/check-clips.md`, `sheets/clip-7-*-encoded-*.png`, `sheets/clip-7-poster.png` |
| D26 | clip 8: 30–45 s vertical feed video in Romanian, cut on the bars, reusing clip 7 | `../../../work/clip-8-cuvinte-pe-ritm/`, `../../../showcase/journal/clip-8-cuvinte-pe-ritm.jsonl`, `reports/clip-8-vertical.render-report.json`, `reports/clip-8-cuts-on-beats.txt`, `reports/check-clips.md`, `sheets/clip-8-vertical-encoded-*.png`, `sheets/clip-8-poster.png` |
| D27 | the compounding table gains clips 7 and 8 | `reports/compounding.md` / `.json` |

## Prompt, docs, speed, voice, hygiene

| # | item | evidence |
|---|---|---|
| D28 | the motion prompt revised; README, ASSET_CONTRACT, COOKBOOK, `studio_guide` | **blocked** for the prompt (`motion_prompt_fablecut.md` is not in the repository; see `PROGRESS.md` Blocked); `../../../README.md`, `../../ASSET_CONTRACT.md`, `../../COOKBOOK.md`, `studio_guide` in `src/mcp/tools.js` |
| D29 | clips 1–3 within 10 % of the baseline; pass costs separately | `reports/render-speed.md`, `reports/baseline-speed.json`, `reports/speed-compare.json`, `reports/speed-passes.json` |
| D30 | the voice chosen in the brief's order, licences; whisper.cpp outside the repo | `LICENSES.md`; `PROGRESS.md` Decisions ("The showcase voice") |
| D31 | no database, renders, caches or models in git; MP4s on the release; this index; the voice compressed | `git status` clean at the end; release `showcase-v3`; `../../../showcase/voice/clip-7-narration.m4a` (659 KB) |
