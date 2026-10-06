# Compounding: what each clip cost to build

Written by `scripts/reports-v2.mjs`. Lines of asset code and reuse share are read from the database after `npm run showcase`. For clips 4 to 6 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build on 2026-10-06 with its time: build time runs from the first call to the render request, the render itself is not counted, and reading calls and failed calls are counted. Clips 1 to 3 were built in iteration 1, before calls were logged; their calls are the ones `showcase/plan.mjs` replays and their build time was never measured.

| # | clip | length | MCP calls | studio actions by the user | new lines of asset code | reuse share | build time | build time per second of output |
|---|---|---|---|---|---|---|---|---|
| 1 | clip-1-every-frame | 32 s | 31 | – | 1288 | 0 % (0 of 20 items) | – | – |
| 2 | clip-2-compounding | 32 s | 11 | – | 577 | 55 % (12 of 22 items) | – | – |
| 3 | clip-3-release-notes | 32 s | 8 | – | 206 | 67 % (14 of 21 items) | – | – |
| 4 | clip-4-direct-the-studio | 30 s | 40 | 4 | 242 (+106 generated) | 60 % (6 of 10 items) | 370.7 s | 12.36 s |
| 5 | clip-5-a-library-in-3d | 60 s | 20 | 3 | 123 | 64 % (9 of 14 items) | 254.8 s | 4.25 s |
| 6 | clip-6-what-the-library-holds | 90 s | 7 | – | 0 | 100 % (17 of 17 items) | 76.5 s | 0.85 s |

"New lines" are the non-blank lines of asset source written for the clip; presets and precomps the studio generated are counted apart. "Reuse share" is the share of timeline items whose pinned asset version already existed, made for an earlier clip.

## Clip 6 against the clips before it

- yes: clip 6 was started after clip 5 finished rendering
- yes: clip 6 reuses assets made for clip 4, clip 5, clip 1 and clip 2
- yes: less build time than clip 4 and clip 5
- yes: fewer MCP calls than clip 4 and clip 5
- yes: less new asset code than clip 4 and clip 5
- yes: a higher reuse share than clip 4 and clip 5
- yes: clearly less new asset code than any of clips 1 to 3

Clip 6 is three times as long as clip 4 and took 21 % of its build time and 30 % of clip 5's: 0.85 s of work per second of video, against 12.36 s and 4.25 s.

## What made clip 6 cheaper

- **Nothing had to be written.** Its 17 timeline items all pin asset versions that existed: 8 from clip 1, 4 from clip 5, 3 from clip 4, 2 from clip 2. Clip 4 wrote 14 assets (242 lines) and clip 5 7 (123 lines).
- **It started from the library, not from a blank file.** Its first call after `create_clip` was `suggest_assets` with the brief; the answer named the pieces with their params, notes and real usage examples, so the composition was written in 2 `update_clip` call(s) and checked with 2 frame(s). Calls by tool: update_clip 2, render_clip_frame 2, create_clip 1, suggest_assets 1, start_render 1.
- **Bigger pieces.** The opening is one item, the `studio-title-card` precomp clip 4 saved from its title, logo and motions; the caption is the `lower-third-studio` preset; the 3D orb is the `orb-spin` sequence clip 5 baked, so it costs an image draw per frame instead of a rasterized scene.
- **The same vocabulary.** Transitions, motions and effects are attached by name (`trans-*`, `motion-*`, `fx-*`), and the clip theme gives every piece the same colours and type without per-item params.
- **No detours.** Clip 4 spent calls on things only a first use needs: 3 rejected call(s), 5 `get_asset` reads, describing 2 uploads, 3 presets. Clip 6 needed none of that.

The same numbers, per clip, are in [compounding.json](compounding.json); who reused what from whom is in [reuse.txt](reuse.txt).
