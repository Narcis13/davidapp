# Brief: Code-Driven Video Studio

Run with: `/goal-loop INITIAL_PROMPT.md`

Feature: Build **a studio app for making videos with code**, where every clip it makes leaves behind
reusable building blocks for the next one.

Context. X is full of videos made with JavaScript code written by Anthropic's models (Fable, Opus 5.5,
even Sonnet 5.5). This app turns that into a product. It renders videos of up to **120 seconds**, in
**vertical (1080×1920)** and **horizontal (1920×1080)** formats (square 1080×1080 is a bonus), entirely
from code, and exports them as **MP4 through FFmpeg**. Use your full abilities and creativity. The
features below are a draft, not a ceiling: add whatever would make this app remarkable, and record each
addition under **Decisions**.

- **Composability is the core idea.** When you write the code for graphics and animation, break it into
  **parameterized JavaScript functions**. Each one takes parameters (often many) and becomes an
  **asset**. Assets call other assets, so a frame is a tree of function calls: a scene calls a
  lower-third, which calls a text animation, which calls an easing curve. Ultrathink the asset function
  contract before writing any rendering code. At minimum it should cover:
  - a **pure, deterministic function of (time, params)** that draws a frame. It uses an injected seeded
    RNG, never `Math.random()` or wall-clock time, so the same inputs always give identical frames;
  - a **declared parameter schema** (types, defaults, ranges, enums, colors, fonts, nested asset
    references). The studio builds controls from it and the AI layer validates against it;
  - a way to **compose other assets** by reference, e.g. `use("lower-third@3", {...})`, with versions
    pinned;
  - **metadata**: name, description, tags, natural duration, and author (which model or human). Also
    **lineage**: which asset it was forked or derived from, and which clip first produced it.

- **The asset library is the studio.** The app is a library of assets: **images, sounds, fonts, and
  graphics/animations written as JS functions**. Every asset has a description and can be found by
  **tags, full-text search, type, format, and lineage**. Use SQLite as the store if it makes sense
  (it probably does). Ultrathink the schema. Assets are **versioned and immutable**: editing one creates
  a new version, and a clip pins the versions it used, so an old clip always re-renders exactly as it
  was. Store the source code, a generated thumbnail or preview, and usage stats (which clips use which
  versions).

- **Clips are compositions too.** A clip is a declarative composition: format, fps, duration, a timeline
  of tracks (visual layers, text, audio), and the asset calls with their parameters. **Text and text
  animation are first-class and central to this project.** Build a strong text-animation family:
  per-character, per-word and per-line reveals, typewriter, kinetic typography, highlight and underline
  sweeps, counters, captions and subtitles that fit the safe zones of vertical formats, and so on.
  Make sure text layout is solid: wrapping, auto-fit, multiple fonts, emoji where feasible.

- **Rendering.** Ultrathink the render pipeline and choose the stack yourself, whichever you judge best
  for this kind of project. Weigh at least two options, for example headless Chrome drawing on a canvas
  and piping frames into FFmpeg, versus a Node canvas library (skia-canvas, @napi-rs/canvas) piping raw
  frames into FFmpeg's stdin. **The same asset code must drive both the live preview in the studio and
  the final render**, from one source of truth. Output is H.264 MP4 with AAC audio, yuv420p, faststart.
  Audio tracks are mixed by FFmpeg. Rendering shows progress, can be cancelled, and runs as a queue.

- **Studio UI.** A web app for browsing and searching the asset library. It includes:
  - an **asset playground**: live preview, with generated controls for the parameters, a scrub bar, and
    viewing the source;
  - a **clip editor and preview**: timeline, scrubbing, playback, and toggling safe-zone and format
    overlays;
  - a **render queue** with progress;
  - a **gallery** of exported clips, each with its poster frame and the list of assets it used;
  - an **asset lineage view** that shows the compounding: which assets came from which clip, and what
    reused them later.

- **AI layer: an MCP server.** It lets an AI client, Claude Code first of all, **create and edit clips,
  and above all edit assets**, especially the JS-function assets. Ultrathink the tool surface. At
  minimum it should cover:
  - searching and inspecting assets (including their source and schema);
  - creating an asset and creating a new version of one, with the code validated and a test frame
    rendered before it's accepted;
  - forking an asset;
  - creating or editing a clip composition;
  - **rendering a single frame to PNG**, so the AI can *see* its work and iterate;
  - starting a render and polling its status;
  - listing the assets a clip uses.

  Register it in the repo's `.mcp.json` so Claude Code can use it in this project. Asset code is code
  the AI writes and runs, so execute it isolated (a worker, a separate page or a VM context) with
  timeouts. A bad asset must not crash the server or the studio.

- **The compounding effect.** Every clip you produce should grow the library. Produce each clip
  **through the app's own pipeline (the MCP server or the app's CLI/API), not with throwaway scripts**.
  The new assets a clip needs are created as library assets first, with descriptions and tags, and the
  clip then composes them.

- **Ideas worth considering** (pick what makes it great; none are required):
  - brand or theme kits as assets (palette, fonts, motion style);
  - beat and timing markers taken from the audio, so animations can sync to them;
  - an easing and physics (spring) library;
  - SRT caption export alongside the MP4;
  - auto-generated asset thumbnails and animated previews;
  - "remix this clip" (fork a clip into a new format, e.g. horizontal to vertical, with the layout
    re-flowing);
  - templates whose parameters are content slots, e.g. "fill this with three bullet points and a title".

