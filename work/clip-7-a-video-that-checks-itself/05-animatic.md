# Gate 5 · Animatic — clip 7

**[me] stop.** No owner in this session: nobody approved this gate; the session went on.

The whole clip with its real timing, drawn from the composition (`render_clip_frame`, 24 frames each):
`frames/animatic-horizontal.png` and `frames/animatic-vertical.png`.

## Measured by the studio (composition, before rendering)
| check | horizontal | vertical |
|---|---|---|
| `check_clip`, 125 frames each (every 0.5 s), 11 checks | **0 issues** | **0 issues** |
| caption pages (2 lines, 32 / 20 characters, ≥ 0.8 s, lead ≤ 2 frames, gaps < 0.3 s closed) | no rule breaks | no rule breaks |
| `anchor_report`: 31 anchored starts, keyframes and markers | max 0.5 frame from their words | same composition |

## The mix (`audio_report`)
- Before the master: −22.5 LUFS, true peak −5.5 dBTP. One gain to −14 LUFS would have put the peaks at +3.0 dBTP,
  so the master **limited the peaks to −10.2 dBTP first, then +8.7 dB reached −14.0 LUFS** (true peak −1.5 dBTP).
- **Music under the voice: 16.8 LU** where the narration speaks (target 16–20): the bed ducks 18 dB on the words
  (attack 0.15 s before each stretch, release 0.45 s), 31 stretches.
- No silence of a second or more (the fade at the end was shortened after the first report found 1.05 s of it), no clipping.

## Changes made at this gate
- The background now fades out by 58 s, so the end card's line keeps 4.5:1 against what is behind it and the last
  frame holds 4 s (it measured 4.43:1 against the moving background at 58 s).
- The music's end fade is shorter (−9 dB and a 0.9 s fade instead of −18 dB and 0.6 s): no silence longer than 1 s.
- The caption builder itself was fixed in the studio (fast speech made a 0.09 s page): a page shorter than 0.8 s now
  costs more than any other cut, and the clip's pages pass every rule.
