# Brief: Fablecut, iteration 3: finished videos, checked by the studio

Run with: `/goal-loop ITERATION_3_PROMPT.md`

Context. Iterations 1 and 2 are done (briefs: `INITIAL_PROMPT.md`, `ITERATION_2_PROMPT.md`; record: the
current `PROGRESS.md`; archive it to `docs/progress/` before starting). Fablecut draws motion graphics
well: function assets in a versioned library, pinned clips, transforms and per-format layouts, six asset
kinds, 3D, uploads, a request queue and 46 MCP tools. `motion_prompt_fablecut.md` is the process a session
follows to make a **finished** video with it: brief, script, style frames, transitions, animatic, final,
with rules for type, layout, timing, sound and licensing, and checks that must pass before I approve.
Writing that prompt showed where the studio stops short, and the prompt works around each gap by hand.
This iteration closes the gaps that matter most for a voiced, captioned motion-graphics video: a session
following that prompt does those steps inside the studio, and the studio itself measures whether the
video meets the prompt's rules. Iteration 2's final audit found low-contrast letters in clip 5 and a
faint caption in clip 6 by eye; the studio should have found them. Use your full abilities. The features
below are a draft, not a ceiling. Where something fits the ecosystem naturally, add it and record it
under **Decisions**.

Out of scope: `ITERATION_4_PROMPT.md` holds what comes next (footage, speech tools inside the studio, a
caption editor, font uploads, more render options, the repo round trip, provenance and credits, a
motion-graphics kit, logos). Don't build those here. Write anything this iteration learns about them
under **Notes**, for that session.

Feature:

