# Iteration 5 evidence: share links, interactive mode, a UI kit, and a game

Each item of the task and where it is shown. Paths are relative to this folder unless they start with `test/`,
`src/`, `scripts/`, `assets/`, `clips/`, `work/`, `showcase/` or `docs/`. Everything here was made on the Windows 11
PC (i9-14900KF) in headless Chrome (the Chrome binary, driven by `scripts/lib/browser.mjs`), unless noted. The
designs weighed and the choices made are in [DECISIONS.md](DECISIONS.md).

Two exported pages were used throughout, each served by `scripts/serve-static.mjs` under a sub-path with the studio
stopped: clip 11 "The kit" (video, footage) at `/clips/the-kit/` and clip 12 "Tap the beat" (interactive) at
`/games/tap-the-beat/`. Neither is published; publishing is the user's step (see the end of this page).

## Share links

| # | item | evidence |
|---|---|---|
| S1 | any clip as a page with its own player, the clip's asset code running in the viewer's browser on a canvas; no MP4, no iframe | `src/player/` (page, player, worker, engine), `src/studio/share.js`; `test/share.test.js` "an export is one folder that plays from anywhere…" (the page has a canvas and no `<video>`, `<iframe>`, `<embed>` or `<object>`; the folder holds no video file) |
| S2 | a studio URL (`/share/<clip>`) and a static export folder that plays from any static server with the studio stopped | `test/share.test.js` "the studio serves /share/<clip>…"; `scripts/share.mjs`, `scripts/serve-static.mjs --prefix`; `reports/share-check-clip-11.json` (the export, under `/clips/the-kit/`) |
| S3 | at 1440×900 and 390×844: plays, pauses, scrubs (video), full screen, sound on the first tap, no console or network errors | video: `reports/share-check-clip-11.json` (16 checks at 1440×900, 15 at 390×844, all pass, `problems: []`), `studio/share-clip-11-*.jpg`; interactive: `reports/controls-clip-12-*.json` (the first tap on Play starts the game and the sound; pause, resume with the sound running, full screen in and out, mute and unmute; both sizes pass, `problems: []`), `studio/share-clip-12-controls.jpg` (phone paused, phone and desktop in full screen) |
| S4 | the page's frames match the render within `scripts/parity.mjs`'s limits (mean ≤ 1.5, >64 ≤ 1 %) | clip 11: `reports/share-check-clip-11.json` `parity` (7/7 frames, worst mean 0.902), `studio/parity-clip-11-f300.jpg`; clip 12: `reports/parity-clip-12.json` (16/16 states of a scripted playthrough: title, dialog, the iris, the song, results; worst mean 1.047), `studio/parity-clip-12-f204-transition.jpg` |
| S5 | link previews: OG and Twitter tags with title, description and poster | `test/share.test.js` (the tags and a 1200×630 `og.jpg`); the exported `index.html` of both clips; absolute URLs need `--base-url` (see Publishing) |
| S6 | page weight and time to first frame, measured | clip 11: first frame 220 ms after 3.20 MB at 1440×900, 235 ms after 2.21 MB at 390×844; 10.3 / 10.6 MB for the whole visit; export 13.1 MB in 238 files (`reports/share-check-clip-11.json`). Clip 12: first frame 218–615 ms over ten loads (median 332 ms), 1.36 MB for the whole playthrough; export 1.56 MB in 49 files (`reports/frames-clip-12.json`). From a local static server |

## Interactive mode

