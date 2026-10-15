# Checks — clip-9-your-first-clip

Measured 2026-10-15 by `scripts/checks-report.mjs` through the studio's MCP tools (see `craft/CHECKS.md`). Status: pass, fixed, n/a or open.

| check | status | evidence | note |
|---|---|---|---|
| script-lock (voice) | pass | check_transcript { narration: "clip-9-voice@1", transcribe: true }: 0 slips/drops/insertions, 0 disputed (ggml-small.en.bin + ggml-base.en.bin) |  |
| script-lock (captions) | pass | the final render's SRT (renders/clip-9-your-first-clip-r6.srt) against the narration's script: equal after normalising case and punctuation |  |
| determinism | pass | frame_hashes at the final's 18 sampled frames: 18/18 equal the hashes render #6 took (8 workers); render #7 with 3 workers: 18/18 equal |  |
| glyphs, text-safe-area, no-collisions, text-contrast, read-time, captions (horizontal) | pass | check_clip: 0 issues over 111 frames |  |
| format (horizontal) | pass | render_report #6: 1920×1080, 30 fps, h264 yuv420p, aac 48000 Hz 2 ch, 54.57 s, 16.4 MB, colour bt709/bt709/bt709 tv, faststart true |  |
| loudness (horizontal) | pass | on the encoded file: -14.0 LUFS, true peak -1.4 dBTP, LRA 1.7 LU |  |
| frame-sheet (horizontal) | pass | render_report #6: black frames (down to 1 frame), freezes (down to 0.5 s, outside named holds), brightness jumps away from cuts, flashes, silences: none; sheets renders/clip-9-your-first-clip-r6.sheet-1.png, renders/clip-9-your-first-clip-r6.sheet-2.png |  |
| loudness (music under the voice) | pass | audio_report: music 17.8 LU under the voice where it speaks; silences over 1 s: 0; clipping samples: 0 |  |
| sync (key words) | pass | anchor_report: 4 anchors, worst 0.50 frames from its word (callout-find on "Search" -0.05, callout-tune on "Change" 0.49, callout-render on "file" 0.50, end on "Open" -0.30) |  |
| sources | pass | check_provenance: 0 problems, 0 warnings; clip_credits lists 9 sources; the final render (final: true) passed the same check and wrote renders/clip-9-your-first-clip-r6.credits.md |  |
| takeaway | pass | a fresh subagent saw only checks/final-sheet-1.png and -2.png: "Making a video in Fablecut's studio takes four steps (Find an asset in the library, Tune its parameters with a live preview, Place it on the timeline, Render), and the studio checks the rendered file (from loudness to frozen frames)"; first 3 s: "a 'Fablecut Onboarding: Your first clip' tutorial that opens on a screen recording of the studio" | the brief's takeaway: find, tune, place, render: a clip in four steps, all inside the studio. Its one unclear point: the recorded UI is small on a contact sheet (it is read on the full frames, zoomed by the camera) |
| spelling-and-facts | pass | facts.md: 7 claims, each with its source (the studio's code, the journal of clip 7, package.json, the remote) |  |
| literals | fixed | compose.mjs: no word (all from script.json), no hex colour (the theme's tokens, read from assets/theme-tide.js), clip times from timing.mjs (moved there: the callouts, the camera moves, the wipe, the steps' moves; the composition is byte-identical after the move) | left in compose.mjs: the files' own seconds of each spotlight (where an element appears in a recording, read off its sidecar) and motion durations of a few tenths of a second (fades, ducking attack and release) |
| cut-strips | fixed | frames/cut-*.png, 8 frames across each of the 5 cuts, viewed | fixed: marks came in before the recording wiped in; the wipe's accent line crossed the steps; the recap appeared over the last recording, then an empty beat |
| frame-sheet (viewed) | pass | checks/final-sheet-1.png, -2.png read frame by frame: no black, no flash, no empty frame; the camera zooms land on the element the voice names |  |
| re-render | pass | scripts/roundtrip.mjs clip-9-your-first-clip: export_clip into a new repo folder, import into an empty library: composition JSON identical, 27 pinned refs identical, 48 of 48 frame hashes identical (docs/showcase/v4/reports/roundtrip-clip-9.txt) | the round trip first failed: a saved composition's item times kept to the millisecond ended 0.4 ms after the clip's unrounded length; the check now allows the rounding (test) |
