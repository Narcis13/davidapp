# Iteration 4 evidence: footage, a kit, and a library the repo can rebuild

Each contract item of `PROGRESS.md` and where it is shown. Paths are relative to this folder unless they start with
`test/`, `src/`, `scripts/`, `clips/`, `work/` or `showcase/`. The MP4s are on the GitHub release
[`showcase-v4`](https://github.com/Narcis13/davidapp/releases/tag/showcase-v4). Everything here was made on the Windows 11
PC (i9-14900KF) from a fresh `npm run showcase` into an empty data dir with no voice tools configured, unless noted.

The videos (the finals of that rebuild; each frame-identical to the render the clip was made with):

| clip | file on the release | length, shape | loudness on the file | report, sheets, credits |
|---|---|---|---|---|
| 9 Your first clip (onboarding) | `clip-9-your-first-clip.mp4` | 54.6 s, 1920×1080, 30 fps, 16.4 MB | −14.0 LUFS, −1.4 dBTP | `reports/clip-9.render-report.json`, `sheets/clip-9-1.png`, `-2.png`, `reports/credits-clip-9.md` |
| 10 Every clip helps the next (marketing) | `clip-10-every-clip-helps.mp4` | 27.5 s, 1080×1080, 6.6 MB | −14.0 LUFS, −1.2 dBTP | `reports/clip-10-square.render-report.json`, `sheets/clip-10-square-1.png`, `reports/credits-clip-10-square.md` |
| 10, vertical render of the same composition | `clip-10-every-clip-helps-9x16.mp4` | 27.5 s, 1080×1920, 9.1 MB | −14.0 LUFS, −1.2 dBTP | `reports/clip-10-vertical.render-report.json`, `sheets/clip-10-vertical-1.png` |
| 11 The kit (a tour, music only) | `clip-11-the-kit.mp4` | 16.1 s, 1920×1080, 5.4 MB | −14.1 LUFS, −1.1 dBTP | `reports/clip-11.render-report.json`, `sheets/clip-11-1.png`, `reports/credits-clip-11.md` |

## General

| # | item | evidence |
|---|---|---|
| G1 | gates (typecheck, lint, test) | `PROGRESS.md` Log: 434 tests pass |
| G2 | every screen clean at 1440×900 and 390×844, server log without ERROR | `reports/sweep.txt` (the rebuilt showcase data), `reports/sweep-ui2.txt` (the UI agent's sweep of the new screens), `studio/*.png` |
| G3 | the showcase rebuilds from an empty data dir, clips 1–11, with no voice model | `reports/showcase-build.txt` (every step), `reports/hashes-final.txt`; clips 9–11's rebuilt renders are frame-identical to the originals (18/18 samples each, in `PROGRESS.md` Log) |

## Nothing old breaks

| # | item | evidence |
|---|---|---|
| D1 | clips 1–8 and `history-of-ai` identical to the baseline taken before any change; iteration 3's tests pass | `reports/baseline-hashes.json`, `reports/hashes-final.txt` (1,563 dense frames and 162 render samples, all identical); `test/` |

## Footage

| # | item | evidence |
|---|---|---|
| D2 | MP4, MOV, WebM and screen recordings import and are probed; HDR, sound-only and broken files get useful errors | `reports/footage-probe.json` (`scripts/footage-probe.mjs`); `test/footage.test.js` `probing: …`, `bad footage gets useful errors and crashes nothing` |
| D3 | footage as a layer: fit, trim, speed, loop, hold, transforms, effects, masks; a fixed frame rule | `test/footage.test.js` `the frame rule: …`, `footage as a layer: the drawn frame is the source frame the rule picks…`, `footage in an image parameter…`; `studio/v4-footage-*.png`, `gifs/footage-timeline.gif` |
| D4 | frame-exact: two renders identical, preview within parity limits, caches bounded and on disk measured; its sound plays | `test/footage.test.js` (workers 1 and 3 identical; the tone in the mix); `reports/parity.json` (footage cases); `reports/footage-cost.md` (disk and time); `test/footage.test.js` `review fixes: …` (keyframed params, a busy decoder, eight frames in one) |
| D5 | two designs weighed for footage | `PROGRESS.md` Decisions ("Footage design") |
| D6 | a script records a studio workflow in headless Chrome | `scripts/record-studio.mjs`, `scripts/recordings/*.mjs`; `showcase/footage/*.mp4` and `clip-9/*.mp4` with their sidecars |

## Voice, captions, fonts, render options

| # | item | evidence |
|---|---|---|
| D7 | speech tools: transcription, alignment, voice generation with samples; stubs in tests, real runs | `test/speech.test.js`; `reports/speech-*.json` (exact times 69/69 within 2 frames, natural speech, generation, samples, clip 7 transcript); clips 9 and 10 voiced by `generate_narration` |
| D8 | caption editor on the timeline | `gifs/captions-editor.gif`, `studio/v4-captions*.png` |
| D9 | font assets, no restart, pinned | `test/fonts.test.js`; `gifs/font-upload.gif`, `studio/v4-font-*.png` |
| D10 | render options: 720p draft, workers, several formats, poster time; isolate in frames, hashes and sheets | `test/render-options.test.js`; `gifs/render-options-repo.gif`, `studio/v4-render-*.png` |

## Repo, provenance, kit, logos, MCP, UI

| # | item | evidence |
|---|---|---|
| D11 | repo and library agree: export, import into an empty library with the same refs and frames, a missing file named, written back | `test/exchange.test.js`; `reports/roundtrip-*.txt`; `studio/v4-repo-*.png` |
| D12 | provenance on every file asset, credits, final renders refuse placeholders and unknown licences | `test/provenance.test.js`; `reports/sources.md`, `reports/credits-clip-*.md`; `gifs/provenance-licence.gif`, `studio/v4-provenance-*.png`, `studio/v4-render-refused.png` |
| D13 | the kit, each with notes and a usage example, all in the showcase | `test/kit-ui.test.js`, `test/kit-marketing.test.js`; `studio/kit-*.png`; clips 9, 10 and 11 (`work/clip-11-the-kit/README.md` lists where each kit asset appears); `gifs/kit-playground.gif` |
| D14 | logos as given: style sheets and gradients, Chrome pixel diff | `test/svg-logos.test.js`; `reports/logo-diff.json`, `studio/logo-*.png` |
| D15 | MCP for every new capability | the `MCP over stdio` test of each file above; `reports/prompt-tools-after.txt` (67 tools) |
| D16 | studio UI, in a real browser, as GIFs, clean at both sizes | `scripts/workflows-v4.mjs`, `reports/workflows-v4.json` (146 checks); `gifs/*.gif` (each with a phone version) |

## The clips

| # | item | evidence |
|---|---|---|
| D17 | clip 9: onboarding, 54.6 s, from screen recordings, cursor, zooms, spotlights, voice, captions, ducked music | `work/clip-9-your-first-clip/` (gates 1–7, facts, look, checks), `reports/clip-9-checks.md`, `showcase/journal/clip-9-your-first-clip.jsonl` |
| D18 | clip 10: marketing, 27.5 s, square and vertical, the logo as given, icons, a chart, an end card | `work/clip-10-every-clip-helps/`, `reports/clip-10-checks.md`, `showcase/journal/clip-10-every-clip-helps.jsonl` |
| D19 | both through the prompt's gates, journalled; every check passes; valid MP4s at −14 LUFS; the compounding table | `reports/clip-9-checks.md`, `reports/clip-10-checks.md`, `reports/check-clips-v4.md` (0 issues in every shape after the rebuild), `reports/compounding.md` |
| D20 | clips 7–10 (and 11) rebuild from a clean checkout through their exports | `reports/roundtrip-clips-7-11-clone.txt` (same refs, 48/48 frames each) |
| D21 | the motion prompt revised, checked against the tools; docs | `motion_prompt_fablecut.md`; `reports/prompt-tools-before.txt` (25 tools, 19 workarounds) and `reports/prompt-tools-after.txt` (43 tools, 0 unknown, 0 workarounds); `README.md`, `docs/ASSET_CONTRACT.md`, `docs/COOKBOOK.md` |
| D22 | speed of clips 1–3 within 10 % of the baseline; footage cost apart | `reports/render-speed.md` (×1.03, ×0.98, ×1.00), `reports/footage-cost.md` |
| D23 | the voice route and its licences; no models committed | `LICENSES.md`; `tools/voice/` |
| D24 | repo hygiene; MP4s only on the release | `.gitignore`; `gh release view showcase-v4` |
