# New assets: when to write one, and how to write one that compounds

The library grows by a few well-made pieces per clip. A piece is worth its code when the composition is
visibly better for it and a later clip can use it unchanged with other params. Write it as if the next
agent will find it through `suggest_assets` and place it from its example without reading its source.

## Contents

1. Climb the ladder first
2. When a new asset is the right call
3. The conventions of a reusable asset
4. A skeleton
5. Save it: validate, file, sync
6. Kinds you will reach for
7. Leave it ready for the next clip

## 1. Climb the ladder first

Cheapest first; stop where the result is right, not where the code is least:

| need | tool | what you get |
|---|---|---|
| the same asset, tuned | params in the item, copied from `get_asset` `examples` | nothing new |
| that tuning again next time | `create_preset { base, name, params, for_clip }` | a named asset with those defaults |
| a group of layers again | `save_precomp { clip, items, name, expose, replace: true }` | one visual asset drawing them, params exposed |
| better defaults | `save_defaults { name, params }` | a new version, only `default:` values changed |
| a param or a polish the asset lacks | `update_asset` (a new version; old clips keep theirs) | the asset, better, for everyone |
| a change old users of it would not want | `fork_asset` | a sibling with lineage |
| a picture the library cannot draw | `create_asset` | a new piece |

`search_assets { derivation: 'preset' }` and `{ derivation: 'precomp' }` show what others already distilled.

## 2. When a new asset is the right call

- The beat needs a picture no asset draws (a specific diagram, a device, a particle system, a chart type).
- You would need three items and a stack of keyframes to fake what one asset should draw (a group that
  moves as one, a shape that morphs, a counter with its own label and plate).
- The polish you want (a size floor, a theme-aware colour, an in/out envelope, a stagger) is missing from an
  asset you would otherwise reuse: then `update_asset` it, so every clip gets the polish.