- **Narration and word timings.** Ultrathink the model. Today a voice is a plain sound file, and nothing
  in the studio knows when a word is spoken.
  - A **narration** asset: a sound file plus its words (text, start, end) and the script it was meant to
    say. Word timings are imported in the shapes voice services and aligners return (word lists,
    character alignment, whisper.cpp's JSON). Replacing the audio with a new take of the same script
    keeps everything that is tied to its words.
  - Words reach every asset as `f.clip.words`, in clip time, the way beats reach them as `f.clip.beats`.
  - **Word anchors**: an item's start, a keyframe or a marker can be pinned to a word, so a visual lands
    on its key word and stays there when the take changes. The studio reports how far each anchored
    visual is from its word.
  - A **transcript check**: given a transcript of the take (from any speech-to-text tool), the studio
    names the slips, drops and insertions against the script, after normalising case, punctuation and
    numerals.

- **Captions from the words.**
  - Caption pages built from the words by rules: at most 2 lines; about 32 characters a line in 16:9 and
    20 in the other formats (settable); breaks at phrases; a number stays with its unit and a name stays
    in one piece; a page starts on its first word or up to 2 frames before, never after; it lasts at
    least 0.8 s; gaps under 0.3 s close. The pages can be adjusted over MCP and in the composition (move
    a break, merge or split a page) while the words stay the only source of times.
  - A caption asset (a new version of `text-captions`, or a new asset) that marks the spoken word by
    brightness from the real word times (today it splits each page evenly), never shrinks below its size
    floor, and stays in the caption lane.
  - Every render exports SRT and WebVTT, and the words as JSON. A clip chooses burned in or file only.

- **A real mix.** Ultrathink it. Today an audio item has one gain, nothing ducks, the render only holds
  sample peaks at 0.95 (`alimiter`), and nothing measures loudness.
  - Gain automation on audio items (keyframes in dB, with easing), and **ducking**: music drops under the
    narration by a set amount, with attack and release, driven by the narration's words or envelope. It
    is deterministic and sounds the same in the preview and the render.
  - **Loudness**: every render measures integrated loudness, loudness range and true peak (EBU R128) and
    stores them with the render. A clip can set a target (default -14 LUFS, true peak at or below
    -1 dBTP): the render reaches it with one fixed gain, limits the peaks first only when one gain cannot
    meet both, and says so.
  - **Stems**: the mix of any set of tracks (voice only, music only) as a WAV, measured the same way,
    without editing the clip. The studio reports how far the music sits under the voice where it speaks
    (in LU), silences longer than a threshold, and clipping.

- **Text that cannot fail silently, and layout the studio can measure.** Ultrathink it.
  - **Size floors**: a text asset can declare a minimum on-screen size against the frame's short side
    (not `f.vmin`, which is the item's box). `fit` stops there. Text that still overflows, truncates or
    breaks a word at the floor is an error the validator and the render report, not an ellipsis. It is
    opt-in, so no existing asset draws differently.
  - **Layout report**: everything drawn through `f.lib.text` is recorded with its box in frame pixels
    (after the item's transform, keyframes and motions), its font, on-screen size and colour, and its
    item. An MCP tool returns the report for any frame, with the safe zones and the caption lane.
  - **Glyph coverage**: the studio knows which characters each font file covers and flags, per asset and
    per clip and before any render, every character that would fall back to a system font.
  - **Overlays**: the grid, title-safe and action-safe, the platform zones, the caption lane and the
    measured text boxes, in the clip editor and in `render_clip_frame` (an option), never in a render.
  - **`check_clip`**: for a clip or a time range, each issue with its item, time, numbers and a still:
    text outside its safe zone or clipped by the frame; text boxes that overlap; text in the caption
    lane; text under the size floor; contrast under 4.5:1 against the worst pixels behind the box (drawn
    without the text); text held for less than words / 3 + 1 s; caption pages that break a rule; missing
    glyphs; an empty first frame; a last frame held for less than 2 s. The clip editor lists the issues
    and jumps to each one.
  - **Platform safe zones**: profiles (YouTube, Shorts, Reels, TikTok, a generic feed) with the zones and
    limits from each platform's current published guide, their sources recorded. A clip picks one or
    more, and the tightest edge wins. `f.safe` can follow them, opt-in, so old clips keep their pixels.
    Today the vertical format's `f.safe` (250, 72, 400, 72 px) is looser than a feed's zones.

- **Latin Extended in the bundled fonts.** The bundled families are `@fontsource` latin subsets: Romanian
  ă, ș, ț and every other Latin Extended letter fall back to a system font. Make them cover Latin
  Extended in Node and in the preview without changing a pixel of any existing clip.

- **Inspection and the render report.**
  - `render_clip_frame`, `frame_hashes` and contact sheets take a `format` (another shape, with its
    overrides) and a draft `composition` (unsaved). Today they draw only the saved clip, in its own
    format.
  - A **render report**, from the encoded file, on every render: ffprobe facts; loudness; black frames
    down to one frame; freezes down to half a second (named holds excepted); brightness jumps outside
    named cuts; more than 3 flashes in a second; silences; where the narration sits against the clip's
    timing, to the frame. Frame sheets from the encoded file: one frame per second plus the middle of
    every cut, with the times drawn in by the studio (FFmpeg here has no `drawtext`).
  - **Typed markers**: cut, hold, beat, word, note. Shown and edited on the timeline, and used by the
    checks. Today a marker is `{ t, label }` and the editor does not show markers at all.

- **`sync-assets` never undoes a change made in the studio.** Today, after I accept a proposal or save
  in the playground, the next sync makes a new version from the older file in `assets/` and so undoes
  the change. When the library's newest version did not come from the file, the sync stops, reports the
  conflict, and can pull the library's version into `assets/`.

Done means ALL of:

- **Nothing old breaks.** Before changing any code, record the frame hashes of clips 1 to 6 and of
  `history-of-ai` on **this** machine (extend `scripts/hashes.mjs`, which covers clips 1 to 3). After the
  iteration, `npm run showcase` rebuilds clips 1 to 6 from an empty data dir with **identical** hashes,
  and `history-of-ai` matches too. Compositions saved in the old shapes still load, edit and render.
- **Narration and captions, end to end.** A narration with imported word timings; an asset that reads
  `f.clip.words`; an item anchored to a word lands within 2 frames of it, and still does after the take
  is replaced by a re-timed one. The transcript check names a planted slip, drop and insertion, and
  passes a transcript that differs only in case, punctuation and numerals. Caption pages obey every
  rule, tested on the hard cases (numbers with units, names, long words, punctuation, short gaps). SRT
  and VTT parse back and equal the script; burned in and file only both work; the highlight follows the
  real word times, checked on frames.
- **The mix.** Gain keyframes and ducking give the same samples in the preview and the render. A render
  with a target measures -14 LUFS (±1) and a true peak at or below -1 dBTP with FFmpeg's `ebur128` on
  the final file, and a case that needs the limiter says so. Stems export and measure; silences are found.
- **Text and layout.** A text that cannot fit at its floor fails with a useful error in the validator and
  in the render, and every existing asset draws exactly as before. Layout-report boxes match the drawn
  pixels within 2 px, tested on scaled, rotated, keyframed and moving items. A missing glyph is flagged.
  The overlays work in the editor and in `render_clip_frame`. On a seeded bad clip, `check_clip` finds
  every issue class above. On clips 1 to 6 its findings are reviewed, and they include the low-contrast
  letters in clip 5 that iteration 2's audit saw by eye. The platform profiles cite their sources.
- **Fonts.** A line with ă, â, î, ș and ț in both cases, set in every bundled family, draws in the preview
  and in Node with no system-font glyph and within the parity limits, while the old clips' hashes stay
  identical.
- **Inspection and the render report.** Frames, hashes and sheets in another format and from a draft; the
  render report on every render, in the studio and over MCP; sheets from the encoded file with the times
  drawn in; typed markers on the timeline.
- **Sync.** `sync-assets` refuses to undo an accepted proposal or a playground save, and pulls the
  library's version into `assets/` when asked (tested).
- **MCP.** Every new capability has an MCP tool or option, covered by the stdio client test. Bad inputs
  get useful errors and crash nothing.
- **Studio UI.** The narration's words and the markers on the timeline, gain automation and ducking in
  the inspector, loudness and the render report on each render, the issues panel and the overlays: each
  driven in a real browser with real input and recorded as a GIF. Clean at 1440×900 and 390×844.
- **Two finished videos, made the way `motion_prompt_fablecut.md` says.** That prompt is the acceptance
  test.
  - **Clip 7**: a voiced explainer of about 60 s, horizontal, with a vertical render from the same
    composition and captions burned in. **Clip 8**: a text-and-music video of 30 to 45 s, vertical, made
    for a feed (with that platform's profile), its words on screen in Romanian, cut on the music's bars.
    It reuses what clip 7 made.
  - Both follow the prompt's gates in order, through MCP, journalled so `npm run showcase` replays them.
    At each `[me]` stop the session writes the gate message into `work/<slug>/` and goes on. There is no
    owner in this session: record that no gate was approved by one.
  - Every check in the prompt's `<checks>` passes (or is n/a where the prompt says so for a video with
    no voice), run through the studio's own tools wherever the check is a measurement, with the report
    committed. Both are valid MP4s (H.264, AAC at 48 kHz, yuv420p, BT.709, faststart, the expected size
    and fps) at -14 LUFS (±1), true peak at or below -1 dBTP; in clip 7 the music sits 16 to 20 LU under
    the voice where it speaks. Their sheets are read frame by frame. The compounding table gains rows
    for clips 7 and 8.
- **The prompt matches the studio.** `motion_prompt_fablecut.md` is revised: each workaround for
  something this iteration built gives way to the feature; the ones iteration 4 will remove stay, marked
  as such. Every tool and option it names exists, and it claims nothing the studio cannot do.
  `README.md`, `docs/ASSET_CONTRACT.md`, `docs/COOKBOOK.md` and `studio_guide` describe the new features.
- **Speed.** Render speed of clips 1 to 3 measured again on this machine, no more than 10 % slower than
  the baseline taken at the start. The costs of the loudness pass, the render report and `check_clip`
  are reported separately.

Constraints:

- **Machine:** macOS 15.5, Intel Core i5-10600 (6 cores, 12 threads), Node 24.21, npm 11.19, FFmpeg 8.1
  at `/usr/local/bin` (it has `ebur128`, `loudnorm`, `sidechaincompress`, `silencedetect`,
  `blackdetect`, `freezedetect` and `scdet`; it has no `drawtext`, no libass and no whisper filter),
  Chrome in `/Applications`, Claude Code CLI 2.1.295 at `~/.local/bin/claude`, Homebrew, Python 3.11.
  `.claude/goal-loop/project.md` describes the M2 Mac as the last machine: **update it first**, commit it
  on its own, and fix it whenever you learn otherwise.
- **Disk:** about 5.5 GB free. Renders with grain (180 to 600 MB each) and a voice model are large.
  Bound every cache, delete scratch data dirs when done, set `TMPDIR` for the tests, check free space
  before a big step, and write a Blocked item rather than fill the disk. Run long renders under
  `caffeinate -dimsu` (a sleep mid-render failed clip 5 once).
- **The user's studio** runs on port **8787** with data in `./data`. Never touch either. Use your own
  port and a scratch data dir for everything.
- **No Anthropic API key** for anything in Done, and no other paid service: a voice service is used only
  if its key is in `.env` (there is none now). Installing whisper.cpp (Homebrew, for the showcase's word
  times and transcript) and a local voice model is allowed when the disk allows it (at least 2 GB left
  afterwards), outside the repo, with their licences recorded. Models are never committed.
- **The showcase voice:** my recording, if `brand/voice/` holds one when the showcase starts; otherwise a
  voice service whose key is in `.env`; otherwise a local open model whose code, weights and voice allow
  commercial use and redistribution (Kokoro-82M, Apache-2.0, is one). Record which and why. If none can
  work, those items are Blocked with what would unblock them, and the rest is verified with a labelled
  stand-in.
- **Browser feedback:** headless (`cdp.mjs`, `sweep.sh`, `scripts/workflows-v2.mjs`) for sweeps, evidence
  and the GIFs it can make; Claude in Chrome for the interactive workflows. Its GIF export lands in
  `~/Downloads`, which this terminal could not read last time (see the Blocked item in the archived
  record), so plan the evidence around that.
- **Unchanged from iterations 1 and 2:** determinism (seeded RNG, no clock or `Math.random`); isolation
  with timeouts (a bad asset of any kind crashes nothing); versions are immutable and clips pin them; the
  preview and the render come from one source of truth, with parity measured; no build step for the
  studio.
- **Dependencies:** each new one needs a reason under **Decisions** and a compatible licence, and is
  served locally: no CDNs at runtime. Prefer FFmpeg, already required, for decoding and measuring.
- **Licensing:** assets are original or properly licensed. Audio is procedural, CC0, or a voice whose
  licence allows publishing. Fonts are open-licensed, with their licences in the repo.
- **Repo hygiene:**
  - no database, renders, caches, models or scratch files in git;
  - the showcase is reproducible from the repo (`assets/`, `clips/`, `showcase/journal/`), including the
    narration's words and the voice file when its licence allows redistribution (a compressed copy under
    5 MB);
  - MP4s go on a new GitHub release `showcase-v3` (authorised), never in git;
  - evidence goes in `docs/showcase/v3/` with an `INDEX.md` that maps each contract item to its files.
- **Commits:** commit and push to `origin main` after each milestone
  (https://github.com/Narcis13/davidapp). Leave `goal-loop/` and `.claude/skills/goal-loop/` alone.
- **Suggested order** (re-plan freely): `project.md` and the hash baseline; typed markers and the
  inspection options; the render report; the layout report, size floors, glyph coverage and the Latin
  Extended fonts; `check_clip`, the overlays and the platform profiles; gain automation, ducking,
  loudness and stems; narration, words, anchors, the transcript check and captions; the sync guard; the
  UI; clips 7 and 8 through the motion prompt; the revised prompt and the docs; the final audit.
