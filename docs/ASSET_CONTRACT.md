# Writing assets

An asset is one JavaScript source that calls `asset({...})` once. The studio compiles it in a
sandbox, draws test frames, checks that the same inputs give the same pixels, and only then saves
it as a new **immutable version** (`name@1`, `name@2`, …). Clips pin the versions they use.

```js
asset({
  kind: 'visual',                      // 'visual' draws · 'value' returns a value · 'audio' returns samples
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
| `f.rng` | Seeded random: `f.rng()`, `.range(a, b)`, `.int(a, b)`, `.pick(list)`, `.bool(p)`, `.gauss()`, `.shuffle(list)`, `.fork(key)`. The sequence restarts every frame, so the n-th call always returns the same number. |
| `f.clip` | `{ t, frame, duration, fps, width, height, format, beats, markers }`: the clip around this asset. `beats` are seconds found in the clip's audio. |
| `f.use(name, params, opts)` | Compose another asset. Visual: draws it; opts `{ x, y, width, height, at, duration, t, hold, alpha, key, ctx }`. Value: returns its value. |
| `f.image(name)` | A loaded image asset for `ctx.drawImage` (has `width`, `height`). |
| `f.offscreen(w, h)` | A cleared scratch layer `{ canvas, ctx, width, height }` for masks and group effects; draw it back with `ctx.drawImage(layer.canvas, x, y)`. |
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

## Parameter types

`number`, `integer` (`min`, `max`, `step`), `boolean`, `string`, `text` (multi-line), `enum` (`options`),
`color`, `font` (a family from the library), `image` (an image asset), `asset` (another asset; `kind`
narrows it), `array` (`of`, `minItems`, `maxItems`), `object` (`fields`). Every declaration may carry
`label`, `description` and `group`. Content slots of a template are just `string`/`array` parameters.

## Other kinds

- **value**: `render(f, p)` returns anything: a number, a palette object, a table of easing
  functions. Add `preview(f, p)` to draw a picture of it for the library thumbnail.
- **audio**: `render(f, p)` synthesizes samples. Audio assets may `f.use()` other audio assets (it
  returns their mono buffer) and value assets.

## Conventions

- Captions: an asset with a `cues` parameter (`[{ start, end, text }]`, seconds relative to the item)
  is exported to SRT alongside the MP4.
- A theme is a `value` asset returning `{ bg, fg, accent, … }`; scenes take it as a parameter of type `asset`.
- Fonts bundled with the studio (all OFL): Inter (400/600/800), Space Grotesk (400/700), JetBrains Mono
  (400/700), Anton (400), Playfair Display (700/900, 700 italic). Emoji fall back to the system emoji font.
