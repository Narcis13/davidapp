# Writing assets

An asset is one JavaScript source that calls `asset({...})` once. The studio compiles it in a
sandbox, draws test frames, checks that the same inputs give the same pixels, and only then saves
it as a new **immutable version** (`name@1`, `name@2`, …). Clips pin the versions they use.

```js
asset({
  kind: 'visual',                      // visual (default) · value · audio · motion · transition · effect: see "Kinds"
  title: 'Word reveal',                // optional display name
  description: 'Words rise into place one after another. Use for headlines.',   // required
  tags: ['text', 'reveal'],            // required, lowercase-kebab
  duration: 3,                         // natural length in seconds; omit for "any length" (backgrounds, loops)
  formats: ['vertical', 'horizontal', 'square'],   // what it is designed for (default: all three)
  uses: ['easing'],                    // other assets it composes; pinned to their latest version on save
  params: {                            // declared schema: the studio builds controls, the MCP layer validates
    text:  { type: 'text', default: 'Every frame is a *function*' },
    size:  { type: 'number', default: 120, min: 16, max: 400, step: 1 },
    color: { type: 'color', default: '#ffffff' },
    font:  { type: 'font', default: 'Inter' },
  },
  render(f, p) {                       // a pure function of (f.t, p). No state between calls.
    const E = f.use('easing');
    const L = f.lib.text.layout(f.ctx, p.text, { font: p.font, weight: 800, size: p.size,
      maxWidth: f.safe.width, maxHeight: f.safe.height, fit: true, align: 'center', markup: true });
    const y = f.safe.y + (f.safe.height - L.height) / 2;
    for (const w of L.words) {
      const k = E.outBack(f.lib.stagger(f.t, w.index, 0.08, 0.5));
      if (k <= 0) continue;
      f.ctx.globalAlpha = f.lib.clamp01(k * 2);
      f.ctx.fillStyle = p.color;
      f.lib.text.fillWord(f.ctx, w, f.safe.x, y + (1 - k) * 60);
    }
  },
});
```

`asset()` takes only these keys: `kind`, `title`, `description`, `tags`, `duration`, `formats`,
`params`, `uses`, `render`, `preview`. `uses` is a list (`['easing', 'lower-third@2']`) or a map of
aliases (`{ base: 'lower-third@2' }`).

## The rules

- **Pure and deterministic.** A frame depends only on `f.t`, the params and `f.rng`. `Math.random()`,
  `Date.now()`, timers, modules, network and host globals are rejected. Keep no state between calls:
  the validator draws frames out of order and compares hashes.
- **Synchronous.** `render` returns when the frame is drawn. A call that runs too long is killed.
- **Responsive.** Lay out from `f.width`, `f.height`, `f.vmin` and `f.safe`, never from fixed pixel
  positions, so one asset works in vertical, horizontal and square clips (and in a "remix").
- **Balanced canvas state.** The runtime restores the context after every `f.use()`, but inside your
  own asset pair every `ctx.save()` with a `ctx.restore()`.
- **Declare what you compose.** `f.use('x')` only works if `x` is in `uses` or arrived through a
  parameter of type `asset`. That is what lets the studio pin versions and bundle the closure.

## The frame object `f`

