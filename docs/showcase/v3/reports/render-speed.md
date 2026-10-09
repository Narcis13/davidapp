# Render speed, iteration 3 (D29)

Machine: Intel Core i9-14900KF × 32 threads, Windows 11, Node 24.19, FFmpeg 9.0.2. Measured with
`scripts/speed.mjs` through the MCP server (`start_render`, `renderSeconds`: frames drawn by the worker pool plus
the FFmpeg encode, as in iterations 1 and 2), with no other studio, render or browser running.

## Clips 1–3 against the baseline

The baseline was taken at the start of the iteration (`baseline-speed.json`, 5 runs, from a worktree of
`4a394de`). Because a machine drifts over a day, the final code was measured again **interleaved** with that same
baseline worktree: 3 rounds, each rendering every clip twice with the baseline code and then twice with the final
code, on the same kind of data (`speed-compare.json`).

| clip | size, length (frames) | baseline at the start | baseline, interleaved | final, interleaved | final vs interleaved | final vs the start | limit |
|---|---|---|---|---|---|---|---|
| 1 Every frame | 1080×1920, 32 s (960) | 6.39 s | 6.50 s | 6.52 s | +0.4 % | +2.0 % | ≤ +10 % |
| 2 Compounding | 1920×1080, 32 s (960) | 8.01 s | 8.11 s | 8.28 s | +2.2 % | +3.4 % | ≤ +10 % |
| 3 Release notes | 1080×1080, 32 s (960) | 4.78 s | 4.82 s | 5.07 s | +5.2 % | +6.1 % | ≤ +10 % |

All three are within 10 %. The likely costs on the frame path: text drawing checks whether it is recording, font strings
name the Latin Extended alias family, and the encode tags the video BT.709 (`setparams`, needed since FFmpeg 9 dropped
the `-color_*` tags). Clip 3, a clip of release-note text, shows the largest difference; it was not profiled further.

## The passes this iteration added, reported separately

These run after the frames and are not in `renderSeconds`; they are stored with every render
(`stats.mixSeconds`, `stats.reportSeconds`, `stats.loudnessSeconds`) and shown in the studio's render report.
`check_clip` runs only when asked; the time is one whole-clip check without stills (`speed-passes.json`).

| clip | length | frames + encode | mix (uncached) | render report | loudness correction | `check_clip` (frames sampled) |
|---|---|---|---|---|---|---|
| 1 Every frame | 32 s | 6.37 s | 0.42 s | 2.07 s | — (no target) | 1.29 s (65) |
| 2 Compounding | 32 s | 8.27 s | cached | 1.37 s | — | 1.70 s (65) |
| 3 Release notes | 32 s | 5.01 s | cached | 1.39 s | — | 1.07 s (65) |
| 7 A video that checks itself | 62 s | 10.05 s | 1.42 s | 1.94 s | — (met on the first encode) | 1.37 s (125) |
| 8 Cuvinte pe ritm | 38.4 s | 6.32 s | 0.85 s | 1.91 s | 1.74 s (one AAC correction) | 0.87 s (78) |

- **Mix**: the JS mixer (decode once with FFmpeg, place, automate, duck, reach the loudness target). It is cached
  by the clip's audio, so a re-render, the preview and the next render of the same mix take no time.
- **Render report**: ffprobe, `ebur128`, `blackdetect`, `freezedetect`, the brightness and flash scan, silences,
  and the encoded-file sheets, all on the MP4 written.
- **Loudness correction**: only when the encoded file misses the target (AAC moves peaks and loudness a little):
  a fixed gain on the mix (and the limiter if it must), re-encode the audio, remux with `-c:v copy`, measure again.
- **check_clip**: the frames are drawn twice (with and without the text, for contrast) on a worker pool.

Notes for a slower machine: the mix and the loudness maths run on the studio's main thread (about 23 ms per second
of audio here, 1.4 s for clip 7), which is fine for clips of a few minutes. See PROGRESS Notes.
