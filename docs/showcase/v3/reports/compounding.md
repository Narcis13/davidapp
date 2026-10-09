# Compounding: what each clip cost to build

Written by `scripts/reports-v3.mjs`. Lines of asset code and the reuse share are read from the database after `npm run showcase`. For clips 4 to 8 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build with its time: the build runs from the first call to the last render request in the clip's own format (for clips 7 and 8 that is the final gate: the time spent fixing what a first render's report found is counted). Reading calls are counted. Clips 1 to 3 were built before calls were logged.

| # | clip | length | MCP calls | studio actions | new lines of asset code | reuse share | build time | per second of output |
|---|---|---|---|---|---|---|---|---|
| 1 | clip-1-every-frame | 32 s | 31 | – | 1288 | 0 % (0 of 20 items) | – | – |
| 2 | clip-2-compounding | 32 s | 11 | – | 577 | 55 % (12 of 22 items) | – | – |
| 3 | clip-3-release-notes | 32 s | 8 | – | 206 | 67 % (14 of 21 items) | – | – |
| 4 | clip-4-direct-the-studio | 30 s | 40 | 4 | 242 (+106 generated) | 60 % (6 of 10 items) | 370.7 s | 12.36 s |
| 5 | clip-5-a-library-in-3d | 60 s | 20 | 3 | 123 | 64 % (9 of 14 items) | 254.8 s | 4.25 s |
| 6 | clip-6-what-the-library-holds | 90 s | 7 | – | 0 | 100 % (17 of 17 items) | 76.5 s | 0.85 s |
| 7 | clip-7-a-video-that-checks-itself | 62 s | 49 | – | 908 | 20 % (3 of 15 items) | 906.2 s | 14.62 s |
| 8 | clip-8-cuvinte-pe-ritm | 38.4 s | 16 | – | 0 | 100 % (11 of 11 items) | 151 s | 3.93 s |

## Clips 7 and 8

- yes: clip 8 reuses assets clip 7 made
- yes: clip 8 writes no new asset code
- yes: clip 8 takes fewer MCP calls and less build time than clip 7

Clip 7 is the first video of iteration 3: it wrote 12 assets (908 lines; each was revised at a gate where looking or measuring found a problem) and spent its calls on the checks (render_clip_frame 10, update_clip 8, check_clip 8, update_asset 7, create_asset 5, start_render 4, audio_report 2, create_clip 1, suggest_assets 1, add_narration 1, check_transcript 1, anchor_report 1). Clip 8 told the same story for a feed from what clip 7 left: 16 calls (render_clip_frame 5, update_clip 3, audio_report 3, check_clip 2, create_clip 1, suggest_assets 1, start_render 1), no new code, 3.93 s of work per second of video against 14.62 s.
