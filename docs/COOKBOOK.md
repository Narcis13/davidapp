# Cookbook: building clips that compound

Recipes for the MCP tools. The asset contract (kinds, the layout model, `f.lib`) is in `ASSET_CONTRACT.md`.

## Start from what exists

1. `suggest_assets { brief }` with a sentence about the clip or scene. It returns ranked candidates,
   a few per kind, with their params, notes from other agents and a numbered contact sheet.
   Featured, favourite and often-used pieces rank higher.
2. `search_assets { query, kind, tags, derivation: 'preset' | 'precomp', sort, facets: true }` to dig further.
3. `get_asset` shows `examples` (how earlier clips used it: params, transform, motions) and `notes`. Copy params from an example.
4. Write new code only for what is missing. Leave a note (`add_asset_note`) on anything you learn,
   and mark what the next clip should start from with `organize_assets { names, featured: true }`.

## The cheapest new assets

- `create_preset { base, name, params }`: a named asset that is the base plus those params as defaults. It pins the base version and gets its own thumbnail.
- `save_precomp { clip, items, name, expose: [{ item, param, name }], replace: true }`: several layers of a clip become one visual asset with the params you expose. An intro, a stat scene or a lower-third block becomes one piece for the next clip. Transitions between the layers are kept. In the studio it is "Save as asset" in the clip editor.
- `save_defaults { name, params }`: a new version with these params as defaults (only the `default:` values in the source change).
- `set_asset_metadata { name, title, description, tags }`: better words for search, without a new version. `diff_versions { name, a, b }` shows what changed between two versions, source and frame.

## Layout and layers

Edit a clip with `edit_clip { clip, operations }` instead of resending the composition:

