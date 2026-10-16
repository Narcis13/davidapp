# Checks — fablecut-doodle-tour

Measured 2026-10-16 by `scripts/checks-report.mjs` through the studio's MCP tools (see `craft/CHECKS.md`). Status: pass, fixed, n/a or open.

| check | status | evidence | note |
|---|---|---|---|
| determinism | pass | frame_hashes at the final's 18 sampled frames: 18/18 equal the hashes render #23 took (8 workers); render #22 with 3 workers: 18/18 equal |  |
| glyphs, text-safe-area, no-collisions, text-contrast, read-time, captions (horizontal) | pass | check_clip: 0 issues over 181 frames |  |
| format (horizontal) | pass | render_report #23: 1920×1080, 30 fps, h264 yuv420p, aac 48000 Hz 2 ch, 90.00 s, 15.9 MB, colour bt709/bt709/bt709 tv, faststart true |  |
| loudness (horizontal) | pass | on the encoded file: -14.1 LUFS, true peak -1.3 dBTP, LRA 0.5 LU |  |
| frame-sheet (horizontal) | pass | render_report #23: black frames (down to 1 frame), freezes (down to 0.5 s, outside named holds), brightness jumps away from cuts, flashes, silences: none; sheets renders/fablecut-doodle-tour-r23.sheet-1.png, renders/fablecut-doodle-tour-r23.sheet-2.png, renders/fablecut-doodle-tour-r23.sheet-3.png |  |
| sources | pass | check_provenance: 0 problems, 0 warnings; clip_credits lists 6 sources; the final render (final: true) passed the same check and wrote renders/fablecut-doodle-tour-r23.credits.md |  |
| cut-strips (viewed) | pass | render_clip_frame sheets of 8 frames across all 9 cuts (8, 18, 28, 38, 50, 58, 66, 76, 82 s), viewed | the scribble carries every cut; the new beat draws itself in on paper right after it |
| frame-sheet (viewed) | pass | render_report sheets of drafts #17 and #18 and finals #21 and #23 (#23: the same frames, the presets pinned), viewed frame by frame | draft #16 had a 6.6 s still end card outside the hold: a slow push-in was added and the hold now covers the last 2.8 s |
| takeaway (fresh eyes) | pass | an Explore subagent shown only the final's sheets: 'Fablecut is a video studio where you write videos in code. Each clip leaves reusable pieces behind, so the next clip takes less code'; first 3 s: 'a promo for a code-based video tool' | it read the extruded 3D as '30': block-text-3d@4 redraws the D rounded and the word was re-baked (doodle-3d-word@4) |
| spelling-and-facts | pass | every word is from script.json; the fresh viewer found no misspelling; 242 / 123 / 0 are the README's compounding table for clips 4 to 6 |  |
| literals | pass | compose.mjs writes no words, colours or times of its own: words from script.json, colours from theme-fablecut-doodle, times from timing.mjs |  |
