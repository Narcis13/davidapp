# Gates 2 and 3 · Script and style frames — clip 10, "Every clip helps the next"

**[me] stop (two approvals in one stop).** No owner in this session: **nobody approved these gates; the session went
on.** What approving would freeze: the words of `clips/clip-10-every-clip-helps/script.json`, the look (theme Tide),
and the voice.

## Script (`script.json`; `narration.txt` is its spoken words, 47 words)
| beat | words | key word | visual (and where it starts from in the library) |
|---|---|---|---|
| outcome | Every video you make leaves pieces behind. | pieces | `title-plate` "Every video leaves *pieces* behind"; three `kit-icon`s (film, layers, package) pop one per word: "video", "make", "pieces" |
| product | In Fablecut, each one becomes an asset: searchable, versioned, and ready for the next clip. | asset | `kit-ui-frame` (a browser at the studio's address) playing the recording `studio-library-search`; under it three icons and labels (Searchable, Versioned, Reusable) land on their words |
| proof | Nine clips added eighty-three assets to the library, and two clips needed no new code at all. | eighty-three | `kit-plate` with `kit-chart-line` "Assets added, running total", drawing from "Nine" up to 83 at clip 9; the callout "Clips 6 and 8: *no new code*" on "two" |
| cta | Make your next video with code, in Fablecut. | Make | `end-card@3`: the Fablecut logo as given (vectors), "Make your next video with *code*", "Every clip helps the next", the button "Make your first clip", the repo URL |

Estimated length at 150 words a minute: 19 s of speech. The take measures **18.3 s** to its last word, spaced over four
scenes into **27.5 s**; `audio_report` finds 14.2 s of speech (52 % of the length, under the 85 % ceiling). The end
card holds 2.6 s after the last word.

## Voice (gate 3: three samples of one line, `voice_samples`)
`voice-samples/af_heart.m4a` (Kokoro grade A, US), `bf_emma.m4a` (B−, UK), `am_fenrir.m4a` (C+, US), each the line
"Every video you make leaves pieces behind." Default taken: **af_heart** (the highest grade; the voice of clips 7
and 9, so the series sounds the same). The take was made in the studio with `generate_narration`: 47 of 47 words
matched, transcript checked with small.en and base.en, **no slips, drops or insertions**. A second take
(`clip-10-voice@2`) replaced the first when the facts check found the proof line wrong (see `facts.md`); it matched
47 of 47 too. Provenance: Apache-2.0 (Kokoro-82M weights and voices), AI-generated, credited.
Pronunciation list: "Fablecut" (FAY-bul-cut); "eighty-three" is written as words so the voice cannot misread "83".

## Music (3 candidates; default taken)
1. **`music-loop@1`, synthesized by the studio**, 112 BPM, major (no licence to clear, no Content ID) — default, as in
   clips 7 and 9.
2. A CC0 track from Pixabay Music — not searched: the studio makes its own.
3. Silence under the voice — rejected: in a feed, gaps of silence read as a broken video.
Ducked 18 dB under the voice from its words (`duck`), measured 18.2 LU under it where it speaks (`audio_report`).

## Style frames (`frames/`, full resolution, drawn by `render_clip_frame`)
Square: `style-square-t3.5.png` (outcome), `style-square-t10.png` (product, the three labels),
`style-square-t18.5.png` (proof, chart and callout), `style-square-t25.png` (end card).
Vertical: `style-vertical-t10.png`, `style-vertical-t18.5.png`, `style-vertical-t25.png`, and
`style-vertical-t18.5-overlays.png` (the grid, title-safe, the Reels zone, the caption lane and the measured text).
Caption style: `text-captions@2`, two lines, the spoken word lit in the accent, on a navy pill in the caption lane.
Treatment of footage: the real studio in a browser frame (`kit-ui-frame`, address 127.0.0.1:8787), drifting slowly;
it fades in rather than scaling up, because its chrome text sits at its size floor.

## Checks run before this stop
`check_clip` in both shapes: **0 issues**, after fixing: the square first took Reels' vertical zone (a profile now
applies only to the shapes it is made for); label boxes too small for their text at the floor; the vertical tab title,
which had no room at the floor and is left empty there; a chart title that drifted 1 px outside the safe zone.
`audio_report`: −14.0 LUFS, true peak −1.5 dBTP, music 18.2 LU under the voice, no silence.
