# What footage costs

Measured by `scripts/footage-cost.mjs` on win32 (2026-10-15), 3 interleaved runs, medians.

File: `editor-place.mp4`, 1440×900, 30 fps, 615 frames, 20.5 s, h264, 0.53 MB.

## Disk

| what | size |
|---|---|
| the file (kept as it is) | 0.53 MB |
| thumbnail + 8-frame filmstrip + waveform | 0.24 MB |
| the frame table in the version's meta | 615 timestamps |
| decoded frames on disk | none: the decoder's cache is memory only, 512.00 MB at most, least recently used first |
| preview frames on disk | none: encoded frames are cached in the server's memory (128 MB at most) and by the browser (immutable URLs) |
| the data dir grew by (both clips, 3 renders each, the still) | 8.68 MB |

Import (probe, frame table by decoding the whole file once, stills, SHA-256): 2.41 s.

## Render time

| clip (300 frames, 1920×1080) | runs (s) | median |
|---|---|---|
| footage layer at 1:1 | 2.74 / 2.53 / 2.61 | 2.61 s |
| a still in its place | 1.45 / 1.34 / 1.45 | 1.45 s |

Footage adds 1.16 s over 300 frames: 3.9 ms a frame (decoding, the copy to the worker, the upload to a canvas), 80 % on this clip. A clip without footage pays nothing: the runtime asks for no frames.
