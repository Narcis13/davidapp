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
- Input: tap a lane (touch or mouse) or press D F J K (or the arrows); menus by tap, click, Tab and Enter (H opens
  how to play, Enter closes it).

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
  s); the topmost region fires, pressing on press (`press: 'down'`). A lane pressed with nothing in reach is `miss`: a
  stray press, which breaks the combo and counts against the accuracy (`hits / (notes + strays)`), so mashing every
  key does not earn an S. A caught note is one whose region fired after it came into reach, so a replay is exact.
- Score: 100 a perfect, 50 a good, plus the combo; the best combo kept. A catch's value is `{ lane, combo }`:
  beat-lanes keeps the streak itself (a stray press or a note let through breaks it), the wire stores both with
  `$value.lane` and `$value.combo`, then one `if` per lane sounds its note.
- Options on the title: key letters on the pads (a toggle) and the note speed (a slider, 0.6× to 1.6×), bound to
  variables the playfield reads. The how-to-play dialog disables what is under it and is a modal region.
- Play again resets the variables and starts the song; Menu goes back to the title. Escape does not quit the song (it
  did in the first build): one press threw a run away, and in full screen the browser takes Escape to leave it.

## Checks

| check | result | how |
|---|---|---|
| prepare (wires against declared events, bindings) | pass | `update_clip` |
| check_clip, interactive | 0 errors, 0 warnings; 2 info (the dialog's scrim takes taps with no wire on it: by design; the slider's target is 42.9 CSS px, advised 44) | 40 states (the default cap), 99 transitions crawled |
| replay determinism | same hashes twice | `play_clip` with the recorded log (tests do the same) |
| share page, 1440×900 and 390×844 | plays; the first tap starts the sound; pause, resume, full screen, mute; 0 console or network problems | `scripts/play-check.mjs` (real taps, clicks and keys) |
| parity of the page with the Node render | 16 states (title, dialog, the iris, the song, results) within the limits, worst mean 1.05 | `scripts/parity-interactive.mjs` |
| frame time, no GPU, from the title through the tap, the song and the results | 10 runs (5 at 390×844, 5 at 1440×900), 0 frames skipped in each; round trip p99 12.0–12.4 ms | `play-check.mjs`, headless Chrome; `docs/showcase/v5/reports/frames-clip-12.json` |
| the song played by real touch taps, mouse clicks and keys | 53 of 55 notes caught, 38 perfect, no stray presses, each way | `play-check.mjs` bot with `input: touch / mouse / key` |
| GIF of a full playthrough | touch on a phone, keys on a desktop: `docs/showcase/v5/gifs/` | `play-check.mjs --gif` |
