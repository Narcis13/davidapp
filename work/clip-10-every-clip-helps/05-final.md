# Gates 6 and 7 · Build and final — clip 10, "Every clip helps the next"

**[me] stop.** No owner in this session: **nobody approved this gate; the session went on.**

- **Open:** the final MP4s are on the GitHub release `showcase-v4` (`clip-10-every-clip-helps.mp4`, square, and
  `clip-10-every-clip-helps-9x16.mp4`, vertical); locally `out/final.mp4` and `out/final-9x16.mp4` (git-ignored),
  `out/poster.png`, `out/poster-9x16.png` (the renders' own posters: the frame at 40 %), `out/captions.srt`,
  `out/captions.vtt`, `out/credits.txt`. In the studio: `/clips/clip-10-every-clip-helps`.
- **The renders:** batch #26, `start_render { formats: ["square", "vertical"], final: true }` (the sources were
  checked first; the credits written beside each). Square #26: 1080×1080, 30 fps, 27.53 s, H.264 yuv420p BT.709,
  AAC 48 kHz, fast start, 6.6 MB. Vertical #27: 1080×1920, the same, 9.1 MB. Both −14.0 LUFS, −1.2 dBTP.
  Render #28 (3 workers) has the same 18 sampled frames as #26 (8 workers).
- **Frame sheets:** `checks/final-sheet-1.png`, `checks/final-9x16-sheet-1.png` (from the encoded files).
- **Checks:** `checks/report.md`: every check passes or was fixed; none is open.
- **Credits** (from `clip_credits`): motion graphics original, made in Fablecut; footage `studio-library-search` by
  Fablecut (`scripts/record-studio.mjs`); the Fablecut logo (original); voice Kokoro-82M, voice af_heart (Apache-2.0,
  AI-generated); fonts Inter, JetBrains Mono, Space Grotesk (OFL-1.1).
- **What approving freezes:** the cut, the mix, these renders.