- The brand needs its own `theme-<slug>` (a value asset of `theme-tide`'s shape).
- The mood needs a sound the library lacks (`sfx-*`, a music bed): an `audio` asset.

Not a reason: a one-off word, colour or number. Those are params of an existing asset, from `script.json`
and the theme.

## 3. The conventions of a reusable asset

- **Named by family**, lowercase-kebab: `text-*` (type animations), `bg-*`, `trans-*`, `motion-*`, `fx-*`,
  `mask-*`, `theme-*`, `*-3d`, `kit-*` (UI, marketing and explainer pieces), `sfx-*`, `chart-*`, `sketch-*`.
  Names weigh most in search; a family name says what it is.
- **A usage example at the top of the source** (a comment with an item JSON and a sentence on where it
  fits), then a `title`, a `description` that says what it is good for and how it moves, and `tags` by
  family, kind, use (`scene`, `overlay`, `enter`, `loop`, `marketing`, `explainer`).
- **Params for whatever differs between uses**: words, counts, sizes, timing (`inDur`, `outDur`, `delay`,
  `stagger`), an `align`, a `theme` (`{ type: 'asset', kind: 'value', default: 'theme-tide' }`), colour
  overrides as `string` params that default to `''` meaning "the theme's". No word of this video in a
  default: defaults are generic, demo-plausible values.
- **Theme-aware**: `const th = f.theme ?? f.use(p.theme)`; colours from `th`, faces from `th.fonts`
  (`headline`, `body`, `display`, `serif`, `mono`), motion from `th.motion` (`ease`, `pop`, `stagger`,
  `inDur`, `outDur`) as defaults. A clip changes brand with one line when every asset reads the theme.
- **Sizes as a share of the frame's short side** (`const short = Math.min(f.clip?.width ?? f.width,
  f.clip?.height ?? f.height); const u = short / 100`), not of the item box, so a piece reads the same in a
  small box and a large one. Positions as fractions of the box.
- **Text through `f.lib.text`** with `fit: true` and a floor (`floor: 2.6` on the asset): it is measured
  (`layout_report`, `check_clip`), uses pinned fonts, and fails loudly instead of shrinking.
- **An in/out envelope**: ease in over `inDur` from the item's start, out over `outDur` before `f.duration`
  (`f.lib.envelope`, or the pattern in `title-plate`), so the piece can be placed at any length and never
  pops. Clamp every interpolation (`f.lib.phase`, `stagger`, `clamp01`); `lerp` does not clamp.
- **Responsive**: lay out from `f.width`, `f.height`, `f.vmin`, `f.safe`; `formats` only when a shape truly
  cannot work.
- **Pure**: only `f.t`, the params and `f.rng`. No `Math.random`, no `Date`, no state between calls (the
  validator draws frames out of order and compares hashes). `ctx.save()` paired with `ctx.restore()`.
- **No `ctx.filter`, no blur**: Chrome and Skia filter differently. Depth from stacked fills; pixel work in
  effects through `f.lib.fx` (same bytes everywhere).
- **Heavy things are cheap at the call site**: 3D and particle fields keep counts modest; anything that
  takes over 250 ms a frame gets baked (`bake_sequence`) and placed as a sequence layer.
- **`uses` declares every asset it composes** (`['easing']`, `['kit-plate']`), so versions pin and the
  closure exports.

## 4. A skeleton

```js
// A row of up to six stat tiles: a number counts up on its own plate with a label under it, tiles arriving
// one after another. Usage: a proof beat in a marketing video.
//   { "asset": "kit-stat-row", "start": 12, "duration": 6, "params": { "stats": [{ "value": 83, "label": "assets" }, { "value": 11, "label": "clips" }] },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.55, "width": 0.9, "height": 0.3 } }
asset({
  title: 'Stat row',
  description: 'Up to six stat tiles in a row: each number counts up on its own plate with a label under it; the tiles arrive staggered and leave together. Sizes are a share of the frame\'s short side with a floor. Takes a theme.',
  tags: ['kit', 'stats', 'numbers', 'counter', 'row', 'marketing', 'explainer', 'scene'],
  duration: 5,
  floor: 2.6,
  uses: ['easing'],
  params: {
    stats: { type: 'array', of: { type: 'object', fields: { value: { type: 'number' }, label: { type: 'string' }, prefix: { type: 'string' }, suffix: { type: 'string' } } }, minItems: 1, maxItems: 6,
      default: [{ value: 120, label: 'clips' }, { value: 48, label: 'assets' }, { value: 9, label: 'themes' }] },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 7, min: 2.6, max: 20, step: 0.1, description: 'Number size, % of the frame\'s short side' },
    gap: { type: 'number', default: 2.5, min: 0, max: 10, step: 0.1, description: '% of the short side' },
    countFor: { type: 'number', default: 1.2, min: 0, max: 5, step: 0.05 },
    stagger: { type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
    accent: { type: 'string', default: '', description: 'Number colour, a CSS colour (empty: the theme\'s accent)' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height), u = short / 100;
    const out = p.outDur > 0 ? E.inCubic(1 - lib.clamp01((f.duration - f.t) / p.outDur)) : 0;
    const n = p.stats.length, gap = p.gap * u, w = (f.width - gap * (n - 1)) / n;
    p.stats.forEach((s, i) => {
      const k = E.outCubic(lib.stagger(f.t, i, p.stagger, p.inDur));   // 0..1, clamped
      if (k <= 0) return;
      const x = i * (w + gap);
      ctx.save();
      ctx.globalAlpha = k * (1 - out);
      ctx.translate(x + w / 2, f.height / 2 + (1 - k) * 2 * u);
      ctx.scale(0.94 + 0.06 * k, 0.94 + 0.06 * k);
      ctx.translate(-w / 2, -f.height / 2);
      ctx.fillStyle = th.surface;
      ctx.beginPath(); ctx.roundRect(0, 0, w, f.height, 2 * u); ctx.fill();
      const c = E.outExpo(lib.clamp01((f.t - i * p.stagger - p.inDur * 0.3) / Math.max(0.01, p.countFor)));
      const value = `${s.prefix ?? ''}${Math.round(s.value * c)}${s.suffix ?? ''}`;
      const N = lib.text.layout(ctx, value, { font: th.fonts?.display ?? 'Anton', weight: 400, size: p.size * u, maxWidth: w - 2 * u, fit: true, align: 'center' });
      const L = lib.text.layout(ctx, s.label, { font: th.fonts?.body ?? 'Inter', weight: 600, size: Math.max(p.size * u * 0.36, 2.6 * u), maxWidth: w - 2 * u, fit: true, align: 'center', maxLines: 2 });
      const total = N.height + L.height + 0.6 * u, top = (f.height - total) / 2;
      lib.text.fill(ctx, N, (w - N.boxWidth) / 2, top, { color: p.accent || th.accent });
      lib.text.fill(ctx, L, (w - L.boxWidth) / 2, top + N.height + 0.6 * u, { color: th.muted });
      ctx.restore();
    });
  },
});
```

What the skeleton shows: a usage example; a theme; sizes in `u`; a clamped stagger; an envelope; text through
`f.lib.text` with a floor; no words of any video in it.

## 5. Save it: validate, file, sync

1. `validate_asset { source, name, duration, format, frames: 8 }` returns a filmstrip and the contract's
   verdict without saving anything. Iterate here: versions are immutable and stay in the library for good,
   so a half-right version is clutter forever. Look at the filmstrip in the primary shape and in one other.
2. `render_asset_frame` for a full-size still with real params once it validates.
3. Write the source to `assets/<name>.js` (version 2 of an existing asset is `assets/<name>.v2.js`).
4. `npm run sync-assets -- --clip <slug> <name>` creates it (or the new version) through the MCP server with
   this clip as its origin. The sync refuses to overwrite a version made in the studio (an accepted proposal, a
   playground save): then `--pull <name>` first, and build on that file.
5. `get_asset { ref }` to confirm the version, then place it in `compose.mjs` and push.

A precomp (`save_precomp`) or a preset (`create_preset`) is written by the studio into the library only; pull
it into `assets/` with `npm run sync-assets -- --pull <name>` so the repo holds its source too.

## 6. Kinds you will reach for

- **visual**: scenes, overlays, diagrams, plates, particles. Most new assets.
- **value**: a theme (`theme-<slug>`: copy `theme-tide`'s shape, add a `preview`), a palette, a table of curves.
- **motion**: a reusable move (returns a transform delta for `in`, `out`, `emphasis`, `loop`; rest at the end
  of `in` and the start of `out`). Write one when a keyframe pattern recurs on many items.
- **transition**: a carrier (draws `f.from` becoming `f.to` over `f.progress`). Write one when the look needs
  its own cut (a brand wipe, a shape that sweeps across, a shutter).
- **effect**: pixel work through `f.lib.fx` (a grade, a glow, a grain, a chromatic edge, a pixelation).
- **audio**: `f.lib.audio` synthesis (`tone`, `noiseBurst`, `adsr`, `lowpass`, `delay`) for an sfx or a bed.
- **mask**: any visual that draws white where the layer should show.

The contract for each, with a worked example, is in `studio_guide` (and `docs/ASSET_CONTRACT.md`).

## 7. Leave it ready for the next clip

- `add_asset_note { name, note }`: the param set that worked, what it pairs with, a pitfall.
- `organize_assets { names, featured: true }` when the next video should start from it;
  `add_tags` for what search would look for.
- `set_asset_metadata` when the description could say better what it is good for.
- Every upload (`upload_image`, `add_file_asset`, `add_footage`, `add_font`) with its `license`, `creator`,
  `source_url`, `credit`; `describe_asset` for every one `list_undescribed` shows.
- `assets/` and the library agree: `npm run sync-assets` reports nothing to do.
