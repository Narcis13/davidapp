# check_clip on the showcase clips

Written by `scripts/reports-v3.mjs`: `check_clip` on every clip of the showcase (frames every 0.5 s), clip 7 in both of its formats. Clips 1 to 6 were made before the studio could check them; their findings are listed and reviewed below. Clips 7 and 8 were made through the checks.

| clip | format | frames | seconds | safe-zone | clipped | overlap | caption-lane | size | contrast | hold | captions | glyphs | first-frame | last-frame |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| clip-1-every-frame | vertical | 65 | 1.04 | · | · | · | · | 1 | 11 | 4 | · | · | · | 1 |
| clip-2-compounding | horizontal | 65 | 1.28 | · | · | · | · | 6 | 15 | 1 | · | 1 | · | 1 |
| clip-3-release-notes | square | 65 | 1.01 | · | · | · | · | 7 | 20 | · | · | 1 | · | 1 |
| clip-4-direct-the-studio | horizontal | 61 | 11.39 | · | · | · | · | · | 7 | 2 | · | · | · | 1 |
| clip-5-a-library-in-3d | vertical | 121 | 26.29 | · | · | · | · | · | 13 | 2 | · | · | · | 1 |
| clip-6-what-the-library-holds | square | 181 | 21.06 | · | · | · | · | 12 | 11 | 2 | · | · | · | 1 |
| clip-7-a-video-that-checks-itself | horizontal | 125 | 1.42 | · | · | · | · | · | · | · | · | · | · | · |
| clip-7-a-video-that-checks-itself | vertical | 125 | 1.39 | · | · | · | · | · | · | · | · | · | · | · |
| clip-8-cuvinte-pe-ritm | vertical | 78 | 0.87 | · | · | · | · | · | · | · | · | · | · | · |

## Review of clips 1 to 6

Each finding was looked at against its still or the frame. All are real by the rules; none is a measuring error:

