# Gate 1 · Brief — clip 9, "Your first clip"

**[me] stop.** This is the message the session writes at the brief gate. There is no owner in this session:
**nobody approved this gate; the session went on** (iteration 4 brief: "at each `[me]` stop the session writes the
gate message into `work/<slug>/` and goes on, and records that no owner approved it"). The process is the revised
`motion_prompt_fablecut.md`; its inputs, as filled for this clip, are in `PROMPT.md`.

## The video, in three lines
- **What:** an onboarding video of about 55 s that walks through making a first clip in Fablecut, shown on the
  real studio: find an asset, tune it, place it on a clip, render it.
- **For whom:** someone who has just cloned the repo and opened the studio for the first time.
- **Takeaway:** *find, tune, place, render: a clip in four steps, all inside the studio.*

## Inputs and defaults taken (a default is marked †)
Type onboarding · Narration voiced · Product: Fablecut, `github.com/Narcis13/davidapp` (the repo; given by the
iteration brief) · Call to action: "Open the studio" with `npm run studio` and the repo URL † · Shape 16:9 only (decided at gate 1: a desktop UI recorded at 1440×900 would be unreadable in a 9:16 frame; the vertical shape goes to clip 10, which is made for feeds) · Runs on: YouTube and the repo's README † · Language English †
· Captions burned in † · Photos and footage: footage only (screen recordings of the studio, made by
`scripts/record-studio.mjs`; no photos) · Gates all † · Slug `clip-9-your-first-clip`.

## Where it runs (from the studio's platform profiles, `src/core/platforms.js`)
- **YouTube (16:9):** 1920×1080, the recorded frame rate (30), MP4 with fast start, uploads up to 15 min by default;
  no safe area published for cards and end screens, so the studio's title-safe 5 % holds. Source:
  support.google.com/youtube/answer/1722171 and /6375112 (retrieved with iteration 3).
Sound on, but the captions carry every word for sound off.

## Questions that change the video (each with its default)
1. The voice is synthetic (Kokoro-82M): YouTube asks creators to disclose *realistic* altered or synthetic
   content; a narrated tutorial voice is not that, so no disclosure label is planned. **Default: no label; the
   description says the voice is synthetic.**
2. Should the recordings show the showcase library (the clips of this repo) or an empty one? **Default: the
   showcase library**, so search returns real assets.

## Reuse (from `suggest_assets`, run at gate 0, and the library)
theme-tide, text-captions@2 (word-timed captions), music-loop (studio synth), title-plate, end-card@3 (call to
action), the kit (kit-ui-frame, kit-cursor, kit-spotlight, kit-camera, kit-callout, kit-steps, kit-icon), the screen
recordings committed in `showcase/footage/`. New for this clip: the four step recordings and the narration.
