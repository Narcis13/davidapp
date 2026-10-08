# Render speed after iteration 2

Machine: Apple M2 × 8, darwin arm64, Node v24.15.0. Written by `scripts/speed-compare.mjs`.

## The 2D clips against the code before the iteration

Clips 1 to 3 (32 s each, 960 frames) rendered 5 times with the code before iteration 2 (a worktree of `6c9f8cf`, same `node_modules`) and 5 times with the current code, in turns, each through the MCP server (`start_render`); the time is the render's own `renderSeconds` (frames drawn by 6 worker threads and piped into FFmpeg, libx264 `-preset medium -crf 18`; the audio mix is cached and not counted). Medians:

| clip | size | before | now | now / before | runs before (s) | runs now (s) |
|---|---|---|---|---|---|---|
| clip-1-every-frame | 1080×1920 | 21.2 s | 21.32 s | 1.006 | 21.53 / 21.41 / 21.2 / 21.1 / 21.09 | 21.48 / 21.32 / 21.42 / 21.23 / 21.07 |
| clip-2-compounding | 1920×1080 | 23.64 s | 23.63 s | 1 | 23.98 / 23.64 / 23.67 / 23.44 / 23.41 | 23.69 / 23.63 / 23.66 / 23.49 / 23.4 |
| clip-3-release-notes | 1080×1080 | 13.34 s | 13.37 s | 1.002 | 13.34 / 13.4 / 13.41 / 13.3 / 13.28 | 13.37 / 13.43 / 13.26 / 13.23 / 13.53 |

Limit: no clip more than 10 % slower. All three are within it. Items in the old shape still go through the iteration-1 drawing path, which is why the numbers barely move; a 30-second 1080p clip of that kind renders in 12.5 to 22.2 s.

## Clips 4 to 6

The first finished render of each, from the showcase build (`stats` of the render):

| clip | format | size | length | render time | frames/s | vs realtime |
|---|---|---|---|---|---|---|
| clip-6-what-the-library-holds | square | 1080×1080 | 90 s (2700 frames) | 230.15 s | 11.7 | 0.39× |
| clip-5-a-library-in-3d | vertical | 1080×1920 | 60 s (1800 frames) | 222.25 s | 8.1 | 0.27× |
| clip-4-direct-the-studio | horizontal | 1920×1080 | 30 s (900 frames) | 116.73 s | 7.7 | 0.26× |
| clip-4-direct-the-studio | square | 1080×1080 | 30 s (900 frames) | 67.16 s | 13.4 | 0.45× |
| clip-4-direct-the-studio | vertical | 1080×1920 | 30 s (900 frames) | 116.12 s | 7.8 | 0.26× |

These are slower than realtime because of what is on screen, not because of the new layout model: see below.

## What 3D and effects cost

The same 16 frames of a scene drawn with and without one thing, by one worker, with no encoding (`frame_hashes`; best of two passes). The difference is what that thing costs per 1080p frame.

| clip | what | frames from | with | without | cost per frame |
|---|---|---|---|---|---|
| clip-4-direct-the-studio (1920×1080) | film grain on the whole clip (fx-grain) | 1–29 s | 241.7 ms | 176.6 ms | 65.1 ms |
| clip-4-direct-the-studio (1920×1080) | every effect: grain, a vignette on a track, duotone and glow on items | 1–29 s | 237.5 ms | 61 ms | 176.5 ms |
| clip-4-direct-the-studio (1920×1080) | glow on the numbers scene (fx-glow, 0:15 to 0:23) | 16–22 s | 334.4 ms | 166 ms | 168.4 ms |
| clip-4-direct-the-studio (1920×1080) | the 3D orb, rasterized every frame (orb-3d, 0:07 to 0:15) | 8–14 s | 245.6 ms | 166.1 ms | 79.6 ms |
| clip-5-a-library-in-3d (1080×1920) | the 3D terrain, rasterized every frame (terrain-3d) | 8.3–18.1 s | 330 ms | 166.6 ms | 163.4 ms |
| clip-5-a-library-in-3d (1080×1920) | 3D block text, rasterized every frame (block-text-3d) | 9.3–17.7 s | 327.4 ms | 300.3 ms | 27 ms |
| clip-5-a-library-in-3d (1080×1920) | the orb as a baked sequence (orb-spin) | 18.7–27.7 s | 220 ms | 159.1 ms | 61 ms |

Effects are pixel loops in plain JavaScript over the whole frame (canvas `filter` is not used, so the preview and the render agree), and 3D is a software rasterizer: both cost tens of milliseconds a frame at 1080p, per worker, and they are what makes clips 4 to 6 slower than realtime. A baked sequence replaces the rasterizer with one PNG decode and draw per frame; what it saves depends on the scene it replaces (compare the two orb rows).
