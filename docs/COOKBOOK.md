# Cookbook: building clips that compound

Recipes for the features added in iteration 2. The asset contract itself is in `ASSET_CONTRACT.md`.

## Start from what exists

1. `suggest_assets { brief }` with a sentence about the clip or scene. It returns ranked candidates,
   a few per kind, with their params, notes from other agents and a contact sheet. Featured and
   often-used pieces rank higher.
2. `search_assets { query, kind, tags, derivation: 'preset' | 'precomp', sort, facets: true }` to dig further.
3. `get_asset` shows `examples` (how earlier clips used it) and `notes`. Copy params from an example.
4. Write new code only for what is missing. Leave a note (`add_asset_note`) on anything you learn.

## Layout: transforms, formats, keyframes

An item's `transform` places its box: `x, y, width, height` are fractions of the frame (or of the
safe zone with `space: 'safe'`), so one layout works in every format. The anchor (`anchorX`,
`anchorY`, default 0.5) sits at (x, y); `scale`, `scaleX`, `scaleY` and `rotation` (degrees) turn
about it. The asset draws into the box (`f.width × f.height`); a full-frame box keeps the frame's
safe zone.

```js
{ id: 'title', asset: 'text-kinetic', start: 1, duration: 4, params: { text: 'Hello' },
  transform: { space: 'safe', x: 0.5, y: 0.2, width: 1, height: 0.3 },
  keyframes: { rotation: [{ t: 0, v: -8, ease: 'outBack' }, { t: 0.8, v: 0 }], 'params.size': [{ t: 0, v: 60 }, { t: 1, v: 96 }] },
  formats: { vertical: { transform: { y: 0.12, height: 0.22 } }, square: { params: { size: 72 } } } }
```

- Keyframe times are item time; a key's `ease` (a curve name from the `easing` asset, or `linear`, `hold`) shapes the segment leaving it. Numeric and colour params can be keyframed as `params.<name>`.
- `formats.<name>` overrides transform, keyframes, params, opacity or hides the item in that format. `start_render { format }` renders the same composition in another format.
- Edit with `edit_clip`: `set_transform` (with `format` for an override), `add_keyframe`, `remove_keyframe`, `set_keyframes`, `set_override`, `move_track` (draw order: last is in front), `move_item`, `update_track` (lock, hide, solo, mute, name), `split_item` (keeps playing across the cut), `duplicate_item`.
- Images and baked sequences are layers too: put `asset: 'photo'` on a visual track with `params.fit` (`contain`, `cover`, `fill`) and, for sequences, `loop`.

## Motion, transitions, effects, masks

- `motions: [{ asset: 'motion-pop', phase: 'in' | 'out' | 'emphasis' | 'loop', duration, at, params }]` on any visual item. They stack.
- `transition: { asset: 'transition-wipe', duration, params }` on the incoming item; it hands over from the item before it on the same track.
- `effects: [{ asset: 'fx-glow', params }]` on an item, on a track (adjusts everything on it) or on the composition (the whole frame).
- `mask: { asset: 'mask-iris', mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted', params, transform? }`.

Writing them:

```js
asset({ kind: 'motion', duration: 0.6, description: '…', tags: ['motion'], params: { distance: { type: 'number', default: 0.3 } },
  render(f, p) {                        // f.phase: in | out | emphasis | loop; f.progress over the span
    const k = f.phase === 'out' ? f.progress : 1 - f.progress;     // 0 = at rest
    return { y: k * p.distance * f.clip.height, opacity: 1 - k };  // x, y (px), scale, scaleX, scaleY, rotation, opacity
  } });
asset({ kind: 'transition', duration: 0.8, description: '…', tags: ['transition'],
  render(f) { if (f.from) f.ctx.drawImage(f.from.canvas, 0, 0); f.ctx.globalAlpha = f.progress; f.ctx.drawImage(f.to.canvas, 0, 0); } });
asset({ kind: 'effect', description: '…', tags: ['effect'], params: { radius: { type: 'number', default: 20 } },
  render(f, p) { const img = f.lib.fx.read(f.source); f.lib.fx.glow(img, { radius: p.radius }); f.lib.fx.write(f.ctx, img); } });
```

A motion must return rest (no offset, scale 1, opacity 1) at the end of `in` and the start of `out`.
`f.lib.fx`: `read, write, blur, glow, grain, vignette, grade, duotone, chromatic, displace, pixelate, scanlines, over`: all plain arithmetic, the same in preview and render.

## Presets and precomps: the cheapest new assets

- `create_preset { base, name, params }`: a named asset that is the base plus those params as defaults. It pins the base version and gets its own thumbnail.
- `save_precomp { clip, items, name, expose: [{ item, param, name }], replace: true }`: several layers become one visual asset with the params you expose. An intro, a stat scene or a lower-third block becomes one piece for the next clip. Precomp sources use `f.layers(LAYERS, p)` and `{ $param: 'name' }` bindings.
- `save_defaults { name, params }`: a new version with these params as defaults (the source is rewritten in place).

## 3D

`f.lib.solid` draws meshes with a software rasterizer, the same bytes in preview and render:

```js
const S = f.lib.solid;
S.render(f, {
  camera: { position: [0, 1.2, 5], target: [0, 0, 0], fov: 40 },
  lights: [{ type: 'ambient', intensity: 0.35 }, { type: 'directional', direction: [-1, -2, -1.5], intensity: 0.9 }],
  objects: [{ mesh: S.icosphere(2, 1), rotation: [0, f.t * 60, 0], color: f.theme?.accent ?? '#ff5c8a', shading: 'flat' }],
  fog: { color: '#101018', near: 6, far: 12 },
});
```

Meshes: `box, icosphere, lathe, cylinder, torus, extrude, terrain, text, instances, merge, transform, paint`. Shading: `flat`, `smooth`, `toon` (`steps`). 3D at 1080p is heavy: bake it once with `bake_sequence` (cached by version, params, size, fps and duration) and use the sequence as a layer.

## Uploads

Uploaded images (`upload_image`, or drag and drop in the studio) wait on `list_undescribed`, which shows each picture. Describe each one with `describe_asset { name, title, description, tags, uses }`. Use them as layers, or as `image` params (`f.image(p.photo)`). An uploaded SVG also has a vector drawing: `f.svg(p.logo).draw(f.ctx, { width, height, progress, fill, stroke })` draws it on and recolours it.

## Requests from the studio

`list_requests`, `claim_request { id }` (it returns the thread, the scope and frames), then
`propose_asset_version`, `propose_new_asset` or `propose_clip_edit` with a one-line summary. The
user compares and accepts the proposal in the studio. Use `reply_request` for questions and
`complete_request` when nothing should change.

## Theme

`composition.theme: 'theme-ember'` (a value asset) is read by every asset as `f.theme`. Write new
assets to default to it (`p.color ?? f.theme?.accent`), and a whole clip changes brand with one line.

## Measure

`compounding_report` lists, per clip, the MCP calls, new lines of asset code, the reuse share and
the build time.
