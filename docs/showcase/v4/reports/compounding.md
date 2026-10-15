# Compounding: what each clip cost to build

Written by `scripts/reports-v4.mjs` from a library rebuilt by `npm run showcase` (an empty data dir, no voice tools). Lines of asset code and the reuse share are read from the database. For clips 4 to 11 the MCP calls and the build time come from their journals (`showcase/journal/*.jsonl`), which recorded every call of the live build with its time: the build runs from the first call to the last render request in the clip's own format, so fixing what a check or a render report found is counted. Reading calls are counted. Clips 1 to 3 were built before calls were logged. Clip 11 is a short tour of the kit, not a motion-prompt clip.

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
| 9 | clip-9-your-first-clip | 54.6 s | 122 | – | 1558 | 14 % (4 of 28 items) | 2313.6 s | 42.4 s |
| 10 | clip-10-every-clip-helps | 27.5 s | 107 | – | 244 | 77 % (17 of 22 items) | 1403.8 s | 50.99 s |
| 11 | clip-11-the-kit | 16.1 s | 15 | – | 431 | 75 % (6 of 8 items) | 74.9 s | 4.65 s |

## Clips 9 and 10

- yes: clip 10 reuses assets clip 9 made
- yes: clip 10 writes less new asset code than clip 9
- yes: clip 10 reuses a larger share of its items than clip 9
- measured, not a check: build time per second of output, clip 10 50.99 s against clip 9 42.4 s. Clip 10 did not take less time: its journal includes the studio fixes its own checks found (a safe zone applied to the wrong shape, credits that missed fonts, a frame error check_clip could not report, a checks report that saw one shape), a spoken number that was wrong and needed a new take, and new renders of both shapes after each fix. What compounded is the code it wrote and the share it reused.

Clip 9 is the first clip of iteration 4: it made the kit's UI half and five screen recordings, 11 assets (1558 lines), in 122 calls (render_clip_frame 42, update_clip 20, check_clip 11, create_asset 10, add_asset_note 10, start_render 8, …). Clip 10 told a marketing story from what clip 9 and earlier clips left: 107 calls, 244 new lines, 77 % of its items reused, 50.99 s of work per second of video against 42.4 s.
