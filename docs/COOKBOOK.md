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
Images and baked sequences are layers too: `{ asset: 'photo', params: { fit: 'cover' } }`.

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

1. Get the take (a voice service, a local model, a recording) and its word times (the service's word list or
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

## Keep assets/ and the library in step

`npm run sync-assets` pushes `assets/` into the library and never undoes a change made in the studio: when
the library's newest version did not come from the files (an accepted proposal, a playground save) it stops
and names the conflict. `npm run sync-assets -- --pull <name>` writes the library's version into `assets/`;
`--force` syncs the file anyway.

## Measure

`compounding_report` lists, per clip, the MCP calls, new lines of asset code, the reuse share and
the build time. `reuse_report` lists what each clip created and reused.
