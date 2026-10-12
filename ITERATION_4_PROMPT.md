# Brief: Fablecut, iteration 4: footage, a kit, and a library the repo can rebuild

Run with: `/goal-loop ITERATION_4_PROMPT.md`

Context. Iteration 3 is done (brief: `ITERATION_3_PROMPT.md`; record: the current `PROGRESS.md`; archive
it to `docs/progress/` before starting). It made the studio check a finished video: narrations with word
timings, captions built from the words, a mix with ducking and loudness targets, layout reports and
`check_clip`, Latin Extended in the bundled fonts, a report on every render, and a `sync-assets` that
cannot undo a change made in the studio. This brief was written together with iteration 3's, before
iteration 3 ran, and holds what was cut from it to keep it focused. **Read iteration 3's record first**:
where it already built part of this, built it another way, or learned something that changes it, adapt
this brief and record how under **Decisions**. The goal is the one `motion_prompt_fablecut.md` sets: a
session following it does every step inside the studio, and when this iteration ends no workaround is
left in that prompt. Use your full abilities. The features below are a draft, not a ceiling. Where
something fits the ecosystem naturally, add it and record it under **Decisions**.

Feature:

- **Footage.** Ultrathink it. The studio places stills, SVGs, baked sequences and sounds. It has no video
  asset, and `library.addSequence` is not exposed.
  - Video files (MP4, MOV, WebM, screen recordings) as library assets: probed (size, frame rate,
    duration, rotation, colour, audio), conformed to the clip's frame rate deterministically, and
    frame-exact: the same frame in the preview and the render, the same hash twice.
  - Used like any layer (fit, trim in and out, speed, loop, hold, transforms, effects, masks), with its
    sound as an audio item or dropped. Thumbnails, filmstrips, waveforms.
  - Weigh at least two designs (decoding on demand in each worker against a frame cache; the preview
    decoding in the browser against frames from the server) for determinism, parity, speed and disk.
    The disk is small (about 5.5 GB free when this was written): no design that stores every frame as
    PNG, and every cache has a size limit.
  - A script that records a studio workflow in headless Chrome to a video file, so a video about the
    studio can show its real UI.