- **contrast** — mostly bare text over moving gradients, glows and photos (titles, labels, the logo sting's tagline), measured against the worst 5 % of the pixels behind each text box. The iteration 2 audit saw two of them by eye: **clip 5's REUSE letters** (3D block letters used as the mask of a photo, 1.04:1 from 40.5 s to 49.5 s, still: `studio/check-clip-5-reuse-letters.png`) and clip 6's faint lower third over the terrain.
- **size** — small labels under 2.5 % of the short side: the watermark (2 %), chart and formats labels (1.3–2.3 %), lower-third subtitles (2.1 %).
- **hold** — words flashed one at a time by kinetic title cards (clip 1's "VIDEO WAS WRITTEN NOT…", clip 5's title card) and short-lived subtitles: on screen for less than words / 3 + 1 s.
- **glyphs** — an arrow (→) in clip 2 and an emoji (🚀) in clip 3 that the bundled fonts do not have (drawn with a system font).
- **last-frame** — every one of clips 1 to 6 animates to its very last frame (logo stings, grain): none holds its end for 2 s.

None of these were changed: old clips keep their pixels (their versions are pinned). The rules are what clips 7 and 8 were made to pass.

## Every finding

### clip-1-every-frame (vertical)

- hold · 0.5 s · hook · "VIDEO" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 1 s · hook · "WAS" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 1.5 s · hook · "WRITTEN" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 2 s · hook · "NOT" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- contrast · 3.5 s · hook · "EDITED" has a contrast of 1.63:1 against the worst pixels behind it (needs 4.5:1).
- size · 4–27 s · mark · "fablecut" is 21.84 px on screen (2% of the frame's short side), under the floor of 2.5%.
- contrast · 5–9.5 s · idea · "Every frame is a function of time" has a contrast of 2.32:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 10.5–15.5 s · nokeys · "No timeline. No keyframes. Just code." has a contrast of 1.44:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 20–21.5 s · stats · "ASSETS LEFT IN THE LIBRARY" has a contrast of 1.6:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21.5 s · stats · "One clip, by the numbers" has a contrast of 3.23:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21.5 s · stats · "KEYFRAMES SET BY HAND" has a contrast of 1.61:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21.5 s · stats · "FRAMES RENDERED" has a contrast of 2.44:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 23–27 s · same · "Same input. Same pixels." has a contrast of 2.92:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 27 s · determinism · "Rendering is deterministic by design" has a contrast of 3.09:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 28.5–30 s · logo · "Fablecut" has a contrast of 2.07:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 29.5–31 s · logo · "Every clip leaves building blocks behind" has a contrast of 1.25:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 31.97 s · – · The last frame is held for 0.1 s; it should hold for at least 2 s.

### clip-2-compounding (horizontal)

- glyphs · 0 s · pins · → (U+2192) is not in JetBrains Mono: it would be drawn with a system font.
- size · 0.5–26.5 s · mark · "fablecut" is 21.84 px on screen (2% of the frame's short side), under the floor of 2.5%.
- size · 1.5–4.5 s · l1 · "horizonta" is 22.95 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- hold · 2 s · subtitle · "Clip two starts with 28 assets already w" is on screen for about 3 s; 8 words need 3.67 s (words / 3 + 1).
- contrast · 3.5–4.5 s · subtitle · "Clip two starts with 28 assets alread…" has a contrast of 2.38:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 4.5 s · title · "THE LIBRARY COMPOUNDS" has a contrast of 1.85:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 5.5–12.5 s · chart · "Assets behind each clip" has a contrast of 2.99:1 against the worst pixels behind it (needs 4.5:1).
- size · 6–12.5 s · l2 · "reuse, count" is 22.95 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- contrast · 6.5–11.5 s · chart · "written for it" has a contrast of 4.16:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 6.5–12.5 s · chart · "reused" has a contrast of 3.35:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 8.5–12.5 s · l2 · "reuse, counted from the database" has a contrast of 2.1:1 against the worst pixels behind it (needs 4.5:1).
- size · 14–20.5 s · l3 · "which clip m" is 22.95 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- contrast · 15.5–17.5 s · flow · "28 new" has a contrast of 2.47:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 15.5 s · flow · "Clip 2" has a contrast of 3.68:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 15.5–20.5 s · flow · "7 new · 24 reused" has a contrast of 1.32:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 20.5 s · l3 · "which clip made what" has a contrast of 3.94:1 against the worst pixels behind it (needs 4.5:1).
- size · 22–26.5 s · l4 · "immutable, p" is 22.95 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- contrast · 22–23.5 s · l4 · "immutable, p" has a contrast of 4.03:1 against the worst pixels behind it (needs 4.5:1).
- size · 22.5–26.5 s · pins · "update_asset" is 24 px on screen (2.2% of the frame's short side), under the floor of 2.5%.
- contrast · 24.5–26.5 s · never · "Edit an asset. Old clips never change." has a contrast of 1.61:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 26.5 s · pins · "update_asset" has a contrast of 1.94:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 26.5 s · pins · "same frames" has a contrast of 3.07:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 28.5–31 s · logo · "The library compounds" has a contrast of 2.28:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 31.97 s · – · The last frame is held for 0.13 s; it should hold for at least 2 s.

### clip-3-release-notes (square)

- glyphs · 0 s · captions · 🚀 (U+1F680) is not in Inter: it would be drawn with a system font (emoji are drawn with the system emoji font, so they differ per OS).
- contrast · 2–3.5 s · hook · "NEW" has a contrast of 3.78:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 3.5 s · hook · "FABLECUT" has a contrast of 1.93:1 against the worst pixels behind it (needs 4.5:1).
- size · 4–26.5 s · mark · "fablecut" is 19.32 px on screen (1.8% of the frame's short side), under the floor of 2.5%.
- size · 4.5–12.5 s · notes · "RELEASE NOTES" is 24.84 px on screen (2.3% of the frame's short side), under the floor of 2.5%.
- contrast · 10–12.5 s · notes · "An AI edits both through MCP" has a contrast of 3.13:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 11–12.5 s · notes · "Clips pin the versions they use" has a contrast of 1.5:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 12.5 s · notes · "Assets are functions with parameters" has a contrast of 2.94:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 12.5 s · notes · "Three ideas, one studio" has a contrast of 4.25:1 against the worst pixels behind it (needs 4.5:1).
- size · 14–19.5 s · l2 · "counted from" is 18.36 px on screen (1.7% of the frame's short side), under the floor of 2.5%.
- contrast · 14.5–19.5 s · chart · "24" has a contrast of 2.94:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 14.5–19.5 s · chart · "reused" has a contrast of 2.16:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 15–19.5 s · chart · "29" has a contrast of 2.94:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 18.5–19 s · l2 · "counted from the database" has a contrast of 3.73:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 19–19.5 s · chart · "written for it" has a contrast of 1.44:1 against the worst pixels behind it (needs 4.5:1).
- size · 20.5–26.5 s · formats · "vertical" is 13.61 px on screen (1.3% of the frame's short side), under the floor of 2.5%.
- size · 20.5–26.5 s · formats · "horizontal" is 13.61 px on screen (1.3% of the frame's short side), under the floor of 2.5%.
- size · 21–26.5 s · formats · "square" is 13.61 px on screen (1.3% of the frame's short side), under the floor of 2.5%.
- size · 21–26.5 s · l3 · "vertical · h" is 18.36 px on screen (1.7% of the frame's short side), under the floor of 2.5%.
- contrast · 21.5–23 s · formats · "9:16" has a contrast of 3.43:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21.5–26.5 s · formats · "vertical" has a contrast of 1.92:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 24–25 s · formats · "16:9" has a contrast of 1.91:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 25–25.5 s · l3 · "vertical · horizontal · square" has a contrast of 3.8:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 25.5–26.5 s · formats · "horizontal" has a contrast of 1.74:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 25.5–26.5 s · formats · "square" has a contrast of 3.05:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 28–29 s · logo · "Fablecut" has a contrast of 1.28:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 29–30.5 s · captions · "Every clip leaves the next one a head…" has a contrast of 3.59:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 29.5–31 s · logo · "Made with code , built from parts" has a contrast of 1.77:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 31.97 s · – · The last frame is held for 0.07 s; it should hold for at least 2 s.

### clip-4-direct-the-studio (horizontal)

- hold · 0.5 s · title · "DIRECT" is on screen for about 1 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 1.5 s · title · "THE" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- contrast · 2–6.5 s · title · "STUDIO" has a contrast of 2.52:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 9.5–14 s · behind-title · "Titles go behind it" has a contrast of 1.02:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 20.5–21.5 s · numbers · "Iteration 2, by the numbers" has a contrast of 3.32:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 20.5–22 s · numbers · "ASSETS IN ONE SEARCH" has a contrast of 3.27:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21.5–22.5 s · numbers · "MCP TOOLS" has a contrast of 2.63:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 22–22.5 s · numbers · "NEW ASSET KINDS" has a contrast of 2.99:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 28–29 s · end · "A studio you direct" has a contrast of 2.13:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 29.97 s · – · The last frame is held for 0.1 s; it should hold for at least 2 s.

### clip-5-a-library-in-3d (vertical)

- hold · 0.5 s · opener · "A" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 1 s · opener · "LIBRARY" is on screen for about 1 s; 1 word need 1.33 s (words / 3 + 1).
- contrast · 2.5–6.5 s · opener · "IN 3D" has a contrast of 2.06:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 4–7 s · intro-third · "Clip 5 · vertical" has a contrast of 3.28:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 7 s · intro-third · "a minute built mostly from clip 4" has a contrast of 1.53:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 14.5–17.5 s · grows · "GROWS" has a contrast of 1.01:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 24–26.5 s · baked · "the 3D orb, as frames: reused for free" has a contrast of 1.58:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 25–26 s · baked · "Baked once" has a contrast of 1.36:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 30–34.5 s · numbers · "ASSETS FROM CLIP 1" has a contrast of 3.74:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 38.5–39.5 s · numbers · "NEW IN CLIP 4" has a contrast of 3.23:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 38.5–39.5 s · numbers · "NEW IN CLIP 5" has a contrast of 3.15:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 40.5–49.5 s · letters-photo · "REUSE" has a contrast of 1.04:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 42–48.5 s · reuse-line · "An uploaded photo, through 3D letters" has a contrast of 2.47:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 54–55 s · end · "Fablecut" has a contrast of 3.22:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 54–59 s · end · "Every clip makes the next one cheaper" has a contrast of 1.24:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 59.97 s · – · The last frame is held for 0.1 s; it should hold for at least 2 s.

### clip-6-what-the-library-holds (square)

- hold · 0.5 s · opener · "WHAT" is on screen for about 0.5 s; 1 word need 1.33 s (words / 3 + 1).
- hold · 1 s · opener · "THE LIBRARY" is on screen for about 1 s; 2 words need 1.67 s (words / 3 + 1).
- contrast · 2–6.5 s · opener · "HOLDS" has a contrast of 1.03:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 4.5–8 s · third · "Clip 6 · square" has a contrast of 1.13:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 4.5–8 s · third · "ninety seconds, nothing wri" has a contrast of 1:1 against the worst pixels behind it (needs 4.5:1).
- size · 11 s · chart · "1233" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 11 s · chart · "353" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 11.5 s · chart · "1286" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 11.5 s · chart · "567" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 11.5 s · chart · "175" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12–23.5 s · chart · "1288" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12–23.5 s · chart · "577" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12 s · chart · "205" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12 s · chart · "228" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12.5–23.5 s · chart · "206" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 12.5 s · chart · "241" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- size · 13–23.5 s · chart · "242" is 22.62 px on screen (2.1% of the frame's short side), under the floor of 2.5%.
- contrast · 14–14.5 s · chart · "New lines of asset code, per clip" has a contrast of 4.2:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 21–23.5 s · chart · "lines written" has a contrast of 3.45:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 35.5–37.5 s · orb-line · "Baked in clip 5, reused here" has a contrast of 2.54:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 40–53.5 s · compound · "COMPOUND" has a contrast of 1.02:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 66.5–67 s · numbers · "SECONDS LONG" has a contrast of 3.05:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 66.5–67 s · numbers · "CLIPS TO DRAW ON" has a contrast of 3.02:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 84–89 s · end · "The library compounds" has a contrast of 1.82:1 against the worst pixels behind it (needs 4.5:1).
- contrast · 85–89 s · end · "Fablecut" has a contrast of 3.27:1 against the worst pixels behind it (needs 4.5:1).
- last-frame · 89.97 s · – · The last frame is held for 0.07 s; it should hold for at least 2 s.