Done means ALL of:
- **Three showcase clips produced end to end through the app's pipeline**, each **at least 30 seconds**
  (and at most 120), rendered to MP4 with **zero errors** in the render and server logs. At least one is
  vertical 1080×1920 and at least one is horizontal 1920×1080. They are made in order:
  - **Clip 1** creates its own new assets;
  - **Clip 2** reuses **at least 3 assets created during clip 1** (as-is or as new versions or forks);
  - **Clip 3** reuses assets **from both clip 1 and clip 2**.

  The database records this reuse, the studio's lineage view shows it, and a script/query prints the
  reuse report.
- Each clip is a **valid, playable MP4**: `ffprobe` reports H.264 video and AAC audio, the expected
  resolution and fps, and a duration of at least 30 s. Each clip has a non-silent audio track, or a
  recorded Decision explaining why it is silent. Each clip's contact sheet (a grid of frames sampled by
  FFmpeg) has been looked at, frame by frame, with no blank, broken, clipped or garbled frames and no
  overflowing text.
- **Text animation is prominent**: at least 6 distinct text-animation assets exist in the library, and
  the three clips use at least 4 of them between them.
- **Composability is real**: at least one asset that is used in a clip composes at least 2 other assets,
  at least 3 levels deep (for example scene → lower-third → text reveal).
- **Versioning holds**: an asset used by clip 1 is later edited **through the MCP server** into a new
  version. After that edit, clip 1 still re-renders to the same frames, and a clip that pins the new
  version shows the change. Check this by hashing sampled frames.
- **Rendering is deterministic**: rendering the same clip twice gives identical frame hashes at sampled
  timestamps.
- **The MCP server works end to end**: a scripted MCP client test (or Claude Code itself, via
  `.mcp.json`) searches assets, creates an asset, edits it into a new version, renders a frame to PNG,
  and starts a render that completes. A deliberately broken asset is rejected with a useful error and
  doesn't crash anything.
- **The studio UI works** with zero console or network errors on every screen, at desktop (1440×900)
  and phone (390×844) sizes: library search and filter, the asset playground (changing a parameter
  updates the preview), clip preview with scrubbing, the render queue showing a live render, the
  gallery playing a finished clip, and the lineage view. **At least the asset-playground workflow and
  starting a render from the UI are driven in a real browser** (the desktop app's built-in browser or
  Claude in Chrome) and recorded as a GIF, or as a sequence of screenshots if GIF capture isn't
  available.
- **Render speed is measured**: the time to render a 30-second 1080p clip on this machine is recorded,
  with how it was measured. Target: under 5 minutes. If it's slower, record why and what would fix it.
- Tests cover the asset contract (schema validation, determinism, composition and version pinning), the
  composition-to-frames pipeline, the DB layer, and the MCP tools.
- `README.md` explains how to run the studio, how to write an asset, how to use the MCP server from
  Claude Code, and how to make a clip, with the three showcase clips linked.

Constraints:
- **Machine:** Windows 11. Node 24 and npm 11 are installed. Google Chrome is at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`. **FFmpeg 9.0.2** is installed via winget at
  `C:\Users\User1\AppData\Local\Microsoft\WinGet\Links\` (`ffmpeg`, `ffprobe`, `ffplay`). If it isn't on
  PATH in your shell, add that folder, or make the app take an `FFMPEG_PATH` setting. Shells are Git Bash
  and PowerShell, and scripts must work on Windows. The skill's macOS Swift helpers are unavailable, so
  build contact sheets with FFmpeg's `tile` filter instead.
- **Browser feedback:** use headless Chrome (`cdp.mjs` / `sweep.sh`) for sweeps and evidence. Use the
  desktop app's **built-in browser** (`mcp__Claude_Browser__*`) or **Claude in Chrome**, whichever is
  connected, for interactive workflows (scrubbing, parameter tweaking, render queue). Always point them
  at your own isolated server.
- **This is an unattended session:** don't stop to ask. The **app must not require an Anthropic API key**
  for anything in Done. The AI layer is the MCP server that Claude Code drives. An optional in-app
  "ask Claude" feature that needs a key may exist, but it must degrade gracefully without one, and it
  isn't part of Done.
- **Assets must be original or properly licensed.** Graphics and animations are written by you. Audio
  is generated procedurally (synthesized in code or with FFmpeg's audio sources) or is CC0. Fonts are
  open-licensed (e.g. OFL via `@fontsource` packages), with their licenses kept in the repo. No
  copyrighted media, and no downloads from untrusted sources.
- **Repo hygiene:** don't commit the SQLite database, render scratch or caches. Make the showcase
  library reproducible from the repo with a seed/export of the assets and the clip compositions.
  Commit the three showcase MP4s under `docs/showcase/` only if each is under 50 MB. Otherwise commit
  their contact sheets, ffprobe reports and a short preview, and record the full files' local path.
- Commit and push to `origin main` after each milestone (https://github.com/Narcis13/davidapp). The
  existing `goal-loop/` folder at the root and `.claude/skills/goal-loop/` aren't part of the app; leave
  them alone.
