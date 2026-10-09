# Gate 6 · Final — clip 8

**[me] stop.** No owner in this session: nobody approved this gate (or any other); the session went on.

One render (`start_render`) and its report (`render_report`): `docs/showcase/v3/reports/clip-8-vertical.render-report.json`,
sheets from the encoded file `docs/showcase/v3/sheets/clip-8-vertical-encoded-*.png` (read frame by frame:
nothing blank, clipped or garbled; the Romanian diacritics are the families' own glyphs).

| | clip 8 |
|---|---|
| file | H.264, 1080×1920, 30 fps, 1152 frames, 38.4 s; yuv420p, BT.709; AAC 48 kHz stereo; faststart |
| loudness (FFmpeg ebur128 on the file) | **−14.2 LUFS**, LRA 0.6 LU, **true peak −1.5 dBTP** (target met) |
| how | the master limited to −5.2 dBTP and added +3.7 dB; AAC then put the peaks at −0.7 dBTP, so the audio was corrected once (limited to −2.1 dBTP, +0.1 dB) and encoded again |
| black frames · flashes · jumps · silences | none · 0 a second · none · none |
| freezes | 32.4–38.4 s only, inside the end card's hold marker |
| `check_clip` | 0 issues |
| voice checks | n/a (no voice) |
| render time on this PC | 6.1 s |

The first render of this clip measured −0.8 dBTP on the file: the studio's correction pass was changed to aim under
the ceiling by the overshoot the encoder showed, with up to two rounds (see the Log).
