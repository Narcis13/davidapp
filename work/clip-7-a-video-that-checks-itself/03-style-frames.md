# Gate 3 · Style frames — clip 7

**[me] stop.** No owner in this session: nobody approved this gate; the session went on.

## The look
Theme Tide: navy `#07111f`, surface `#11233b` plates, ink `#eef4ff`, cyan accent `#5ce1e6`, orange `#ffb347`.
Space Grotesk for titles, Anton for the one big word, JetBrains Mono for eyebrows and labels, Inter for the
end card line. Every text sits on a solid plate (or the dark background at the end), so its contrast holds over
the moving gradient. Type sizes are shares of the frame's short side (title 7.2 %, plates 6.4 %, rows 4.2 %,
captions 4.2 %, eyebrows ≥ 2.6 %); the vertical layout uses 15–20 % larger type through its format overrides.

## Frames (rendered with `render_clip_frame`, overlays on a copy)
- `frames/style-contrast-overlays.png` — 0:27, "CONTRAST" anchored to its word, with title-safe, action-safe,
  f.safe, the YouTube zone and the caption lane drawn in.
- `frames/style-checks-vertical-overlays.png` — 0:44 in the vertical render: the check list, three rows ticked on
  their words, the fourth still muted, with the Shorts zone and the measured text boxes.

## What changed after looking (each a new asset version, journalled)
- **word-strip v2:** words placed by time ran into each other when spoken fast ("Thevoice you arehearing"): now in
  reading order, scrolled so the spoken word sits at the playhead.
- **check-list v3:** the plate waited empty for 4.6 s before its first word: now every row is there from the start,
  muted, and lights up with its tick (`progress` keyframed on the words).
- **duck-meter v2:** its live dB number changed with every pause (text too brief to read): now a fixed label.
- **word-strip v3:** the passing words are marked as a ticker (`role: 'ticker'` in `f.lib.text.layout`): the captions
  are what is read; `check_clip` no longer holds each passing word to reading time.
