# Gates 2 and 3 · Script and style frames — clip 9, "Your first clip"

**[me] stop (two approvals in one stop).** No owner in this session: **nobody approved these gates; the session went
on.** What approving would freeze: the words of `clips/clip-9-your-first-clip/script.json`, the look (theme Tide), and
the voice.

## Script (`script.json`; `narration.txt` is its spoken words, 89 words)
| beat | words | key word | visual (and where it starts from in the library) |
|---|---|---|---|
| result | This is a clip made in Fablecut. In the next minute, you will make one like it. | Fablecut | the gallery playing clip 7 (recording `studio-gallery-play`), the camera moving in on the player; `title-plate` "Your *first* clip" |
| find | Start in the library. Search for what you need, and every asset shows you what it draws. | Search | `studio-library-search`: search, filter, a card opens; spotlight on each, callout "Search *every* asset", camera on the card |
| tune | Open one in the playground. Change a parameter, and the preview follows at once. | Change | `studio-playground-param`: the text is typed, size and weight move; callout "Change a *parameter*", camera on preview + parameters |
| place | Add it to a clip. Drag it on the timeline, and trim it to fit. | Drag | `studio-editor-place`: add from the picker, drag, trim, play; spotlight on the timeline, camera on it |
| render | Then render. The studio checks the file it made, from loudness to frozen frames. | render | `studio-render-check`: render, done, the measurements; callout "Checked on the *file*", camera on the voiced clip's −14.1 LUFS |
| next | Find, tune, place, render. Open the studio, and make your first clip. | Open | `kit-steps` ticking on each word, then `end-card@3`: "Make your *first* clip", "Open the studio", `npm run studio`, the repo URL |

On screen beside every step: `kit-steps` (Find · Tune · Place · Render), the current step lit. Estimated length at
150 words a minute: 36 s of speech; the take measures **35.2 s**, spaced over six beats into **55.5 s** (speech 63 %
of the length, under the 85 % ceiling).

## Voice (gate 3: three samples of one line, `voice_samples`)
`voice-samples/af_heart.m4a` (Kokoro grade A, US), `bf_emma.m4a` (B−, UK), `am_michael.m4a` (C+, US), each the
line "This is a clip made in Fablecut. In the next minute, you will make one like it." Default taken: **af_heart**
(the highest grade; the voice of clip 7, so the series sounds the same). The take was made in the studio with
`generate_narration`: 89 of 89 words matched, transcript checked with small.en and base.en, **no slips, drops or
insertions**. Provenance: Apache-2.0 (Kokoro-82M weights and voices), AI-generated, credited.
Pronunciation list: "Fablecut" (FAY-bul-cut), "npm run studio" (on screen only, not spoken).

## Music (3 candidates; default taken)
1. **`music-loop@1`, synthesized by the studio** (no licence to clear, no Content ID) — default, as in clip 7.
2. A CC0 track from Pixabay Music — not searched: no web access is needed when the studio makes its own.
3. Silence under the voice — rejected: the read-time gaps between steps would be dead air.
Ducked 18 dB under the voice from its words (`duck`), measured 17.8 LU under it where it speaks (`audio_report`).

## Style frames (`frames/`, full resolution, drawn by `render_clip_frame`)
`style-t4.5.png` (result), `style-t10.5.png` (find, callout), `style-t24.png` (tune, camera on the sliders),
`style-t33.png` (place, camera on the timeline), `style-t43.2.png` (render, camera on the measurements),
`style-t53.png` (end card), and `style-t10.5-overlays.png` (the same as 10.5 with the grid, title-safe, the
YouTube zone, the caption lane and the measured text boxes).
Caption style: `text-captions@2`, two lines, the spoken word lit in the accent, on a navy pill in the caption lane.
Treatment of footage: the real studio at 0.74 of its recorded size in a rounded window (`mask-rect`) above the
caption lane; the spotlight dims the rest by 55 %; the camera zooms to a region in the window's own shape so the
recording never runs out; the cursor is drawn from the recording's sidecar.

## Checks run before this stop
`check_clip`: **0 issues** (after fixing: the title outside YouTube's zone, two callouts that moved with the camera
and so were not held still long enough, and an end that held 1.77 s). `audio_report`: −14.0 LUFS, true peak −1.5 dBTP
(the studio limited the voice's peaks 10.5 dB first and says so), music 17.8 LU under the voice, no silence.
