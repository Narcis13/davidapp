# Gate 2 · Script and voice — clip 7

**[me] stop.** No owner in this session: nobody approved this gate; the session went on.

## Script (159 words, `clips/clip-7-a-video-that-checks-itself/narration.txt`)
> Every video starts as words. In this studio, the words come first. The voice you are hearing was read by
> an open model, and the studio knows the moment each word is spoken. …
> Nothing here was checked by eye alone.

Six paragraphs, one idea each: words first · timing drives captions and visuals (the word "contrast" brings a
title) · the music steps back · the checks before a render · the measurements after it · the close.

## The take
- **Voice:** Kokoro-82M v1.0 (voice af_heart, kokoro-js 1.2.1, q8, CPU), Apache-2.0: allowed for commercial use
  and redistribution. Chosen because `brand/voice/` holds no recording and `.env` holds no voice-service key
  (the brief's order). 58.4 s, kept in the repo as `showcase/voice/clip-7-narration.m4a` (AAC 96 kb/s, 659 KB).
- **Word times:** whisper.cpp (tag b5454) with `ggml-small.en`, full JSON with token times
  (`showcase/voice/clip-7-narration.whisper.json`), imported by `add_narration` and aligned to the script:
  158 of 159 words matched; "a" (word 96, "Before a render") was not heard by small.en and has an
  interpolated time (no visual is anchored to it).
- **Transcript check** (`check_transcript` with two independent transcripts, whisper base.en and small.en):
  **no slips, drops or insertions.** Each recogniser disagreed once, on a different word, and the other heard it
  as written: base.en heard "I" for "eye" (word 157), small.en missed "a" (word 96). Both are listed as disputed,
  not as the reader's slips.

## Timing that matters for the visuals (clip time = narration + 1.0 s)
"In" 3.67 · "knows" 10.56 · "captions" 16.11 · "Visuals" 22.41 · **"contrast," 25.36** · "music" 31.41 ·
"Before" 35.91 · "safe" 40.51 · "big" 41.30 · "contrast" 42.95 · "long" 46.22 · "After" 48.31 ·
"Loudness" 51.71 · "flashes" 54.12 · "frozen" 55.30 · "Nothing" 57.11 · last word ends 59.08.
