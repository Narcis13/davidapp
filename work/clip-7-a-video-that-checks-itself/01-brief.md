# Gate 1 · Brief — clip 7, "A video that checks itself"

**[me] stop.** This is the message the session writes at the brief gate. There is no owner in this
session: nobody approved this gate; the session went on. (The motion prompt this process comes from,
`motion_prompt_fablecut.md`, was not in the repository; the gates follow the process the iteration 3
brief describes: brief, script, style frames, transitions, animatic, final. See `README.md` in this folder.)

## The video
- **What:** a voiced explainer of about 60 s about this iteration of the studio: the words of a narration
  drive the captions and the timing of the visuals, the music steps back while the voice speaks, and the
  studio checks every frame and measures the encoded file.
- **For whom:** people who make short explainers with code and want to know what the studio checks for them.
- **Formats:** horizontal 1920×1080, 30 fps (YouTube profile), and a vertical 1080×1920 render from the same
  composition with per-format layouts (Shorts profile). Captions burned in, in the caption lane.
- **Length:** 62 s (58.4 s of narration from 1.0 s, then a still end card held for more than 2 s).
- **Sound:** one voice (Kokoro-82M, voice af_heart, Apache-2.0, generated locally), a music bed made by the
  studio's own synth (`music-loop`), ducked about 18 dB under the voice; mastered to −14 LUFS, true peak ≤ −1 dBTP.
- **Look:** theme Tide (navy, cyan accent, orange second accent), a calm dark gradient, every text on a solid
  plate so its contrast holds whatever moves behind it.

## Reuse (from `suggest_assets` and the library)
theme-tide, bg-gradient-drift, music-loop, fablecut-mark (logo), text-captions@2 (word-timed captions),
easing. New, made for this clip and kept for the next: **title-plate** (text on a solid plate, size floor),
**word-strip** (the narration's words on a timeline, reads `f.clip.words`), **duck-meter** (the ducking as a
diagram), **check-list** (rows that tick in on their words), **end-card** (a still closing card).

## What will be checked before approval
Every check `check_clip` runs (safe zones, frame edges, overlaps, caption lane, size floor, contrast 4.5:1,
hold time, caption rules, glyphs, first and last frame); the transcript against the script; anchors within
2 frames of their words; the mix (loudness target met on the encoded file, music 16–20 LU under the voice);
the render report (MP4 facts, no black frames, no flashes, freezes only in holds).