| | |
|---|---|
| `f.ctx` | Canvas 2D context (Skia in the renderer, the browser's in the preview). Origin is the top-left of this asset's box. |
| `f.t`, `f.duration`, `f.progress` | Local time in seconds, the length this instance was given, and `t / duration` clamped to 0..1. |
| `f.frame`, `f.fps` | Local frame number and the clip's frame rate. |
| `f.width`, `f.height`, `f.vmin`, `f.vmax`, `f.aspect`, `f.format` | The box this asset draws in. `vmin` is 1% of the shorter side. |
| `f.safe` | `{ x, y, width, height, top, right, bottom, left }`: the area clear of platform UI. Keep text inside it. |
| `f.rng`, `f.seed` | Seeded random: `f.rng()`, `.range(a, b)`, `.int(a, b)`, `.pick(list)`, `.bool(p)`, `.gauss()`, `.shuffle(list)`, `.fork(key)`. The sequence restarts every frame, so the n-th call always returns the same number. `f.seed` is the number it starts from (different for every item). |
| `f.clip` | `{ t, frame, duration, fps, width, height, format, beats, markers }`: the clip around this asset. `beats` are seconds found in the clip's audio. |
| `f.theme` | The value of the clip's theme asset (`composition.theme`), or `null` when the clip has none (and in the playground). Default to it: `f.theme?.accent ?? p.color`. |
| `f.use(name, params, opts)` | Compose another asset. Visual: draws it; opts `{ x, y, width, height, at, duration, t, hold, alpha, key, ctx }`. Value: returns its value. |
| `f.image(name)` | A loaded image asset for `ctx.drawImage` (has `width`, `height`). |
| `f.svg(name)` | The vector drawing of an uploaded SVG, for draw-on and recolouring: see "Uploaded images and SVGs". |
| `f.offscreen(w, h)` | A cleared scratch layer `{ canvas, ctx, width, height }` for masks and group effects; draw it back with `ctx.drawImage(layer.canvas, x, y)`. |
| `f.layers(list, values)` | Draw clip-style layers inside this asset's box (a precomp): see "Presets and precomps". |
| `f.phase` · `f.from`, `f.to` · `f.source` | Only for motions · transitions · effects: see "Kinds". `null` elsewhere. |
| `f.lib` | The standard library, below. |

`f.use` timing: the child's time is `f.t - at`; it is drawn only while `0 ≤ t < duration` unless
`hold: true` (then time is clamped). Without a box the child inherits this asset's box and safe zone.

## The standard library `f.lib`

- **math** (also directly on `f.lib`): `clamp`, `clamp01`, `lerp`, `invLerp`, `remap(v, a, b, c, d)`,
  `smoothstep`, `phase(t, start, dur)`, `stagger(t, i, each, dur, start)`, `envelope(t, duration, inDur, outDur)`,
  `fract`, `mod`, `pingpong`, `deg`, `dist`, `TAU`.
- **color**: `parse`, `css`, `mix(a, b, t)`, `alpha(color, a)`, `lighten`, `darken`, `hsl(h, s, l, a)`,
  `luminance`, `onColor(bg)`.
- **text**: `layout(ctx, text, opts)` → `{ size, width, height, lineHeight, lines, words, glyphs, length }`.
  Options: `font`, `weight`, `italic`, `size`, `lineHeight`, `letterSpacing` (em), `maxWidth`, `maxHeight`,
  `maxLines`, `align`, `wrap`, `fit` (shrink to the box), `minSize`, `markup` (`*emphasis*`), `emFont`,
  `emWeight`, `emItalic`, `transform`. Every line, word and glyph has `x`, `y` (baseline), `top`, `width`,
  `height`, `index`; words and glyphs also have `em`, `line` and `pos` (typing position). Emoji are single
  glyphs. Draw with `fill(ctx, L, x, y, { color, emColor })`, `fillLine`, `fillWord`, `fillGlyph`, `strokeWord`.
- **beat**: `at(t, beats)`, `pulse(t, beats, decay)`, `count(t, beats)`.
- **noise**: `noise(seed)(x, y, z)` and `fbm(seed, octaves)(x, y, z)` in −1..1.
- **audio** (for `kind: 'audio'`): `buffer(seconds)`, `tone({ freq, dur, wave, gain, decay })`,
  `noiseBurst({ rng, dur, decay })`, `mix(dst, src, at, gain)`, `lowpass`, `highpass`, `delay`, `fade`,
  `softclip`, `normalize`, `gain`, `midi(note)`, `adsr`. Return a `Float32Array` (mono) or `{ left, right }`
  of `f.duration × f.sampleRate` samples.
- **fx** (pixel helpers for effects, plain arithmetic on RGBA bytes): see "effect" under "Kinds".
- **solid** (procedural 3D, a software rasterizer): see "3D".
- **svg** (`parsePath`, `flatten`, `pathLength`, `draw`): what `f.svg(name).draw` is built on.

## Parameter types

`number`, `integer` (`min`, `max`, `step`), `boolean`, `string`, `text` (multi-line), `enum` (`options`),
`color`, `font` (a family from the library), `image` (an image asset), `asset` (another asset; `kind`
narrows it), `array` (`of`, `minItems`, `maxItems`), `object` (`fields`). Every declaration may carry
`label`, `description` and `group`. Content slots of a template are just `string`/`array` parameters.

## Kinds

Every kind is a versioned function asset, saved, pinned and traced the same way. `visual` draws on
`f.ctx` and is what sits on a clip's tracks. The others:

- **value**: `render(f, p)` returns anything: a number, a palette object, a table of easing
  functions. Add `preview(f, p)` to draw a picture of it for the library thumbnail.
- **audio**: `render(f, p)` synthesizes samples. Audio assets may `f.use()` other audio assets (it
  returns their mono buffer) and value assets.
- **motion**, **transition**, **effect** are not placed on a track (a track takes visual assets,
  images and sequences and rejects the rest): they are attached to an item, a track or the clip.
  The playground previews them on a built-in demo scene, which is also their thumbnail.

### motion

Moves an item without redrawing it. `render(f, p)` returns a transform delta and draws nothing.

- `f` gives: `f.phase` (`in`, `out`, `emphasis` or `loop`), `f.t`, `f.duration` and `f.progress`
  over the motion's span, `f.width` × `f.height` (the item's box in pixels), `f.clip` (the frame),
  `f.rng`, `f.use` (value assets such as `easing`).
