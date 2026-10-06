# Render speed after iteration 2

Machine: Intel(R) Core(TM) i9-14900KF × 32, win32 x64, Node v24.19.0. Written by `scripts/speed-compare.mjs`.

## The 2D clips against the code before the iteration

Clips 1 to 3 (32 s each, 960 frames) rendered 5 times with the code before iteration 2 (a worktree of `6c9f8cf`, same `node_modules`) and 5 times with the current code, in turns, each through the MCP server (`start_render`); the time is the render's own `renderSeconds` (frames drawn by 8 worker threads and piped into FFmpeg, libx264 `-preset medium -crf 18`; the audio mix is cached and not counted). Medians:

| clip | size | before | now | now / before | runs before (s) | runs now (s) |
|---|---|---|---|---|---|---|
| clip-1-every-frame | 1080×1920 | 6.33 s | 6.32 s | 0.998 | 6.33 / 6.3 / 6.34 / 6.37 / 6.28 | 6.39 / 6.29 / 6.35 / 6.32 / 6.32 |
| clip-2-compounding | 1920×1080 | 7.87 s | 7.8 s | 0.991 | 7.88 / 7.8 / 7.82 / 7.87 / 7.91 | 7.77 / 7.8 / 7.78 / 7.91 / 7.84 |
| clip-3-release-notes | 1080×1080 | 4.66 s | 4.66 s | 1 | 4.7 / 4.67 / 4.64 / 4.66 / 4.65 | 4.66 / 4.67 / 4.67 / 4.65 / 4.64 |

Limit: no clip more than 10 % slower. All three are within it. Items in the old shape still go through the iteration-1 drawing path, which is why the numbers barely move; a 30-second 1080p clip of that kind renders in 4.4 to 7.3 s.

## Clips 4 to 6

The first finished render of each, from the showcase build (`stats` of the render):

| clip | format | size | length | render time | frames/s | vs realtime |
|---|---|---|---|---|---|---|
| clip-6-what-the-library-holds | square | 1080×1080 | 90 s (2700 frames) | 148.48 s | 18.2 | 0.61× |
| clip-5-a-library-in-3d | vertical | 1080×1920 | 60 s (1800 frames) | 136.57 s | 13.2 | 0.44× |
| clip-4-direct-the-studio | horizontal | 1920×1080 | 30 s (900 frames) | 77.43 s | 11.6 | 0.39× |
| clip-4-direct-the-studio | square | 1080×1080 | 30 s (900 frames) | 46.38 s | 19.4 | 0.65× |
| clip-4-direct-the-studio | vertical | 1080×1920 | 30 s (900 frames) | 78.58 s | 11.5 | 0.38× |

These are slower than realtime because of what is on screen, not because of the new layout model: see below.

## What 3D and effects cost

The same 16 frames of a scene drawn with and without one thing, by one worker, with no encoding (`frame_hashes`; best of two passes). The difference is what that thing costs per 1080p frame.

| clip | what | frames from | with | without | cost per frame |
|---|---|---|---|---|---|
| clip-4-direct-the-studio (1920×1080) | film grain on the whole clip (fx-grain) | 1–29 s | 210 ms | 139.5 ms | 70.5 ms |
| clip-4-direct-the-studio (1920×1080) | every effect: grain, a vignette on a track, duotone and glow on items | 1–29 s | 201.7 ms | 43.9 ms | 157.8 ms |
| clip-4-direct-the-studio (1920×1080) | glow on the numbers scene (fx-glow, 0:15 to 0:23) | 16–22 s | 254.3 ms | 115.3 ms | 139 ms |
| clip-4-direct-the-studio (1920×1080) | the 3D orb, rasterized every frame (orb-3d, 0:07 to 0:15) | 8–14 s | 207 ms | 116.6 ms | 90.4 ms |
| clip-5-a-library-in-3d (1080×1920) | the 3D terrain, rasterized every frame (terrain-3d) | 8.3–18.1 s | 311.2 ms | 143.2 ms | 167.9 ms |
| clip-5-a-library-in-3d (1080×1920) | 3D block text, rasterized every frame (block-text-3d) | 9.3–17.7 s | 307.9 ms | 280 ms | 27.8 ms |
| clip-5-a-library-in-3d (1080×1920) | the orb as a baked sequence (orb-spin) | 18.7–27.7 s | 159.8 ms | 112.5 ms | 47.3 ms |

Effects are pixel loops in plain JavaScript over the whole frame (canvas `filter` is not used, so the preview and the render agree), and 3D is a software rasterizer: both cost tens of milliseconds a frame at 1080p, per worker, and they are what makes clips 4 to 6 slower than realtime. A baked sequence replaces the rasterizer with one PNG decode and draw per frame; what it saves depends on the scene it replaces (compare the two orb rows).
