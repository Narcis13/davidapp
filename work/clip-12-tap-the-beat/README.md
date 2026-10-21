# Clip 12 — "Tap the beat"

An interactive clip: a neon rhythm game played in the browser from its share page (vertical 1080×1920, 60 fps).
It is never rendered to MP4. Built through MCP and journalled (`showcase/journal/clip-12-tap-the-beat.jsonl`, replayed
by `npm run showcase`); the composition is `clips/clip-12-tap-the-beat/compose.mjs`, its export `clip.json`.
`first-build.jsonl` here is the first build, with every iteration on the assets (four versions of beat-lanes, three of
beat-title, two of ui-dialog); the showcase journal makes each asset once, in its final form.

## Brief

- What: a game people send each other, that shows what an interactive Fablecut clip is: assets drawn in the viewer's
  browser, reacting to taps and keys, deterministic enough to replay frame for frame.
- For whom: anyone who opens a link on a phone; then the people who make clips.
- Takeaway: *a clip can be played, not only watched, and it is still a function of time and input.*
- Length: a 26 s song (12 bars at 120 bpm after a 4-beat count-in), around a title and a results screen.
- Input: tap a lane (touch or mouse) or press D F J K (or the arrows); menus by tap, click, Tab and Enter, Escape.

## Look

- Theme: `theme-neon` (new): violet-black, hot pink, cyan, lime, amber (`accent4`), Anton for display, Space Grotesk,
  Inter and JetBrains Mono.
- Title: synthwave poster: stacked display words with a pink/cyan split that kicks on the beat, a striped sun on a
  grid floor rolling towards the viewer, an equalizer, notes drifting up (`beat-title`). It keeps moving while the
  scene holds (on `f.ui.now`).
- Game: a highway into the distance (depth 1 / (1 + 2.6 z)), gems riding the four lanes, pads at the line that light
  under a press, a ring, sparks and the PERFECT / GOOD word where a note is caught, a count-in, the combo and a
  progress line (`beat-lanes`); the score as a HUD pill (`ui-score`), toasts at 10, 25 and 40 in a row (`ui-toast`).
- Results: rank (S to D) with the split, stars, the score counting up, stats on a panel (`beat-results`), the
  horizon behind (`beat-title` without words, horizon 0.76).
- Between scenes: `ui-tx-iris` opening from the button that was tapped (zoom 0: two blits instead of two
  resampled frames, which a phone without a GPU draws in time).

## Library

- Reused: music-loop (title loop and song, same bpm as the chart), synth-note (lane notes A C E G, the miss, the
  click), easing, kit-icon (button and dialog icons), the bundled fonts.
- New: `theme-neon`, `beat-lanes`, `beat-title`, `beat-results`, and the UI set (`ui-button`, `ui-toggle`,
  `ui-slider`, `ui-score`, `ui-toast`, `ui-dialog`, `ui-tx-iris` in the clip; `ui-card`, `ui-menu`, `ui-progress`,
  `ui-hotspot`, `ui-backdrop`, `ui-tx-push`, `ui-tx-zoom` made for the library alongside it). Every one has a note.

## Decisions

- The chart is computed by beat-lanes from bpm, bars and seed (a climb through the lanes for two bars, then random
  lanes never repeated back to back, eighths from the second quarter, a breath every fourth bar), so it always
  matches a music-loop at the same tempo; the results card's total (55 notes) is read from the same function.
- Catching: a note in reach draws `good` over its window (±0.14 s) and `perfect` on top of it near the beat (±0.06
  s); the topmost region fires, pressing on press (`press: 'down'`). A lane pressed with nothing in reach is `miss`
  (the combo breaks). A caught note is one whose region fired after it came into reach, so a replay is exact.
- Score: 100 a perfect, 50 a good, plus the combo; the best combo kept; each lane sounds its own note (the lane is the
  event's value, stored in `lane`, then one `if` per lane).
- Options on the title: key letters on the pads (a toggle) and the note speed (a slider, 0.6× to 1.6×), bound to
  variables the playfield reads. The how-to-play dialog disables what is under it and is a modal region.
- Escape in the song goes back to the title; Play again resets the variables and starts the song; Menu goes back.

## Checks

| check | result | how |
|---|---|---|
| prepare (wires against declared events, bindings) | pass | `update_clip` |
| check_clip, interactive | 0 errors, 0 warnings; 2 info (the dialog panel swallows taps: by design; the slider's target is 42.9 CSS px, advised 44) | 24 states, 80 transitions crawled |
| replay determinism | same hashes twice | `play_clip` with the recorded log (tests do the same) |
| share page, 1440×900 and 390×844 | plays, 0 console or network problems | `scripts/play-check.mjs` (real taps and keys; a bot plays the song) |
| frame time at phone width, no GPU | 1,812 frames, 0 skipped, worst 16.8 ms | `play-check.mjs --size 390x844 --mobile`, headless Chrome |
| GIF of a full playthrough | `docs/showcase/v5/gifs/` | `play-check.mjs --gif` |
