# Gate 6 · Final — clip 7

**[me] stop.** No owner in this session: nobody approved this gate (or any other); the session went on.

Two renders from the one composition (`start_render`, then `start_render { format: "vertical" }`), each with its
render report from the encoded file (`render_report`). Evidence: `docs/showcase/v3/reports/clip-7-*.render-report.json`,
subtitles and words next to them, frame sheets from the encoded files in `docs/showcase/v3/sheets/clip-7-*-encoded-*.png`.

| | horizontal | vertical |
|---|---|---|
| file | H.264, 1920×1080, 30 fps, 1860 frames, 62.0 s | H.264, 1080×1920, 30 fps, 1860 frames, 62.0 s |
| pixels and colour | yuv420p, BT.709 primaries / transfer / matrix, TV range | same |
| audio | AAC 48 kHz stereo; faststart | same |
| loudness (FFmpeg ebur128 on the file) | **−14.1 LUFS**, LRA 2.7 LU, **true peak −1.1 dBTP** (target met) | same |
| music under the voice | 16.8 LU where the narration speaks | same mix |
| black frames · flashes · jumps · silences | none · 0 a second · none · none | same |
| freezes | 58.2–62 s only, inside the end card's hold marker | same |
| narration against the clip | first word at frame 39 (1.31 s), last ends at frame 1772 (59.08 s), 2.92 s of tail | same |
| `check_clip` (125 frames, 11 checks) | 0 issues | 0 issues |
| render time on this PC | 9.8 s (mix 1.3 s, report 1.9 s) | 9.8 s |

The sheets were read frame by frame (one frame a second plus the middle of each cut): nothing blank, clipped,
overlapping or garbled; captions sit in the lane in both formats; the end card holds still from 58 s.

## Changes made at this gate (after the first render's report)
- The end card read as **black frames** (a small card on a dark frame): **end-card v2** has a solid plate.
- Short stretches read as **frozen picture** (the calm background moved below FFmpeg's −60 dB freeze threshold):
  every scene item now drifts slowly (`motion-drift`, 0.5 % of the frame), and sparse slow particles move behind the
  plates. The second render's report: no problems.
