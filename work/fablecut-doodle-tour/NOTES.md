# fablecut-doodle-tour

Clip: http://127.0.0.1:8787/clips/fablecut-doodle-tour · `clips/fablecut-doodle-tour/compose.mjs` · push: `node .claude/skills/new-video/scripts/push-clip.mjs fablecut-doodle-tour`

## Brief

- What: "of FableCut showcasing the most ambitious features with a doodle style and eye catchy of about 90 seconds, horizontal"
- For whom: people who make videos or build with code, meeting Fablecut for the first time
- Takeaway: Fablecut is a video studio where every frame is code, and every clip makes the next one easier.
- Length, shape(s), voiced: 90 s · horizontal 1920×1080 only · text and music · runs on: YouTube (platform zones) · language: English
- Product / brand / call to action: Fablecut; the logo as given (`brand/fablecut-logo.svg`, already in the library as `fablecut-logo@1`); "Make your first clip" / `npm run studio` (from the README)

## Look

- Theme: `theme-fablecut-doodle@2` (new): the sketchbook keys in the logo's colours. Paper `#f6f0e3`, ink `#1d1b3a`,
  accent `#4a2fd0` (the logo's violet, deepened so a key word passes 4.5:1 on the highlighter), accent2 `#ff5c8a` (the
  logo's pink: marker fills, the scribble's rim, arrows), highlight `#ffd166` (the logo's yellow: highlighter, the
  scribble's band), accent3 `#13a07f` (ticks).
- Type: Kalam (OFL, added: `kalam`, `kalam-bold`) for headlines and labels; JetBrains Mono for code and the url.
  Titles 89 px (8.2 %), hook 150 px, labels and code ≥ 4 % (the 16:9 floor; `checks.minTextSize: 4`).
- Grid: titles on one line at the top left (`TITLE_BOX`), art below (`ART_BOX`), both inside YouTube's zone (y 108–972).
- Shape language: hand-drawn ink with boil (8 fps re-jitter), doodle cards with a hard offset ink shadow, marker fills
  that sit slightly off their outlines, dot-grid paper, no gradients.
- Cut carrier: `trans-scribble@2`, a marker zigzag that paints the next beat in (yellow band behind its head, pink rim).
- Reference: `clips/history-of-ai` (the sketch family), clip 10 (logo end card).

## Script and clock

- Beats: `script.json` (10 beats); 120 bpm, a bar is 2 s; cuts at 8, 18, 28, 38, 50, 58, 66, 76, 82 s (all on bars);
  the end card is in by 82.7 s, pushes in slowly (scale 1 → 1.03) and is still from 87.4 s (hold marker from 87.2 s).
- Text and music only.

## Library

- Reused as is: end-card@3, fablecut-logo@1, music-loop (with the drum assets), sfx-whoosh, synth-note, easing, and from
  the sketch family bg-paper and sfx-pencil. Synced from `assets/` into this studio for the first time
  (they had only lived in the hand-built `history-of-ai`): theme-sketchbook, bg-paper, sketch-ink, sketch-doodle,
  text-handwrite, sketch-chat, sketch-network, sketch-chapter, sketch-timeline, sfx-pencil, sketch-snowfall.
- New: `theme-fablecut-doodle` (value), `trans-scribble` (transition), `sketch-code`, `sketch-filmstrip`,
  `sketch-notes`, `sketch-bars`, `sketch-formats`, `sketch-checklist`, `sketch-callouts` (visuals), `kalam`,
  `kalam-bold` (fonts), `doodle-3d-word` (baked sequence).
- New versions: `sketch-ink@2/3` (roundBox, tick, card; v3: the card's shadow never shows through it),
  `text-handwrite@2/3` (glyphs measured by the checks, a size floor; v3: the highlighter sits on its word),
  `sketch-doodle@2` (clapper, speaker, notes; idle `beat`), `sketch-chat@2` (bubble no longer cut at the box edge),
  `block-text-3d@3` (`rock`: a held 3D word keeps turning gently), `block-text-3d@4` (`glyphs`: the D redrawn rounded,
  so "3D" never reads as "30"); the bake is `doodle-3d-word@4`.
- Presets: `trans-scribble-band` (the cut: band + rim, on the title track; rim 0 / body 0 on the art track) and
  `text-handwrite-doodle-title` (Kalam Bold 92 px, floor 7, left, 0.4 s pause, 1.1 s write); both used by the clip.
  No precomp: no group of layers recurs.
- Featured, in the collection `doodle`: the theme, trans-scribble(-band), the title preset and the seven sketch-* pieces.
- Notes left: trans-scribble (band on the top track only), block-text-3d (the D, the bake colour), text-handwrite
  (no scale keyframes while writing), end-card (raise it before a push-in in the YouTube zone).

## Decisions (defaults taken, to overrule at the stop)

- The name on screen is "Fablecut", as the logo and the README write it (the brief wrote "FableCut").
- Which features: code as video (a frame is a function of time), the versioned library, compounding reuse (the README's
  numbers for clips 4–6: 242 → 123 → 0 new lines of asset code), directing by words (request → proposal → accept),
  one composition in three shapes, software 3D (no GPU, same pixels everywhere), the self-checks, synthesized sound.
  Left out: narration and captions, footage and screen recordings (to keep it pure doodle).
- No voice (the brief did not ask for one); music `music-loop` 120 bpm A major, triangle arp, light swing.
- Horizontal only, for YouTube (`platforms: ['youtube']`, `safe: 'platform'`).
- A handwriting face (Kalam, OFL) added for the doodle look; the bundled faces are all geometric.
- The 3D word is baked in the theme's accent2 passed explicitly (`#ff5c8a`): a bake has no clip theme.
- Sound design: a soft whoosh under every scribble cut, pencil under the hook, a pluck on each tick and on the zero,
  a chord under the end card.

## Checks

All pass; the full table with evidence is `checks/report.md` (`scripts/checks-report.mjs`, final #23, second render #22).

| check | status | evidence |
|---|---|---|
| check_clip | pass | 0 issues, step 0.27 s, 339 frames |
| cut-strips (viewed) | pass | 8-frame sheets across all 9 cuts |
| frame-sheet (viewed) | pass | drafts #17/#18, finals #21/#23; draft #16's 6.6 s still end card fixed with a push-in |
| takeaway (fresh eyes) | pass | a subagent shown only the sheets restated the takeaway; it read "3D" as "30", fixed (block-text-3d@4) |
| spelling-and-facts, literals | pass | words from script.json; 242/123/0 from the README; compose.mjs writes no words/colours/times |
| check_provenance / clip_credits | pass | 0 problems, 0 warnings; Kalam OFL credited |
| format (final) | pass | 1920×1080 30 fps H.264 yuv420p BT.709, AAC 48 kHz, faststart, 90.00 s |
| loudness (final) | pass | −14.1 LUFS, true peak −1.3 dBTP |
| determinism | pass | 18/18 sampled hashes equal across 8 and 3 workers |
| re-render (export) | pass | export_clip wrote clip.json with 48 check frames; library/ holds the closure (36 refs) |

## Stop: style frames (step 4), approved

Stills in `work/fablecut-doodle-tour/frames/` (t = 0.3, 5.5, 8.3, 16, 25, 36, 46, 56, 64, 74, 81, 88.5 s; t16 with
overlays). Approving freezes the words (`script.json`), the look tokens (`theme-fablecut-doodle@2`) and the beats
(`timing.mjs`).

## Render

Final render #23: `work/fablecut-doodle-tour/out/final.mp4` (git-ignored), `poster.png` at 84 s, `credits.txt`.
From a clean checkout:

```
npm install
STUDIO_DATA=./data node scripts/library.mjs import clips/fablecut-doodle-tour --verify   # or import_clip
npm run studio                                    # in the background (after the import)
node scripts/mcp.mjs call start_render '{"clip":"fablecut-doodle-tour","final":true,"poster_at":84,"wait_seconds":900}'
```

Or rebuild from the sources: `node .claude/skills/new-video/scripts/push-clip.mjs fablecut-doodle-tour --render`.
The baked `doodle-3d-word@4` is exported as its recipe (block-text-3d@4 + params) and re-baked on import.

## Open / unverified

- None. Taste notes from the fresh viewer left as they are: "-14 LUFS" and "4.5 : 1" are jargon for non-developers
  (the audience is people who build with code); the logo's "a" is drawn as given.

## Next

- Done. Compounding: 363 calls, 3125 new lines of asset code, reuse share 45 %.