- Return `{ x, y, scale, scaleX, scaleY, rotation, opacity }`, any subset (or nothing for "no
  change"). `x`, `y` are offsets in frame pixels, `rotation` is in degrees. Any other key, or a
  value that is not a finite number, is an error.
- Attach: `item.motions = [{ asset, phase, duration, at, params }]`. `phase` defaults to `in`.
  `in` runs for the first `duration` seconds of the item, `out` for the last, `emphasis` from item
  time `at`, `loop` for the whole item. `duration` defaults to the asset's `duration` (else 0.6 s).
  "The item" is its whole timeline: after a split, `in` belongs to the first part and `out` to the
  last, and neither replays at the cut. Outside its span a motion is not called. Motions stack: offsets and rotations add, scales and
  opacity multiply, all about the item's anchor.
- Validation: called at the start, middle and end of each of the four phases, twice, and the two
  results must be equal. Return rest (offsets and rotation 0, scale and opacity 1) at the end of
  `in` and the start of `out`; the validator warns when the end of `in` is not rest (the item
  would jump).

```js
asset({
  kind: 'motion',
  description: 'Slides an item in from the left with an ease-out, and back out the same way.',
  tags: ['motion', 'slide', 'enter', 'exit'],
  duration: 0.7,
  uses: ['easing'],
  params: { distance: { type: 'number', default: 0.25, min: 0, max: 1.5 }, fade: { type: 'boolean', default: true } },
  render(f, p) {
    const e = f.use('easing');
    const k = f.phase === 'out' ? e.inCubic(f.progress) : 1 - e.outCubic(f.progress);   // 0 = at rest
    return { x: -k * p.distance * f.clip.width, opacity: p.fade ? 1 - k : 1 };
  },
});
```

### transition

Draws one layer turning into the next.

- `f` gives: `f.from` and `f.to`, full-frame layers `{ canvas, ctx, width, height }` of the outgoing
  and the incoming item (`f.from` is `null` when nothing was there before), `f.progress` 0..1 over
  the transition, `f.t`, `f.duration`, and the frame as `f.width` × `f.height`.
- Draw the mix onto `f.ctx`, a clean full-frame layer. At progress 1 the result should be `f.to`.
- Attach to the incoming item: `item.transition = { asset, duration, params }`. It runs from the
  item's start for `duration` seconds: by default the asset's own `duration`, else 0.5 s, and never
  longer than the item. The outgoing layer is the latest item on the same track that starts earlier and has not
  ended before the transition starts; it keeps playing during the transition, or holds its last
  frame once it ends.
- Validation: three frames at 1920×1080 between two demo scenes, the middle one drawn twice (the
  hashes must match); a warning when it draws nothing or a frame takes more than 400 ms.

```js
asset({
  kind: 'transition',
  description: 'The next layer slides in from the right and pushes the previous one out of the frame.',
  tags: ['transition', 'push', 'slide'],
  duration: 0.7,
  uses: ['easing'],
  render(f) {
    const k = f.use('easing').inOutCubic(f.progress);
    if (f.from) f.ctx.drawImage(f.from.canvas, -f.width * k, 0);
    f.ctx.drawImage(f.to.canvas, f.width * (1 - k), 0);
  },
});
```

### effect

Draws a processed copy of a layer.

- `f` gives: `f.source`, a full-frame layer `{ canvas, ctx, width, height }` holding what the effect
  is applied to, and the frame as `f.width` × `f.height`. `f.t` and `f.duration` are the item's
  time and length for an item effect (of the whole item when it was split), the clip's for a
  track or clip effect.
- Draw the result onto `f.ctx`, a clean full-frame layer. What you do not draw is transparent.
- Attach: `item.effects = [{ asset, params }]` (one item), `track.effects` (everything on a visual
  track, like an adjustment layer) or `composition.effects` (the whole frame, after every track).
  Effects in a list run in order, each on the result of the one before. On an item the order is:
  content, effects, mask, then opacity and blend.
- Validation: as for a transition, on one demo scene.
- Use `f.lib.fx`, not `ctx.filter` (Chrome and Skia filter differently; `fx` is the same bytes in
  both): `read(layer)` → image `{ data, width, height }`, `write(ctx, img, x, y)`, `create(w, h)`,
  `clone`, `downsample(img, k)`, `resize(img, w, h)`, and in place: `blur(img, radius)`,
  `glow(img, { radius, strength, threshold, color })`, `grain(img, { amount, seed, mono, size })`,
  `vignette(img, { amount, radius, softness, color })`,
  `grade(img, { exposure, contrast, saturation, temperature, tint, gamma, lift })`,
  `duotone(img, { dark, light, mix, contrast })`, `chromatic(img, { amount, angle, radial })`,
  `displace(img, (x, y) => [dx, dy])`, `pixelate(img, size)`, `scanlines(img, { spacing, strength, offset })`,
  `over(img, top, opacity)`. Radii are pixels: scale them with `f.vmin`. For noise that changes
  every frame, seed it with the frame: `seed: f.seed * 31 + f.frame`.

```js
asset({
  kind: 'effect',
  description: 'A soft bloom around the bright parts of a layer. Good on titles and neon lines.',
  tags: ['effect', 'glow', 'bloom'],
  params: { radius: { type: 'number', default: 2.2, min: 0, max: 10, description: '% of the short side' }, strength: { type: 'number', default: 0.9, min: 0, max: 2 } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.glow(img, { radius: p.radius * f.vmin, strength: p.strength });
    f.lib.fx.write(f.ctx, img);
  },
});
```

### Masks

A mask is not a kind: any visual asset, image or baked sequence can be one.
`item.mask = { asset, params, mode, transform }` keeps the item's pixels where the mask is opaque
(`alpha`, the default), where it is clear (`alpha-inverted`), where it is bright (`luma`) or dark
(`luma-inverted`). The mask runs on the item's clock and moves with the item, unless it has a
`transform` of its own. A mask asset just draws white where the layer should show:

```js
asset({
  description: 'A soft-edged white disc that grows open: attach it as an alpha mask to reveal a layer in a circle.',
  tags: ['mask', 'shape', 'reveal'],
  duration: 3,
  uses: ['easing'],
  params: { open: { type: 'number', default: 0.8, min: 0.05, max: 10 }, feather: { type: 'number', default: 0.08, min: 0, max: 0.5 } },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const r = (Math.hypot(w, h) / 2) * f.use('easing').outCubic(Math.min(1, f.t / p.open));
    if (r <= 0) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * (1 - p.feather), w / 2, h / 2, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
  },
});
```

## Presets and precomps

Both are ordinary assets whose source the studio writes (`create_preset`, `save_precomp`).

- A **preset** is a base asset with chosen params as its defaults: `uses: { base: 'lower-third@1' }`,
  the base's schema, and `render(f, p) { return f.use('base', p); }`. It works for every kind: an
  effect may `f.use` an effect and a transition a transition, on the same layers.
- A **precomp** is a visual asset that draws layers with `f.layers(list, values)`, the way a clip
  draws its items, inside the asset's box. Each layer is `{ id, asset, start, duration, params,
  transform, keyframes, formats, motions, effects, mask, transition, track, opacity, blend, fadeIn,
  fadeOut, offset, assetDuration, seedId }`, bottom first; `asset` is an alias from `uses` (function
  and image assets; not sequences). `start` defaults to 0, and a layer without `duration` lasts to
  the end of the asset. A layer's `transition` hands over from the layer before it among the
  layers with the same `track` (any string; all layers when none names one); `save_precomp`
  writes each layer's clip track there. A param value `{ $param: 'name' }` takes `values.name`,
  which is how a precomp exposes params. Keyframes with named curves need `easing` in `uses`.
  Only a visual asset may call `f.layers`.

```js
const LAYERS = [
  { id: 'bg', asset: 'bg-grid', start: 0, duration: 5 },
  { id: 'title', asset: 'text-word-reveal', start: 0.3, duration: 4.7, params: { text: { $param: 'title' } },
    transform: { space: 'safe', x: 0.5, y: 0.4, width: 1, height: 0.5 }, motions: [{ asset: 'motion-pop', phase: 'out' }] },
];
asset({
  description: 'A title card: a grid with a headline that pops out at the end.',
  tags: ['precomp', 'title'],
  duration: 5,
  uses: { 'bg-grid': 'bg-grid@1', 'text-word-reveal': 'text-word-reveal@2', 'motion-pop': 'motion-pop@1' },
  params: { title: { type: 'text', default: 'Made with *code*' } },
  render(f, p) { f.layers(LAYERS, p); },
});
```

## 3D: `f.lib.solid`

Meshes built from code, a camera, lights and a software rasterizer with a depth buffer. It is plain
arithmetic on typed arrays, so a 3D frame is the same bytes in the preview and the render, with no
GPU. The picture is drawn into the asset's box with transparency where nothing is, so it composes
with transforms, masks and effects like any layer. y is up; units are arbitrary.

```js
asset({
  description: 'A low-poly orb with a tilted ring, turning slowly. Colours follow the clip theme.',
  tags: ['3d', 'orb', 'object'],
  duration: 8,
  params: { color: { type: 'color', default: '#ff5c8a' }, spin: { type: 'number', default: 24, min: -180, max: 180 } },
  render(f, p) {
    const S = f.lib.solid;
    S.render(f, {
      camera: { position: [0, 0.6, 5.2], target: [0, 0, 0], fov: 36 },
      lights: [{ type: 'ambient', intensity: 0.32 }, { type: 'directional', direction: [-1, -1.4, -1], intensity: 0.95 }],
      objects: [
        { mesh: S.icosphere(2, 1), rotation: [12, f.t * p.spin, 0], color: f.theme?.accent ?? p.color, shading: 'flat' },
        { mesh: S.torus(1.55, 0.06, 64, 8), rotation: [72, 0, 18], color: '#ffd166', shading: 'smooth' },
      ],
    });
  },
});
```

- `S.render(f, scene)` → `{ triangles, drawn }`. `scene`: `camera { position, target, up, fov
  (vertical, degrees), near, far }`, `lights [{ type: 'ambient' | 'directional' | 'point', color,
  intensity, direction (where it shines), position }]`, `objects [{ mesh, position, rotation
  (degrees, x then y then z), scale, color, shading: 'flat' | 'smooth' | 'toon', steps, emissive,
  doubleSided }]`, `background` (default transparent), `fog { color, near, far }`, `supersample`
  (1 to 3, default 2).
- Meshes are `{ positions, indices, colors }` (triangles, counter-clockwise from outside; every
  generator winds that way, so back faces are culled unless the object is `doubleSided`):
  `box(w, h, d)`, `icosphere(detail, radius)`, `lathe(profile, segments)` with profile `[[radius, y], …]`,
  `cylinder(radiusTop, radiusBottom, height, segments)`, `torus(R, r, segments, tube)`,
  `extrude(shape, depth)` with shape `[[x, y], …]`, `terrain({ size, cols, rows, height(x, z), color(y) })`,
  `text(str, { size, depth, spacing })` (5×7 block capitals, digits and basic punctuation),
  `instances(mesh, [{ position, rotation, scale, color }])`, `merge(...meshes)`,
  `transform(mesh, matrix)`, `paint(mesh, color)`, `mesh(positions, indices, colors)`, `triangulate(polygon)`.
- Matrices (4×4): `compose({ position, rotation, scale })`, `identity`, `translation`, `scaling`,
  `rotationX`, `rotationY`, `rotationZ`, `multiply`, `lookAt`.
- 3D at 1080p is slow (the validator warns above 250 ms a frame). Bake it once with
  `bake_sequence` and use the sequence as a layer.

## Uploaded images, SVGs and sequences

- An **image** asset reaches code through a parameter of type `image` (or `uses`): `f.image(p.photo)`
  for `ctx.drawImage`. On a visual track it is a layer by itself, with `params.fit`: `contain`
  (default), `cover` (cropped to the box) or `fill`.
- An uploaded **SVG** is sanitised, stored with a PNG raster (what `f.image` and an image layer
  draw) and a vector model. `f.svg(name)` returns `{ width, height, viewBox, paths, draw }`;
  `draw(ctx, { x, y, width, height, progress, fill, stroke, colors, strokeWidth, outline })`
  contain-fits it in the box. `progress` 0..1 draws it on (strokes trace in, fills fade in over the
  last third); `fill` and `stroke` replace every colour, `colors: { '#old': '#new' }` some.
  `f.svg` throws for an image that is not an uploaded SVG.
- A **sequence** asset is what `bake_sequence` makes from any visual asset: PNG frames with alpha.
  It is a layer like an image, with `params.fit` and `params.loop` (default: hold the last frame),
  and can be a mask. It cannot be used from asset code.

```js
asset({
  description: 'Draws an uploaded SVG on: strokes trace in, then the fills fade in, then it holds.',
  tags: ['svg', 'logo', 'draw-on'],
  duration: 4,
  params: { logo: { type: 'image', default: null }, drawFor: { type: 'number', default: 1.6, min: 0.1, max: 20 } },
  render(f, p) {
    if (!p.logo) return;
    f.svg(p.logo).draw(f.ctx, { width: f.width, height: f.height, progress: Math.min(1, f.t / p.drawFor) });
  },
});
```

## Placing assets in a clip

A composition is `{ format | width + height, fps, duration, background, seed, theme, easing, effects,
markers, tracks }`. A track is `{ id, name, type: 'visual' | 'text' | 'audio', hidden, locked, solo,
muted, effects, items }`; tracks draw bottom to top, a soloed visual track hides the others, `muted`
silences an audio track. An item is `{ id, asset, start, duration, params }` plus, on visual and
text tracks, `opacity`, `blend`, `fadeIn`, `fadeOut` and everything below. An item with none of the
fields below is drawn exactly as before they existed, so old clips keep their pixels.

```js
{ id: 'title', asset: 'text-kinetic', start: 0.4, duration: 6.6, params: { words: ['DIRECT', 'THE', 'STUDIO'] },
  transform: { space: 'safe', x: 0.42, y: 0.5, width: 0.8, height: 0.75 },
  keyframes: { rotation: [{ t: 0, v: -5, ease: 'outBack' }, { t: 0.8, v: 0 }] },
  motions: [{ asset: 'motion-slide', phase: 'in', params: { distance: 0.2 } }],
  effects: [{ asset: 'fx-glow', params: { strength: 0.7 } }],
  transition: { asset: 'trans-push', duration: 0.7 },
  mask: { asset: 'mask-iris', mode: 'alpha', params: { open: 1.1 } },
  formats: { vertical: { transform: { x: 0.5, y: 0.42, width: 1, height: 0.5 } }, square: { params: { interval: 0.5 } } } }