- `set_transform { id, transform, format? }` (merges; with `format` it edits that format's override), `set_override { id, format, override }`.
- `add_keyframe { id, prop, t, v, ease? }`, `remove_keyframe { id, prop, t }`, `set_keyframes { id, prop, keyframes }`.
- `move_track { id, index }` (draw order: the last track is in front), `move_item { id, track, index? }`, `update_track { id, patch: { name, hidden, locked, solo, muted } }`.
- `split_item { id, at }` (the second part is a continuation: same random seed through `seedId`, no transition, motions and effects carry on), `duplicate_item { id, newId?, start?, track? }`.
- `update_item { id, patch }` for everything else on an item: `motions`, `effects`, `transition`, `mask`, `params` (merged; `null` removes one).

Lay out once in fractions (`transform`), then fix what does not fit another format with
`formats.<name>`; `start_render { clip, format }` renders the same composition in that format.
Images, baked sequences and footage are layers too: `{ asset: 'photo', params: { fit: 'cover' } }`,
`{ asset: 'studio-library-search', params: { fit: 'contain', in: 2, out: 9.5, speed: 1.5 } }`.
`render_clip_frame { clip, t, isolate: { only: [ids] } }` (or `except`) draws some items alone; `frame_hashes` takes the same.

## Motion, transitions, effects, masks

```js
{ id: 'orb', asset: 'orb-3d', start: 7, duration: 8, transform: { x: 0.5, y: 0.5, width: 0.56, height: 1 },
  motions: [{ asset: 'motion-pop', phase: 'out', duration: 0.5 }],
  transition: { asset: 'trans-iris', duration: 0.9 },             // duration is optional: the asset's own, else 0.5 s
  effects: [{ asset: 'fx-glow', params: { strength: 0.7 } }],
  mask: { asset: 'mask-iris', mode: 'alpha', params: { open: 1.1 } } }
```

Effects also go on a track (`track.effects`, everything on it) or on the composition (`effects`,
the whole frame): a clip-wide `fx-grain` at a low amount, a `fx-vignette` on the background track.
Those two, and `composition.theme`, have no edit operation: set them with `update_clip`.
Search before writing one: `search_assets { kind: 'motion' | 'transition' | 'effect' }`.

## 3D and baking

Write 3D with `f.lib.solid` (see the contract). It is heavy at 1080p, so bake it once:
`bake_sequence { ref, name, params, format | width + height, fps, duration }` renders any visual
asset into a `sequence` asset (PNG frames with alpha, at most 60 s), cached by version, params,
size, fps and duration. Use the sequence as a layer (`params.fit`, `params.loop`) in this clip and
the next. `bake_asset` is the one-frame version (an image), or a WAV from an audio asset.

## Uploads

Uploaded images (`upload_image { path | data_base64, name }`, or drag and drop in the studio) wait
on `list_undescribed`, which shows each picture. Describe every one with
`describe_asset { name, title, description, tags, uses }`; search then finds it by those tags. Use
them as layers, or as `image` params (`f.image(p.photo)`). An uploaded SVG also has a vector
drawing: `f.svg(p.logo).draw(f.ctx, { width, height, progress, fill, stroke })` draws it on and
recolours it (the `svg-draw-on` asset does this).

Video files go in with `add_footage`, font files with `add_font`, images and sounds made elsewhere with
`add_file_asset`. Say where every file came from (`license`, `creator`, `source_url`, `credit`): what you leave out
is recorded as unknown, and a final render refuses a file with no licence.

## Requests from the studio

The user asks from the studio; you answer with a proposal they compare and accept.
`list_requests`, then `claim_request { id }` (it returns the thread, the scope and frames; with
`wait_seconds` it waits for one to arrive), then one of `propose_asset_version`,
`propose_new_asset` or `propose_clip_edit { request, operations, summary }` with a one-sentence
summary. Nothing changes until the user accepts. Use `reply_request` for a question and
`complete_request` when nothing should change. A reply or a rejection with a reason reopens the
request: claim it again and propose again.

## Theme

`composition.theme: 'theme-ember'` (a value asset) is read by every asset as `f.theme`. Write new
assets to default to it (`f.theme?.accent ?? p.color`), and a whole clip changes brand with one line.

## A voice, its words, captions

1. The studio can make the take and its word times itself: see "Narrate a clip from a script" below. Otherwise get
   the take (a voice service, a local model, a recording) and its word times (the service's word list or
   character alignment, or whisper.cpp: `whisper-cli -m ggml-small.en.bin -f take-16k.wav -ojf`). Then
   `add_narration { name, path, script, timings | timings_path, transcripts: [two transcripts], voice: { name, license } }`.
   It aligns the timings to the script (word *i* is the script's word *i*), and the transcript check names slips,
   drops and insertions after normalising case, punctuation and numerals; with two independent transcripts a word
   is wrong only when both say so. `check_transcript` runs the same check alone.
2. Put it on an audio track with `role: 'narration'`. Every asset now reads `f.clip.words` in clip time.
3. Pin visuals to words with `anchor: { item, word, offset }` on an item, a keyframe or a marker; `anchor_report`
   shows how far each is from its word. A new take: `add_narration` with the same name, then
   `repin_clip { only: ['<narration>'] }`: everything anchored follows.
4. Captions: `composition.captions: {}` and a `text-captions@2` item on a track with `role: 'captions'`.
   `caption_pages` shows the pages and any rule they break; `edit_clip` with `caption_split { at }`,
   `caption_merge { page }`, `caption_break { page, at }`, `caption_move { page, at }`, `caption_auto` changes the
   structure (times stay the words'). `burnIn: false` keeps them in the SRT/VTT files only.

## The mix

- Gain automation: `keyframes: { volume: [{ t, v (dB), ease }] }` on an audio item. Ducking under the voice:
  `duck: { by: 18, attack: 0.15, release: 0.45, source: 'words' }` on the music.
- `loudness: { target: -14, truePeak: -1 }` on the clip: the render reaches it with one gain, limits the peaks
  first only when it must, measures the encoded file (FFmpeg ebur128) and corrects it once more if AAC moved it.
- `audio_report` before rendering: the master stage, loudness, the music's distance under the voice (LU) where it
  speaks, silences, clipping. `export_stems { groups: { voice: ['voice'], music: ['music'] } }` for WAV stems.

## Checks before and after a render

- `check_clip` (a clip, a range, a draft, or the clip in another format): every issue with its item, time,
  numbers and a still. Fix them before rendering: text on a solid plate passes contrast, the safe zone is
  `title-safe ∩ f.safe ∩ the platform zone`, the caption lane is for captions only, and the end holds still
  for 2 s. `layout_report` and `render_clip_frame { overlays: true }` show the measured boxes and the zones.
- `platforms: ['youtube', 'shorts']` applies YouTube's zones to the horizontal render and Shorts' to the
  vertical one; `safe: 'platform'` makes `f.safe` follow them.
- After `start_render`, `render_report { id, sheets: true }`: the MP4's facts, loudness, black frames, freezes
  (mark intended stills with a `hold` marker), brightness jumps (fine on a `cut` marker), flashes, silences,
  where the narration sits, and frame sheets from the encoded file. The studio shows the same per render.
- Markers have types: `cut`, `hold`, `beat`, `word`, `note` (`edit_clip` `add_marker`, `update_marker`, `remove_marker`).

## A screen recording in a browser frame, with a cursor and a spotlight

The recording comes from `scripts/record-studio.mjs` (an MP4 and a sidecar `<file>.mp4.json` with the cursor path,
the clicks and the boxes of the elements it touched, all in the video's pixels). Add it, and look at its frames:

```json
{ "path": "/path/to/repo/showcase/footage/library-search.mp4", "name": "studio-library-search",
  "description": "Screen recording of the studio's library: a search, a kind filter, an asset opened. 1440x900, 13.5 s.",
  "license": "original", "creator": "Fablecut", "tags": ["footage", "screen-recording", "studio"] }
```

That is `add_footage`; then `footage_frames { "ref": "studio-library-search", "count": 12 }`.

Put it in `kit-ui-frame@2` as `content` (the frame shows the recording from its start, at the item's own time).
The cursor and the spotlight must sit on the frame's **viewport**, not on its box: their points are the
recording's pixels, mapped into their own box. With `scale` set, the viewport is the recording × `scale`, centred
across the box; the window (the viewport plus the chrome, two bars of `round(2.1 × size% × short side)` px each)
is centred down it. In a 1920 × 1080 clip, with no transform (the box is the frame), `scale: 0.8` and the default
`size` 2.6: bars of 59 px, a viewport of 1152 × 720 at (384, 239), which is the transform
`{ "x": 0.5, "y": 0.55463, "width": 0.6, "height": 0.66667 }`. Then `edit_clip`:

```json
{ "clip": "studio-tour", "operations": [
  { "op": "add_track", "track": { "id": "shots", "type": "visual", "name": "Shots" } },
  { "op": "add_track", "track": { "id": "spots", "type": "visual", "name": "Spotlight" } },
  { "op": "add_track", "track": { "id": "pointer", "type": "visual", "name": "Cursor" } },
  { "op": "add_item", "track": "shots", "item": { "id": "browser", "asset": "kit-ui-frame@2", "start": 0, "duration": 10,
    "params": { "device": "browser", "content": "studio-library-search", "scale": 0.8, "url": "fablecut.studio/library", "title": "Library" } } },
  { "op": "add_item", "track": "spots", "item": { "id": "spot", "asset": "kit-spotlight", "start": 0, "duration": 10,
    "transform": { "x": 0.5, "y": 0.55463, "width": 0.6, "height": 0.66667 },
    "params": { "at": 0, "padding": 10, "regions": [
      { "t": 1.0, "x": 61, "y": 117, "width": 1102, "height": 30 },
      { "t": 3.4, "x": 24, "y": 524, "width": 228, "height": 30 }] } } },
  { "op": "add_item", "track": "pointer", "item": { "id": "cursor", "asset": "kit-cursor", "start": 0, "duration": 10,
    "transform": { "x": 0.5, "y": 0.55463, "width": 0.6, "height": 0.66667 },
    "params": { "at": 0, "clicks": [{ "t": 1.496 }, { "t": 4.027 }], "path": [
      { "t": 0, "x": 720, "y": 450 }, { "t": 0.966, "x": 720, "y": 450 }, { "t": 1.364, "x": 612, "y": 132 },
      { "t": 1.495, "x": 612, "y": 132, "down": true }, { "t": 1.588, "x": 612, "y": 132 }, { "t": 3.356, "x": 612, "y": 132 },
      { "t": 4.026, "x": 138, "y": 539, "down": true }, { "t": 4.121, "x": 138, "y": 539 }] } } }
] }
```

`path` and `clicks` are the sidecar's `cursor` and `clicks` (paste the whole `cursor` array; a click needs only its
`t`); the regions are its `boxes`, with the recording time each should light up. Look with
`render_clip_frame { "clip": "studio-tour", "t": 1.6 }`: the pointer's tip sits on the search field.
`isolate: { "only": ["browser", "cursor"] }` shows the two without the spotlight. Without a frame (the recording
straight on a track, as in clip 9), give the overlays the footage item's own transform and `fit`, and put the
same `kit-camera` motion on all of them so they zoom together.

## Narrate a clip from a script

`speech_status {}` says what is set up and, for each missing piece, what to set. Hear a line in a few voices with
`voice_samples { "line": "Every clip leaves pieces the next one can use.", "count": 3 }` (it returns the WAV paths
and the voice ids), then make the narration in one call:

```json
{ "script": "Every clip leaves pieces behind. The next one starts from them, so it costs less.",
  "voice": "af_heart", "name": "tour-voice", "for_clip": "studio-tour" }
```

That is `generate_narration`: it speaks the script, transcribes the take, aligns the words to the script and
checks the transcript (`transcript` in the result names any slip). For a recording you made, use
`add_narration { name, path, script, align: true, license: "original" }`; `check_transcript { "narration":
"tour-voice", "transcribe": true }` checks a take again. Then place it, pin a visual to a word (word 4 is
"behind", counting from 0), turn on captions, and duck the music (the item `bed`) under it:

```json
{ "clip": "studio-tour", "operations": [
  { "op": "add_track", "track": { "id": "voice", "type": "audio", "name": "Voice", "role": "narration" } },
  { "op": "add_item", "track": "voice", "item": { "id": "vo", "asset": "tour-voice", "start": 0.5, "duration": 5.2 } },
  { "op": "update_item", "id": "spot", "patch": { "anchor": { "item": "vo", "word": 4, "offset": -0.1 } } },
  { "op": "set", "captions": { "burnIn": true } },
  { "op": "add_track", "track": { "id": "caps", "type": "text", "name": "Captions", "role": "captions" } },
  { "op": "add_item", "track": "caps", "item": { "id": "cap", "asset": "text-captions@2", "start": 0, "duration": 10 } },
  { "op": "update_item", "id": "bed", "patch": { "duck": { "by": 18, "attack": 0.15, "release": 0.45, "source": "words" } } }
] }
```

The item's `duration` is at most the narration's (`duration` in the `generate_narration` result). `anchor_report`
shows each anchor's distance from its word; `caption_pages { "clip": "studio-tour" }` shows the pages and the rules
they break. A new take is `generate_narration` with the same name, then `repin_clip { "clip": "studio-tour",
"only": ["tour-voice"] }`: the anchored items follow their words.

## Render: a draft first, then every shape in one request

```json
{ "clip": "launch-teaser", "draft": true, "wait_seconds": 300 }
```

A draft draws the frames at full size, so its sampled frame hashes equal the full render's, then scales them to
2/3, 1/2 or 1/3 (the largest that gives whole, even sizes: 1920 × 1080 becomes 1280 × 720, 1080 × 1080 becomes
720 × 720) and encodes fast to `...-draft.mp4`. `draft: { "scale": 0.5 }` picks the scale. When it looks right:

```json
{ "clip": "launch-teaser", "formats": ["square", "vertical"], "poster_at": 3.2, "wait_seconds": 900 }
```

Both are `start_render`. `formats` (one to three shapes, instead of `format`) queues one render per shape with the
same options and returns `{ batch, renders }`; each item's overrides for that format apply. `workers` (1 to 16)
sets the threads that draw frames; the pixels do not depend on it. `poster_at` is the poster frame's time
(default 40 % of the clip).

## A final render and its credits

```json
{ "clip": "launch-teaser" }
```

`check_provenance` lists what would stop a final render: a placeholder, or a file with no licence, each with the
call that fixes it. For an upload whose licence you know:

```json
{ "name": "skyline", "provenance": { "license": "CC-BY-4.0", "creator": "Jane Doe",
  "sourceUrl": "https://example.com/skyline", "credit": "Photo: Jane Doe" } }
```

That is `set_asset_metadata` (no new version). Then `start_render`:

```json
{ "clip": "launch-teaser", "formats": ["square", "vertical"], "final": true, "wait_seconds": 900 }
```

Each render writes `<render>.credits.md` next to its MP4 (`stats.files.credits` in `get_render`, a path in the data
directory). `clip_credits { "clip": "launch-teaser", "format": "markdown" }` gives the same text without
rendering: footage, images, sound and music, voice and fonts, with AI-generated and content-ID material listed
apart. `final` cannot be combined with `draft`.

## A clip to the repo and back

`export_clip { "clip": "launch-teaser", "dry_run": true }` says what an export would write; then
`export_clip { "clip": "launch-teaser" }` writes `clips/launch-teaser/clip.json` (the composition, the closure, the
files, the hashes of up to 48 frames) and adds what `library/` lacks: `library/versions/`, `library/sources/`,
`library/files/<sha256>`. Exporting an unchanged clip changes no file; nothing is ever deleted from the store.
Files that may not be redistributed (an unknown licence counts) and files over 50 MB are listed in `clip.json` by
SHA-256 and stay out of git.

Into an empty library, from a shell (`STUDIO_DATA` is required, so `./data` is never touched by accident):

```bash
STUDIO_DATA=/tmp/empty-library node scripts/library.mjs import clips/launch-teaser --verify --files /path/to/kept-out
```

or `import_clip` on a server whose data directory is the new library:

```json
{ "folder": "/path/to/repo/clips/launch-teaser", "verify": true, "files": ["/path/to/kept-out"] }
```

Every version comes back with its number (a clip that pins `foo@3` gets `foo@3`), so the refs and the frames are
the same. A file it cannot find is named with its licence and source; look for it by SHA-256 in the `files`
folders. `verify` compares the frames with the export's: do it on the machine that exported (emoji and some
fonts draw per operating system). `scripts/roundtrip.mjs` does the whole trip for several clips.

## A font of your own

```json
{ "path": "/path/to/AcmeSans-Bold.woff2", "name": "acme-sans-bold", "license": "OFL-1.1",
  "license_file": "/path/to/OFL.txt", "source": "https://example.com/acme-sans" }
```

That is `add_font` (TTF, OTF or WOFF2). It reads the family, weight and style from the file and reports its
coverage (`latinExtendedA`, the Unicode blocks); it works at once, with no restart. Add each weight as its own
asset with the same family (`acme-sans`, `acme-sans-bold`). Use it by family in a `font` param:

```json
{ "clip": "launch-teaser", "operations": [
  { "op": "update_item", "id": "title", "patch": { "params": { "font": "Acme Sans", "weight": 700 } } }
] }
```

The save pins the family's font assets in `composition.fonts` (`{ "Acme Sans": ["acme-sans-bold@1"] }`); a new
version of the font changes the clip only after `repin_clip { "clip": "launch-teaser", "only": ["acme-sans-bold"] }`.
`list_fonts {}` lists every family a `font` param can name.

## A logo as given, on an end card

```json
{ "path": "/path/to/acme-logo.svg", "name": "acme-logo.svg", "license": "original", "creator": "Acme Ltd" }
```

That is `upload_image`. Its internal style sheet and its gradients are kept; `svg.dropped` lists anything that
was not (read it: a dropped rule can change a colour). Describe it (`describe_asset`), then close the clip with
`end-card@3` drawing it as vectors:

```json
{ "clip": "launch-teaser", "operations": [
  { "op": "add_item", "track": "titles", "item": { "id": "end", "asset": "end-card@3", "start": 26, "duration": 4,
    "params": { "logo": "acme-logo", "logoMode": "svg", "title": "Made with *Acme*", "line": "Free to try",
      "cta": "Start building", "url": "acme.example", "plate": true } } }
] }
```

`logoMode: "svg"` fails loudly when the logo is not an uploaded SVG; `"auto"` falls back to the raster. The card is
in within a second and then still, so the last frame holds.

## Share a clip as a page

```json
{ "clip": "launch-teaser", "base_url": "https://example.com/clips/launch-teaser/" }
```

`share_clip` writes `output/share/<clip>/`: `index.html`, the player and the core modules it imports, `bundle.json`
(the composition and its pinned assets), fonts, images, the footage frames the clip shows (WebP), the sound (AAC;
one file per audio item for an interactive clip), a poster and a 1200×630 link-preview card. Every URL in it is
relative, so the folder plays from any static host, under any path, with the studio stopped; `base_url` (where it
will be published) only makes `og:image` and `og:url` absolute for link previews (WhatsApp, Slack). The running
studio serves the same page at `/share/<clip>`. Check the folder before handing it over:

```bash
node scripts/serve-static.mjs output/share/launch-teaser --port 8800 --prefix clips/launch-teaser
```

then `node scripts/share-check.mjs` (a video) or `node scripts/play-check.mjs <url> <out> --steps steps.json`
(an interactive clip) at 1440×900 and `--size 390x844 --mobile`. Publishing the folder is a step for a person.

## An interactive clip: a game, a deck, a little app

```json
{ "name": "quiz", "format": "vertical", "fps": 60, "duration": 20, "interactive": true }
```

`create_clip` with `interactive: true` starts with one scene that holds. Lay the scenes out on the timeline like a
storyboard (each a time range), put the UI on them (`ui-button`, `ui-card`, `ui-menu`, `ui-toggle`, `ui-slider`,
`ui-score`, `ui-toast`, `ui-dialog`, `ui-hotspot`, a `ui-backdrop`), then wire them:

```json
{ "clip": "quiz", "operations": [
  { "op": "set_vars", "vars": { "score": 0, "answered": false } },
  { "op": "add_scene", "scene": { "id": "q1", "start": 4, "duration": 6, "end": "hold" } },
  { "op": "add_wire", "wire": { "on": "start.press", "do": { "go": "q1", "transition": { "asset": "ui-tx-iris", "duration": 0.6 } } } },
  { "op": "add_wire", "wire": { "on": "right.select", "if": { "var": "answered", "eq": false },
    "do": [{ "add": { "score": 10 } }, { "set": { "answered": true } }, { "send": "toast", "event": "success", "value": "Correct" }] } }
] }
```

That is `edit_clip`. A save checks every wire against the events the items' assets declare and every `{ "$var" }`
binding against its param. Then play it:

```json
{ "clip": "quiz", "steps": [{ "wait": 1 }, { "tap": "start" }, { "wait": 0.8 }, { "tap": "right" }, { "key": "Tab" }, { "key": "Enter" }], "stills": true }
```

`play_clip` returns the state after each step (scene, variables, focus), stills and frame hashes, and the raw input
log it played: the same log played again must give the same hashes. `check_clip` crawls the states a viewer can reach
(each region pressed, each key wire, each scene end) and checks every one: unreachable scenes, dead ends, wires on
events nothing draws, tap targets under 24 CSS px on a phone (44 advised), regions off the frame or overlapping, and
the text checks in every state (text behind an open dialog is not read). Aim for 0 errors and 0 warnings.

- **Idle motion** while a scene holds comes from `f.ui.now`, not `f.t` (the playhead stands still).
- **A modal** (`ui-dialog`, or any asset whose full-frame region has `modal: true`) keeps focus and hotkeys inside
  it; still disable what is under it (`disabled: { "$var": "help" }`) so it looks unavailable.
- **Sound**: put cue sounds on an audio track with `cue: true` and `{ "play": "<item>" }` them; a bed that loops while
  a scene waits gets `loop: true`.
- **Frame time**: an interactive clip is drawn 60 times a second in the viewer's browser, often without a GPU on a
  phone. Keep full-frame gradients and resampled `drawImage` of whole frames to a minimum (a transition that scales
  both scenes costs two of them), and measure: `play-check.mjs` reports the frames skipped and the slow ones.

## Keep assets/ and the library in step

`npm run sync-assets` pushes `assets/` into the library and never undoes a change made in the studio: when
the library's newest version did not come from the files (an accepted proposal, a playground save) it stops
and names the conflict. `npm run sync-assets -- --pull <name>` writes the library's version into `assets/`;
`--force` syncs the file anyway.

## Measure

`compounding_report` lists, per clip, the MCP calls, new lines of asset code, the reuse share and
the build time. `reuse_report` lists what each clip created and reused.