| # | item | evidence |
|---|---|---|
| I1 | a second kind of composition, never rendered to MP4 | `src/core/interactive.js`, `src/core/composition.js`; `test/interactive.test.js` "…refuses to render it to MP4", `test/interactive-mcp.test.js` "start_render refuses an interactive clip and says it is played" |
| I2 | plays like slides or a mini-game: clicks, taps, keys, pointer | clip 12 (below); `test/interactive.test.js` "input is read against the regions the frame drew", "f.ui reports hover, focus and what the clip sent the item"; `test/ui-assets.test.js` "wires on their events change variables… (tap, hotkeys, Tab + Enter, arrows)" |
| I3 | events flow through the composition; assets declare what they emit and accept; the clip wires them | `docs/ASSET_CONTRACT.md` "Interactive assets: events and f.ui", "Interactive compositions"; `test/interactive.test.js` "asset definitions declare their events"; `src/studio/clips.js` (wires checked against declared events) |
| I4 | validates, previews and plays in the studio editor | `reports/workflows-v5.json` (the editor driven with real mouse, keys and touch at 1440×900 and 390×844: play, problems, clips; 52 of 52 checks pass on the final code, no ERROR in the server log), `gifs/editor-*.gif`, `studio/v5-*.png` |
| I5 | created, edited and checked through MCP tools | `test/interactive-mcp.test.js` (create_clip `interactive: true`, edit_clip operations, play_clip, check_clip, layout_report regions); clip 12 was built through them: `showcase/journal/clip-12-tap-the-beat.jsonl` |
| I6 | replaying a recorded input log gives identical frame hashes, twice | `test/interactive.test.js` "the same log replayed twice gives identical frames…", `test/ui-assets.test.js` "the same input log replays to the same pixels", `test/interactive-mcp.test.js` "play_clip: … a log that replays to the same frames" |
| I7 | check_clip checks an interactive clip across its states | `reports/check-clip-12.json` (clip 12: 0 errors, 0 warnings, 2 info: the dialog's scrim takes taps with no wire on it, by design, and the speed slider is 42.9 CSS px tall where 44 is advised; 40 states and 99 transitions crawled, stopped at the default `max_states` of 40, since every catch changes the score); `test/interactive-mcp.test.js` "check_clip finds a planted unreachable scene, dead end, wire without a target, tiny and covered hit regions" |
| I8 | state is a pure function of time, params and the event log; two or more designs weighed | [DECISIONS.md](DECISIONS.md) "The event model (three designs weighed)"; `src/core/interactive.js` `replay`, `initialState`, `applyInput` |

## UI assets (14, all themed)

`assets/ui-button`, `ui-card`, `ui-menu`, `ui-toggle`, `ui-slider`, `ui-progress`, `ui-score`, `ui-dialog`,
`ui-toast`, `ui-hotspot`, `ui-backdrop`, `ui-tx-iris`, `ui-tx-push`, `ui-tx-zoom`. Each reads `f.theme`, declares
its events, has notes and a usage example (`showcase/ui-notes.json`, the asset's own header), and keeps its text at
or above the floor.

| # | item | evidence |
|---|---|---|
| U1 | eight or more, each themed, with notes, a usage example and events | `test/ui-assets.test.js` "created and validated, described, tagged ui + interactive, with a usage example, events and a theme", "each control draws under three themes…" |
| U2 | text floors respected and in the layout report | `test/ui-assets.test.js` "their text is in the layout report, at or above the floor, in both shapes" |
| U3 | how they look: three themes, both shapes, states | `studio/ui-*.png` (one sheet per asset, made by `scripts/ui-sheets.mjs`) |

## Clip 12, "Tap the beat"

A rhythm game, vertical, 60 fps: `clips/clip-12-tap-the-beat/` (compose script, clip), notes in
`work/clip-12-tap-the-beat/README.md`, game assets `assets/beat-lanes.js`, `beat-title.js`, `beat-results.js`,
`theme-neon.js`.

| # | item | evidence |
|---|---|---|
| C1 | plays from its share link with mouse, touch and keyboard | three playthroughs of the exported page, every input real (CDP touch, mouse and key events): `reports/play-clip-12-touch-phone.json` (390×844, all by touch: how to play, Got it, Play, the song's notes tapped on their lanes, Menu), `play-clip-12-mouse-desktop.json` (1440×900, all by mouse clicks, then Play again), `play-clip-12-keyboard-desktop.json` (1440×900, keys only: H, Enter, Tab and Enter, D F J K in the song, Tab and Enter to play again). Each: 53 of 55 notes caught, 38 perfect, no stray press (the bot lets 7 % go and presses 18 % late, by note index), no frame skipped, `problems: []`. GIFs recorded in Chrome: `gifs/clip-12-playthrough-touch-phone.gif`, `gifs/clip-12-playthrough-keyboard-desktop.gif`; stills `studio/share-clip-12-*.jpg` (title, dialog, song at 390×844, 844×390 and 1440×900) |
| C2 | 60 fps with no dropped frames at phone width, measured | `reports/frames-clip-12.json`: ten whole visits of the exported page, five at 390×844 (mobile) and five at 1440×900, in headless Chrome without a GPU (software raster on a steady 60 Hz clock: the slowest drawing). Each from 1.5 s into the title, before the tap on Play (the first gesture: the sound starts there), through the iris and the 26 s song to the results. **0 frames skipped in every run** (1,870–1,881 frames each); a frame's round trip (the worker draws it, the page shows it) p50 9.4–9.6 ms, p99 12.0–12.4 ms; the browser never held back an animation frame for 50 ms. Each run lists where any frame was skipped (`gaps`, empty) and the frames over 16.7 ms (`slow`: two in the ten runs, both at the tap, neither costing a frame). How the first runs' lost frames were fixed: [DECISIONS.md](DECISIONS.md) "Measuring 60 fps" |
| C3 | a fresh-eyes review, and its findings fixed | three Opus reviews with fresh eyes: the code (15 findings, fixed in `9bd582e`), the experience of both share pages and the game at desktop and phone size (fixed in `c8ac720`, `8252346`), and a last one of the frame-time and sound changes (six findings: five fixed in the final commit, with tests for the clock; Firefox's console left as a known gap) |

## Nothing old breaks

| # | item | evidence |
|---|---|---|
| D1 | the showcase clips' frames identical to the baseline taken before any change | `reports/baseline-hashes.json` (clips 1–11 and history-of-ai at `a8d635f`, before any change: 1,933 dense frames and 216 render samples); `reports/showcase-build.txt` (every showcase clip rebuilt from its journal into an empty data dir with this branch, 230 steps, none failed); `reports/hashes-final.txt` (that rebuild compared with the final code: all 12 clips identical, every dense frame and render sample) |
| D2 | MP4 renders behave as before, old compositions load unchanged | D1 rebuilds every showcase clip from its journal into an empty data dir with this branch and renders it; `test/` (all of iteration 4's tests pass) |
| D3 | gates: typecheck, lint, tests | `npm run typecheck` and `npm run lint` clean; `npm test` 487 of 487 pass (443 at the baseline; the new ones in `test/interactive.test.js`, `share.test.js`, `ui-assets.test.js`, `interactive-mcp.test.js`, `ui-wires.test.js`) |

## Docs

`README.md` "Share links and interactive clips", `docs/ASSET_CONTRACT.md` ("Interactive assets: events and f.ui",
"Interactive compositions"), `docs/COOKBOOK.md` ("Share a clip as a page", "An interactive clip"),
`.claude/skills/new-video/SKILL.md` (share links and interactive clips).

## Known gaps

- Safari, Firefox and a physical phone were not tested: every page check ran in Chrome (headless, with mobile
  emulation and touch at 390×844). The sound follows WebKit's rule (the context is resumed inside the gesture),
  unverified there; Firefox may log a console warning for an audio context made before a gesture, which Chrome doesn't.
- Frame time was measured with software raster in headless Chrome (the slowest drawing), not on a phone's GPU.
- Link previews need absolute URLs: the exported pages here have relative `og:image` until they are exported again
  with `--base-url` (the publish step).
- check_clip's crawl of clip 12 stops at 40 states: a game's score makes its states endless.
- Polish the experience review raised and that was left: on a phone, the video page's "Tap for sound" pill covers a
  word of the title for a moment; after tabbing out of the game, its focus ring and the page's can show together;
  the results card's sun shows faintly through its panel; key letters on the pads are on by default on touch
  screens; the game has no pause key of its own (the page's pause button works); clip 11's link-preview
  description reads like a spec.

## Publishing (left to the user)

Nothing was published or deployed. To publish a share page on any static host (contzo.lol, GitHub Pages, a
release), export it with the URL it will live at, so link previews get absolute `og:image` and `og:url`:

```
STUDIO_DATA=<data> node scripts/share.mjs clip-12-tap-the-beat --base-url https://<host>/<path>/
```

then upload the folder `output/share/clip-12-tap-the-beat/` as it is, and check it with
`node scripts/share-check.mjs <url>` or `scripts/play-check.mjs`.
