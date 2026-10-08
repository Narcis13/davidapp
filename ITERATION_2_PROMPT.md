# Brief: Fablecut, iteration 2: a studio you direct, a library that compounds

Run with: `/goal-loop ITERATION_2_PROMPT.md`

Context. Iteration 1 is done (brief: `INITIAL_PROMPT.md`, record: the current `PROGRESS.md`; archive it to
`docs/progress/` before starting). Fablecut works: function assets, a versioned SQLite library, pinned
clips, one runtime for preview and render, an MCP server with 25 tools, a studio with seven screens and
three showcase clips. This iteration makes it a tool you can **direct**: you ask the agent for an asset
from inside the studio, tweak what comes back by hand, lay it out freely in any format, and every clip
leaves the library richer, so the next clip takes less time and looks better than the last. Use your
full abilities. The features below are a draft, not a ceiling. Where something fits the ecosystem
naturally, add it and record it under **Decisions**.

Feature:

- **Ask the agent from inside the studio.** Ultrathink this. From the playground, the clip editor and
  the library, I can write a request such as "a neon lower third with a scanline wipe", "make this one
  slower and add a glow" or "add a stat scene at 0:12". A request is scoped to an asset, a clip, a
  selection of layers or nothing. **No Anthropic API key.** The agent is Claude Code over the MCP server:
  - Requests go into a **queue in the database**. New MCP tools let the agent list, claim, read (with
    the scope's source, schema and rendered frames), reply to and complete them. The results (a draft,
    a new asset, a clip edit) are linked to the request.
  - Agent output lands as a **proposal**, not a silent change. In the studio I see it **live, without
    reloading**, and compare it side by side with the current version (same frame, same params). Then I
    accept it (it becomes a version), reject it, or reply with more feedback, which keeps the thread
    going.
  - **Live updates.** The studio refreshes whenever the library, a clip or a request changes, including
    changes made through MCP outside any request (server-sent events or similar, driven by the database
    so the MCP process and the web server stay in sync).
  - **Run now** (optional path). When the `claude` CLI is on PATH, a button runs a headless Claude Code
    session (`claude -p` with this repo's `.mcp.json`) on the request. Its tools are limited to the studio
    MCP server, it has a timeout and a cancel button, and it streams progress into the thread. Without
    the CLI the button is hidden and the inbox flow still works. Tests use a stub `claude` binary.
  - Ultrathink the request lifecycle, how proposals differ from drafts and versions, and what happens
    when I and the agent edit the same asset at once.

- **Tweak and keep.** In the playground, after changing parameters, I can:
  - **save them as a new version** (the new defaults), or **save them as a preset**. A preset is a named
    asset plus a parameter set, with its own thumbnail. It is searchable and usable in clips like any
    asset, it pins its base version and it shows in lineage;
  - edit an asset's title, description and tags without making a new code version;
  - see a **diff between versions** (source and a frame side by side);
  - write code in a real editor: syntax highlighting, line numbers, the validation error marked on its
    line, and ⌘S to validate.

- **Free layout per format.** Ultrathink the model. Every visual item gets a **transform**:
  - position, scale, rotation, anchor/pivot and opacity, plus blend mode if it is cheap in both canvases.
    Position and size are relative to the clip's frame or safe zone, so they mean the same thing in
    vertical, horizontal and square;
  - **per-format overrides**, so one composition holds a layout for each of the three formats. Remix and
    the editor's format switch use them, and the editor shows which format I am laying out;
  - **keyframes** on transform properties, and on numeric and colour params where that makes sense, with
    easing taken from the `easing` asset family;
  - **direct manipulation on the preview**: click a layer to select it, drag to move, handles to scale
    and rotate, Shift to constrain. Snapping to centre, the safe zone and other layers' edges, with
    visible guides. The inspector's numeric fields stay in sync.

  The runtime applies all of this the same way in preview and render. Existing clips, which have no
  transforms, must render **exactly** as before.

- **Layers you can drag.** In the timeline I can drag tracks up and down to change what draws in front
  (for example a title behind or in front of a 3D object), and drag an item to another track. There is a
  layers view that makes the stacking obvious. The editor also gets:
  - undo and redo for every edit;
  - multi-select, copy, paste and duplicate;
  - split at the playhead;
  - snapping to the playhead, beats and other items' edges;
  - lock, hide, solo and mute for tracks, plus rename, add and delete;
  - waveforms on audio items;
  - a keyboard shortcut sheet.

- **New kinds of assets.** Ultrathink the set and the contract for each. They are all JS functions,
  stored, versioned, pinned and traced the same way as today, with a kind that tells the studio and the
  runtime how to apply them. Candidates (ship at least the first four, choose the rest on merit):
  - `motion`: enter, exit, emphasis and loop behaviours that drive an item's transform and opacity
    (pop, slide, drift, wiggle, bounce, orbit, parallax). They attach to any visual item from the
    inspector, can stack, and have params;
  - `transition`: between two items or scenes (wipe, push, zoom, mask reveal, glitch, light leak);
  - `effect`: per-layer or clip-wide pixel passes (glow, blur, grain, chromatic aberration, vignette,
    colour grade, duotone, displacement). They must be deterministic and look the same in Skia (Node)
    and the browser;
  - **groups and precomps**: select several layers, then "save as asset". The result is a composition
    asset with exposed params, the strongest lever for compounding (an intro or a stat scene becomes one
    reusable piece);
  - masks and mattes, path and shape assets (draw-on, morph, follow-path), and clip templates with
    content slots that instantiate in any format.

- **Procedural 3D.** Ultrathink this. 3D assets are function assets like the rest, with procedural
  geometry (low-poly terrain, icospheres, lathe and extrude, extruded text, instanced particles), a
  camera and lighting. Hard requirements:
  - deterministic frame hashes;
  - the same picture in the preview and the Node render;
  - no GPU or WebGL dependency on the render path.

  Weigh at least two approaches, for example a small software 3D library in `f.lib` (projection,
  z-buffer, Lambert or toon shading) against three.js on a headless or software path. My idea, to
  evaluate: render a 3D asset as its own composition **with transparency**, bake it into a reusable
  **alpha frame-sequence asset** (cached by asset version and params), and use it as a layer alongside
  2D assets. Baking any expensive asset this way may be worth generalising.

- **Images and SVGs as assets.**
  - **Uploads**: drag-and-drop or a file picker in the studio, several files at once, for PNG, JPG, WebP
    and SVG. Duplicates are found by content hash. Dimensions and a dominant palette are extracted, and a
    thumbnail is made.
  - **SVG safety**: SVGs are **sanitised**. Scripts, event handlers, external references and
    `foreignObject` are stripped or rejected.
  - **Descriptions by the agent**: a new upload lands in a "needs description" queue. Over MCP the
    agent sees the image (an MCP image result) and writes its title, description, tags and suggested
    uses. The studio shows them live.
  - **Use in clips**: images are layers with full transforms, and work as params of function assets
    (Ken Burns, framed photo, logo reveal, an SVG drawn on with recolour params).

- **A library built for thousands of assets.** Polished. The library should hold up at thousands of
  assets:
  - server-side ranked search;
  - faceted filters with counts (type, kind, tag, format, author, origin clip, used by, needs
    description);
  - sorting (relevance, newest, most used, name);
  - a virtualised grid or list with a bounded number of DOM nodes, and a density toggle;
  - **animated hover previews** (filmstrips generated on save);
  - a detail panel that opens without leaving the list;
  - keyboard navigation, multi-select and bulk actions (tag, add to a collection, add to the open clip);
  - favourites, collections and recently used;
  - filters kept in the URL;
  - an upload drop zone.

  The editor's asset picker uses the same search.

- **A stronger compounding loop.** Ultrathink what makes clip N+1 faster and better than clip N, then
  build it. Some directions:
  - presets, precomps and templates;
  - a clip-level theme or brand kit that assets read by default, so new pieces look consistent;
  - a richer `studio_guide` cookbook for agents;
  - a `suggest_assets(brief)` MCP tool that returns ranked candidates with preview frames;
  - quality signals (usage, favourites, featured);
  - notes agents leave on assets for the next agent;
  - generated usage examples per asset.

  **Measure it.** Per clip, count MCP calls, new lines of asset code, the share of items that use assets
  that already existed, and wall-clock build time. Extend the reuse report with these numbers.

Done means ALL of:

- **Nothing old breaks.** Before changing any code, record the sampled frame hashes of the three existing
  showcase clips on **this** machine. Emoji pixels depend on the OS, so the Windows hashes from
  iteration 1 don't count. After the iteration, `npm run showcase` rebuilds all three from an empty data
  dir and their hashes are **identical**. Compositions saved in the old shape still load, edit and
  render.
- **Ask the agent, end to end.** In a real browser (Claude in Chrome) and recorded as a GIF:
  1. I create a request on an asset in the playground.
  2. Claude Code works it through MCP.
  3. The proposal appears live with no reload, and I compare it with the current version.
  4. I accept it and it becomes a new version.

  A second request, scoped to a clip ("add a lower third at 0:03"), proposes a clip edit that I accept.
  "Run now" completes one real request through the `claude` CLI (evidence: the request thread and the
  resulting version). Without the CLI on PATH the studio hides the button, and that is tested.
- **Tweak and keep, through the UI and MCP.** Params changed and saved as a new version; params saved as
  a preset, then used in a clip; metadata edited without a new code version; a version diff shown. Tests
  cover presets, metadata edits and pinning.
- **Transforms and formats.**
  - An item positioned, scaled, rotated and keyframed renders the same in the preview and in Node (a
    pixel-diff threshold, with the diff image as evidence).
  - One composition with per-format overrides renders correctly in all three formats.
  - On-canvas move, scale and rotate with snapping are driven in Chrome and recorded as a GIF.
- **Layers.**
  - Dragging a track or an item to another layer changes the rendered z-order. A title goes from in
    front of a shape to behind it, which is checked in the rendered frame.
  - Undo restores the previous state and redo reapplies it.
  - The drag is recorded as a GIF in Chrome.
  - Tests cover the composition operations.
- **New asset kinds.** At least 4 `motion`, 3 `transition` and 4 `effect` assets, at least one precomp
  made from layers in the editor, and masks or mattes. Each kind has contract tests (validation,
  determinism, preview/render parity), and every kind appears in the showcase.
- **3D.**
  - At least 3 procedural 3D assets.
  - Two renders give identical frame hashes, and the preview matches the render.
  - A 3D piece is used in a clip with 2D text both behind it and in front of it. If baked alpha sequences
    are built, a baked sequence is reused in a second clip.
- **Uploads.**
  - PNG, JPG and SVG uploaded by drag-and-drop in Chrome (GIF).
  - A hostile SVG (script, `onload`, an external `href`, `foreignObject`) is sanitised or rejected, and
    tested.
  - The agent describes and tags every uploaded image through MCP, and those images are then found by
    those tags in library search.
  - Test images are made by you (drawn SVGs, rendered frames), never downloaded.
- **Library at scale.** A script builds a synthetic library of **5,000 assets** in a scratch data dir.
  On it:
  - search API p95 latency under 100 ms, measured;
  - the library screen shows results within 1.5 s;
  - scrolling to the end keeps the DOM node count bounded (measured);
  - facet counts are correct (tested);
  - keyboard navigation and bulk tagging work;
  - clean at 1440×900 and 390×844.
- **Compounding showcase.** Three new clips, **4, 5 and 6**, of **30 s, 60 s and 90 s**, built in that
  order through the MCP server and the studio's request flow. They showcase and test the new features,
  and they prove the idea at the centre of Fablecut: the library compounds, so a later clip reuses what
  earlier clips made and takes less time to compose, even when it is longer.
  - Clips 4 and 5 between them use **every** new feature: transforms and keyframes, per-format layouts,
    dragged layer order, motion, transitions, effects, a precomp, a preset, 3D, an uploaded image and an
    uploaded SVG.
  - **Clip 6 (90 s) is the proof.** It is built mostly from assets, presets and precomps that clips 4
    and 5 created, and it reuses at least one asset from each of them (plus assets from clips 1 and 2).
    Nothing is authored for it in advance: its build starts only after clip 5 is rendered, with the same
    process as clips 4 and 5. Compared with clip 4 and with clip 5, it needs:
    - **less wall-clock build time** in absolute terms, although it is 1.5 to 3 times longer;
    - fewer MCP calls;
    - less new asset code;
    - a higher share of items that use assets which already existed.

    Build time is measured the same way for all three (from the first MCP call or studio request of the
    clip to the render request, excluding the render), and the method is recorded. If clip 6 does not
    come out clearly cheaper, find out why, improve the compounding loop (presets, precomps, templates,
    `suggest_assets`, the cookbook) and rebuild it. Do not tune the numbers.
  - At least one of the three is rendered in **all three formats** from one composition.
  - All are valid MP4s (`ffprobe`: H.264, AAC, yuv420p, faststart, expected size and fps, and durations
    of 30, 60 and 90 s within one frame) with non-silent audio and zero errors in the render and server
    logs.
  - Their contact sheets are read frame by frame (nothing blank, clipped, garbled or overflowing).
  - The extended reuse report has a compounding table for clips 1 to 6 (MCP calls, new lines of asset
    code, reuse share, build time, and build time per second of output), with a short note on what made
    clip 6 cheaper. Clip 6 also needs clearly less new asset code than any of clips 1 to 3.
- **MCP.** Every new capability has an MCP tool (requests, proposals, presets, metadata, transforms and
  layers, uploads and descriptions, `suggest_assets`, baking), covered by the stdio client test. A broken
  asset of each new kind is rejected with a useful error and crashes nothing.
- **Speed.** Render speed for a 30 s 1080p clip is measured again on this machine with the method
  recorded. The 2D showcase clips are no more than 10% slower than the baseline taken at the start. 3D
  and effects costs are reported separately.
- **Docs.** `README.md`, `docs/ASSET_CONTRACT.md` (transforms, keyframes and every new kind) and
  `studio_guide` describe the new features, with clips 4, 5 and 6 linked.

Constraints:

- **Machine:** macOS 15.5, Intel Core i5-10600 (6 cores, 12 threads). Node 24.21, npm 11.19, FFmpeg 8.1
  at `/usr/local/bin`, Google Chrome at `/Applications/Google Chrome.app`, Claude Code CLI 2.1.291 on
  PATH. `.claude/goal-loop/project.md` was written for Windows in iteration 1. **Update it first**
  (TMPDIR, CHROME, the Swift helpers that are now available, the emoji font, serve commands), commit it
  on its own, and fix it whenever you learn otherwise.
- **The user's studio** runs on port **8787** with data in `./data`. Never touch either. Use your own
  port and a scratch data dir for everything.
- **Browser feedback:** headless (`cdp.mjs`, `sweep.sh`) for sweeps and evidence. Claude in Chrome for
  the drag-and-drop, on-canvas, upload and ask-the-agent workflows, recorded as GIFs.
- **No Anthropic API key**, for anything in Done. Real headless `claude -p` runs are allowed for
  verifying "Run now" (they use my existing Claude Code login). Keep them to 10 at most, with the tools
  limited to the studio MCP server and a timeout on each.
- **Unchanged from iteration 1:**
  - determinism (seeded RNG, no clock or `Math.random`);
  - isolation with timeouts (a bad asset of any kind must not crash the server, the studio or a render);
  - versions are immutable and clips pin them;
  - no build step for the studio.
- **Dependencies:** each new dependency (a code editor, a 3D library) needs a reason under **Decisions**.
  It must be license-compatible and served locally. No CDNs at runtime.
- **Licensing:** assets are original or properly licensed. Audio is procedural or CC0. Fonts are
  open-licensed, with their licenses in the repo.
- **Repo hygiene:**
  - no database, renders, caches or scratch files in git;
  - the showcase is reproducible from the repo (`assets/`, `clips/`, `showcase/plan.mjs`), including the
    uploaded test images and the agent's descriptions for them;
  - MP4s go on a new GitHub release `showcase-v2` (authorised), never in git;
  - evidence goes in `docs/showcase/v2/` with an `INDEX.md` that maps each contract item to its files.
- **Commits:** commit and push to `origin main` after each milestone (https://github.com/Narcis13/davidapp).
  Leave `goal-loop/` and `.claude/skills/goal-loop/` alone.
- **Suggested order** (re-plan freely): hash baseline and `project.md`; composition schema v2
  (transforms, overrides, keyframes, layer operations, with migration) in the runtime with tests; live
  updates and the request queue; new asset kinds and 3D; uploads; the library overhaul; the editor UI;
  the playground UI; clips 4, 5 and 6; final audit.