```

- **`transform`**: `{ space, x, y, width, height, anchorX, anchorY, scale, scaleX, scaleY, rotation }`.
  `space` is `frame` (default) or `safe`; `x`, `y`, `width`, `height` are fractions of that
  rectangle, so a layout means the same in every format. The item draws into a `width` × `height`
  box (its `f.width` × `f.height`); the box's anchor (`anchorX`, `anchorY`, fractions of the box)
  sits at (`x`, `y`); the box is scaled and rotated (degrees, clockwise) about the anchor.
  Defaults: `x`, `y`, `anchorX`, `anchorY` 0.5, `width`, `height`, scales 1, `rotation` 0. A box
  that is exactly the frame keeps the frame's safe zone; in any other box `f.safe` is the whole
  box. It is a canvas transform, not a resample, so vectors stay sharp. Unknown fields and a
  `width` or `height` ≤ 0 are rejected. The older `box: { x, y, width, height }` (top-left,
  fractions of the frame) still works and is read as a transform.
- **`keyframes`**: `{ prop: [{ t, v, ease }] }`. Props: `x`, `y`, `width`, `height`, `anchorX`,
  `anchorY`, `scale`, `scaleX`, `scaleY`, `rotation`, `opacity`, and `params.<name>` for `number`,
  `integer` and `color` params. `t` is seconds of the item's own time (≥ 0; for a split item, of the timeline it was cut from);
  before the first key the value holds the first `v`, after the last the last. `ease` shapes the segment that leaves a
  key: `linear` (default), `hold`, or a curve of the `easing` asset (`inQuad`, `outQuad`,
  `inOutQuad`, `inCubic`, `outCubic`, `inOutCubic`, `outQuart`, `outQuint`, `inExpo`, `outExpo`,
  `inOutExpo`, `inBack`, `outBack`, `outElastic`, `outBounce`). The composition pins that asset as
  `composition.easing` (added on save when a keyframe names a curve). Colours interpolate per
  channel in sRGB; a property's keys are all numbers or all colours.
- **`formats`**: `{ vertical | horizontal | square: { transform, keyframes, params, hidden, opacity } }`,
  applied when the clip is drawn in that format. `transform` and `params` merge key by key over
  the base, `keyframes` replace per property. `start_render { format }` renders one composition in
  another format with these overrides.
- **`motions`**, **`effects`**, **`transition`**, **`mask`**: see "Kinds". Each is `{ asset, params }`
  plus its own fields; any other field is rejected, the asset must be of the right kind, and its
  params are checked against its schema. References are pinned on save like the item's own.
- **`offset`**, **`assetDuration`**, **`seedId`**: what makes a part of a split item a continuation.
  `offset` is seconds into the asset where the part starts, `assetDuration` the length of the
  timeline it was cut from, and `seedId` (a string) the id the part takes its random seed from
  instead of its own: the asset, its mask, motions, effects and audio synthesis all seed from
  `seedId ?? id`. `split_item` (and the editor's split) gives the second part `offset`, the whole
  `assetDuration` and `seedId` = the first part's `seedId ?? id`, and drops its `transition`. The
  asset, keyframes, motions and item effects then run on the whole item's time (`offset` + time
  on screen, over `assetDuration`), so the frames on both sides of the cut match and nothing
  restarts. `fadeIn` and `fadeOut` stay with each part's own start and end.
- **`composition.theme`**: the reference of a value asset; every asset in the clip reads its value
  as `f.theme`.

## Conventions

- Captions: an asset with a `cues` parameter (`[{ start, end, text }]`, seconds relative to the item)
  is exported to SRT alongside the MP4.
- A theme is a `value` asset returning `{ bg, bgAlt, surface, ink, muted, accent, accent2, accent3,
  fonts, motion }` (see `theme-ember`, `theme-tide`). Scenes take it as a parameter of type `asset`,
  or read the clip's as `f.theme`.
- The library names assets by family (names weigh most in search and `suggest_assets`):
  `motion-*`, `trans-*`, `fx-*`, `mask-*`, `*-3d`, `text-*`, `bg-*`, `theme-*`.
- Fonts bundled with the studio (all OFL): Inter (400/600/800), Space Grotesk (400/700), JetBrains Mono
  (400/700), Anton (400), Playfair Display (700/900, 700 italic). Emoji fall back to the system emoji font.
