# Gate 1 · Brief — clip 10, "Every clip helps the next"

**[me] stop.** This is the message the session writes at the brief gate. There is no owner in this session:
**nobody approved this gate; the session went on** (iteration 4 brief: "at each `[me]` stop the session writes the
gate message into `work/<slug>/` and goes on, and records that no owner approved it"). The process is the revised
`motion_prompt_fablecut.md`; its inputs, as filled for this clip, are in `PROMPT.md`.

## The video, in three lines
- **What:** a marketing video of about 30 s for Fablecut: the outcome first (every video leaves pieces behind), the
  product doing it (the real library, recorded), proof with this repo's own numbers, and the call to action on the
  last frame with the Fablecut logo as given.
- **For whom:** developers and makers scrolling a feed who make short videos and would rather write them as code.
- **Takeaway:** *in Fablecut every video leaves reusable pieces, so the next one costs less.*

## Inputs and defaults taken (a default is marked †)
Type marketing · Narration voiced · Product: Fablecut, `github.com/Narcis13/davidapp` (the repo; given by the
iteration brief) · Call to action: "Make your first clip", `github.com/Narcis13/davidapp` · Shape 1:1 primary and
9:16 (the iteration brief: square, with a vertical render of the same composition) · Runs on: Instagram (the feed for
the square, Reels for the vertical) and the repo's README · Language English † · Captions burned in † · Photos and
footage: if needed † (one screen recording of the studio's library, made for clip 9; no photos) · Gates all † ·
Slug `clip-10-every-clip-helps`.

## Where it runs (from the studio's platform profiles, `src/core/platforms.js`)
- **Instagram Reels (9:16):** 1080×1920; keep text, logos and key visuals out of the top 14 %, the bottom 35 % and
  6 % on each side (Meta's ads guide, retrieved with iteration 3). The vertical render is checked against that zone.
- **Square (1:1) in a feed:** no published profile is made for this shape, so the studio's title-safe 5 % holds. The
  composition names `platforms: ["reels"]`; a profile now applies only to the shapes it is made for.
Sound is usually off in a feed: the captions carry every word, and the picture says the claim without them.

## Questions that change the video (each with its default)
1. The voice is synthetic (Kokoro-82M) and realistic-sounding: Meta asks for an "AI info" label on realistic
   digitally made audio. **Default: label it when posting; the credits say it is AI-generated.**
2. The proof could count lines of code per clip (falling as clips reuse) or assets added (rising). **Default: the
   assets added, a rising line** (one number to read: 83), with the two clips that needed no code as the callout.

## Reuse (from `suggest_assets`, run at gate 0, and the library)
theme-tide, text-captions@2, music-loop (studio synth), title-plate, end-card@3 (logo, call to action), the kit
(kit-ui-frame, kit-icon, kit-plate, kit-chart-line), motion-drift, bg-gradient-drift, and clip 9's recording
`studio-library-search`. New for this clip: the narration, and the Fablecut logo uploaded as given
(`brand/fablecut-logo.svg`, an SVG with an internal style sheet and gradients, drawn as vectors).