- **Speech tools inside the studio.** Behind one interface, each one optional: transcription with word
  times (whisper.cpp's `whisper-cli` when it is installed), which feeds iteration 3's transcript check;
  aligning a narration to its script when its words came without times; voice generation through an
  adapter (a voice service whose key is in `.env`, or a local open model), with samples of one script
  line in several voices (the motion prompt's gate 3 asks for three). Without them the studio imports
  files and says what it cannot do.

- **A caption editor.** Caption pages adjusted on the timeline in the studio (move a break, merge or
  split a page), while the words stay the only source of times. Iteration 3 made this possible over MCP
  and in the composition.

- **Font assets.** Add a font file (TTF, OTF, WOFF2) to the library with its licence, family, weight and
  style. Its coverage is read, and it works at once in the render workers and the preview, with no
  restart (today both read `fonts/fonts.json` once, at start). Versioned and pinned like any asset, so a
  clip keeps the font it was made with.

- **Render options.**
  - Draft renders for an animatic: a scale (720p from 1080p, on whole pixels) and a fast preset,
    labelled as drafts.
  - A worker count per render (the motion prompt's determinism check compares renders made with two).
  - Several formats in one request, and a chosen poster time (today the frame at 40 %).
  - `render_clip_frame`, `frame_hashes` and contact sheets can isolate items (only these, or all but
    these).

- **The repo and the library agree.** Ultrathink it.
  - A clean checkout rebuilds a clip with the **same refs** (`name@n`) and the same frame hashes as the
    library it was made in. Today `sync-assets` pushes only the newest source of each asset, so version
    numbers differ between libraries, and presets, precomps and uploads exist only in the database.
    Export a clip with its closure (every version it pins, its presets and precomps, a manifest of its
    files with SHA-256, licence and source) to the repo, and import it into an empty library.
  - A clip edited in the studio (in the clip editor, or by an accepted proposal) can be written back to
    its folder.
  - Files that must stay out of git (stock, a voice, a licensed font) are listed by SHA-256, and an
    import names the ones that are missing.

- **Provenance and credits.** Every file asset carries its licence, source URL, creator, credit line,
  date and flags (AI-generated, Content ID, restrictions), set on upload and editable as metadata (today
  `upload_image` records only "uploaded by the user"). A clip's credits and sources are generated from
  its closure. A final render refuses an asset tagged `placeholder` or one with no licence.

- **A motion-graphics kit** for explainers, marketing and onboarding: library assets that read `f.theme`,
  each with notes and a usage example. A cursor (arrive, rest, click), a plate, a spotlight for UI, a
  camera that zooms and pans an image or footage to a region, arrows and callouts, an end card (logo,
  call to action, URL), a browser or device frame for UI captures, line and donut charts, a step
  indicator, and an open-source icon set (MIT, ISC or Apache, vendored with its licence) as one icon
  asset with a name, one weight and a colour. The kit's text uses iteration 3's size floors and shows in
  its layout report.

- **Logos as given.** The SVG sanitiser drops `<style>`, so a logo coloured through classes loses its
  colours, and `f.svg` flattens gradients to their first stop. Keep simple internal style sheets (class,
  id and type selectors with allowlisted properties) by inlining them, draw gradients in `f.svg`, and
  report exactly what an upload could not keep. Hostile SVGs stay rejected or sanitised.

- **Ideas worth considering** (none required): approvals (name a clip revision "approved at gate 5",
  show what changed since, warn when a frozen field changes); a review screen that lays out a gate's
  stills (style frames, transition panels, cut strips) for me; item params bound to the theme and to a
  clip-level script (`{ $theme: 'accent' }`, `{ $script: 'beat-3' }`) instead of copied hex values and
  words; per-word emphasis styles in captions.

Done means ALL of:

- **Nothing old breaks.** Before changing any code, record the frame hashes of clips 1 to 8 and of
  `history-of-ai` on **this** machine. After the iteration, `npm run showcase` rebuilds clips 1 to 8 from
  an empty data dir with **identical** hashes, `history-of-ai` matches too, and everything iteration 3
  added still passes its tests. Compositions saved in older shapes still load, edit and render.
- **Footage.** A screen recording of the studio and an FFmpeg test video (`testsrc2` at another frame
  rate, with a tone) are used as layers with trim, speed and loop. Two renders give identical hashes;
  the preview matches the render within the parity limits; disk use is measured and bounded; the test
  video's sound plays as an audio item.
- **Speech tools.** Tested with stubs, and run for real with `whisper-cli` and with the voice adapter
  where one is installed or has a key (otherwise noted). Aligning a take whose times are known (from the
  voice tool that made it) puts at least 95 % of its words within 2 frames of those times. Three voice
  samples of one line come back for a gate-3 stop.
- **Caption editor.** Pages edited on the timeline (a moved break, a merge, a split); the SRT and VTT
  follow; the words and their times do not change.
- **Font assets.** A font added through MCP and one dropped into the studio work at once in the preview
  and in Node, with their coverage and licence recorded; a clip that pins a font keeps it after the font
  gets a new version.
- **Render options.** A 720p draft render; renders at two worker counts with identical frame hashes; one
  request that renders three formats; a chosen poster; isolated items in frames, hashes and sheets.
- **Repo and library.** A clip exported with its closure and imported into an empty data dir has the
  same refs and the same frame hashes; an import with a file missing names it; a clip edited in the
  studio is written back to its folder.
- **Provenance.** Licence fields on uploads and file assets; credits generated for a clip; a final
  render with a placeholder, or an unlicensed asset, in its closure is refused.
- **Kit and logos.** Every kit asset exists, reads the theme, has notes, and appears in the showcase. An
  SVG logo with an internal style sheet and a gradient keeps its colours, compared by pixel diff with
  the original drawn in Chrome; the hostile-SVG tests still pass.
- **MCP.** Every new capability has an MCP tool or option, covered by the stdio client test. Bad inputs
  get useful errors and crash nothing.
- **Studio UI.** Footage trimmed on the timeline, caption pages edited, a font upload, the provenance
  fields and the kit in the playground: each driven in a real browser with real input and recorded as a
  GIF. Clean at 1440×900 and 390×844.
- **Two more finished videos, made the way `motion_prompt_fablecut.md` says.**
  - **Clip 9**: an onboarding video of 45 to 60 s about the studio itself, built from screen recordings
    of the studio, with cursor, zooms, spotlights, a voice, captions and ducked music. **Clip 10**: a
    marketing video of about 30 s for Fablecut, square with a vertical render, with its logo as given
    (an SVG with an internal style sheet and a gradient), icons, a chart and an end card with the call
    to action. Both reuse what clips 7 and 8 made.
  - Both follow the prompt's gates in order, through MCP, journalled so `npm run showcase` replays them.
    At each `[me]` stop the session writes the gate message into `work/<slug>/` and goes on, and records
    that no owner approved it.
  - Every check in the prompt's `<checks>` passes, run through the studio's own tools wherever the check
    is a measurement, with the report committed. Both are valid MP4s (H.264, AAC at 48 kHz, yuv420p,
    BT.709, faststart, the expected size and fps) at -14 LUFS (±1), true peak at or below -1 dBTP, with
    the music 16 to 20 LU under the voice where it speaks. Their sheets are read frame by frame. The
    compounding table gains rows for clips 9 and 10.
  - Clips 7 to 10 each rebuild from a clean checkout into an empty data dir through their exports, with
    the same refs and the same frame hashes.
- **No workaround left.** `motion_prompt_fablecut.md` is revised so that every step runs inside the
  studio: no workaround remains, every tool and option it names exists, and it claims nothing the studio
  cannot do. `README.md`, `docs/ASSET_CONTRACT.md`, `docs/COOKBOOK.md` and `studio_guide` describe the
  new features.
- **Speed.** Render speed of clips 1 to 3 measured again on this machine, no more than 10 % slower than
  the baseline taken at the start. The cost of footage is reported separately.

Constraints:

- **Machine:** when this was written, macOS 15.5 on an Intel Core i5-10600 (6 cores, 12 threads), Node
  24.21, FFmpeg 8.1 at `/usr/local/bin` (no `drawtext`, libass or whisper filter), Chrome in
  `/Applications`, the Claude Code CLI at `~/.local/bin/claude`, Homebrew, Python 3.11. Check
  `.claude/goal-loop/project.md` against the machine you are on, update it first if anything changed,
  and commit that on its own.
- **Disk:** about 5.5 GB free when this was written. Footage, renders with grain (180 to 600 MB each)
  and speech models are large. Bound every cache, delete scratch data dirs when done, set `TMPDIR` for
  the tests, check free space before a big step, and write a Blocked item rather than fill the disk.
  Run long renders under `caffeinate -dimsu`.
- **The user's studio** runs on port **8787** with data in `./data`. Never touch either. Use your own
  port and a scratch data dir for everything.
- **No Anthropic API key** for anything in Done, and no other paid service: a voice service is used only
  if its key is in `.env`. Installing whisper.cpp (Homebrew) and a local voice model is allowed when the
  disk allows it (at least 2 GB left afterwards), outside the repo, with their licences recorded. Models
  are never committed.
- **The showcase voice:** the route iteration 3 chose, if it still works; otherwise my recording in
  `brand/voice/`, a voice service whose key is in `.env`, or a local open model whose code, weights and
  voice allow commercial use and redistribution, in that order. Record which and why. If none can work,
  those items are Blocked with what would unblock them, and the rest is verified with a labelled
  stand-in.
- **Browser feedback:** headless (`cdp.mjs`, `sweep.sh`, the scripted workflows) for sweeps, evidence,
  the GIFs it can make and the screen recordings; Claude in Chrome for the interactive workflows. Its
  GIF export lands in `~/Downloads`, which the terminal may not be able to read, so plan the evidence
  around that.
- **Unchanged from iterations 1 to 3:** determinism (seeded RNG, no clock or `Math.random`); isolation
  with timeouts (a bad asset of any kind crashes nothing); versions are immutable and clips pin them; the
  preview and the render come from one source of truth, with parity measured; no build step for the
  studio; text that cannot fit fails loudly; a sync never undoes a change made in the studio.
- **Dependencies:** each new one needs a reason under **Decisions** and a compatible licence, and is
  served locally: no CDNs at runtime. Prefer FFmpeg, already required, for decoding, encoding and
  measuring.
- **Licensing:** assets are original or properly licensed. Audio is procedural, CC0, or a voice whose
  licence allows publishing. Footage is made by you (screen recordings of the studio, FFmpeg test
  sources). Fonts and the icon set are open-licensed, with their licences in the repo.
- **Repo hygiene:**
  - no database, renders, caches, models or scratch files in git;
  - the showcase is reproducible from the repo (`assets/`, `clips/`, `showcase/journal/` and the clip
    exports), including the narrations' words, the voice files when their licence allows
    redistribution (compressed copies under 5 MB each), and the screen recordings clip 9 uses, so a
    rebuild gets the same bytes. The recordings are ours: keep them small and add an exception to
    `.gitignore`, which ignores `*.mp4`, `*.mov` and `*.webm`;
  - MP4 renders go on a new GitHub release `showcase-v4` (authorised), never in git;
  - evidence goes in `docs/showcase/v4/` with an `INDEX.md` that maps each contract item to its files.
- **Commits:** commit and push to `origin main` after each milestone
  (https://github.com/Narcis13/davidapp). Leave `goal-loop/` and `.claude/skills/goal-loop/` alone.
- **Suggested order** (re-plan freely): `project.md` and the hash baseline; the render options; font
  assets; provenance and credits; the repo round trip; footage and the screen-recording script; the
  speech tools; the caption editor; logos; the kit; the UI; clips 9 and 10 through the motion prompt;
  the clean-checkout rebuild of clips 7 to 10; the revised prompt and the docs; the final audit.
