# Render speed

Measured by the render queue itself: wall-clock time of `renderVideo` (frames drawn by Skia in
8 worker threads, piped as raw RGBA into one FFmpeg process encoding libx264 `-preset medium -crf 18`
plus AAC), stored in each render's `stats.renderSeconds`. Audio synthesis and beat detection are
not included (they are cached; about a second on first use).

Machine: Intel(R) Core(TM) i9-14900KF (32 logical CPUs), win32 x64, Node v24.19.0.

| clip | size | length | render time | frames/s | vs realtime |
|---|---|---|---|---|---|
| clip-1-every-frame | 1080×1920 | 32 s (960 frames) | 6.41 s | 149.9 | 4.99× |
| clip-2-compounding | 1920×1080 | 32 s (960 frames) | 7.83 s | 122.6 | 4.09× |
| clip-3-release-notes | 1080×1080 | 32 s (960 frames) | 4.28 s | 224.4 | 7.48× |

Target: a 30-second 1080p clip in under 5 minutes. Measured: every 32-second clip renders in well
under ten seconds.
