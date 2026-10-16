# Craft: what makes a short video look finished

Read this before building. Every rule says why, so you can apply it to a case it does not name. The studio
measures the measurable ones (`check_clip`, `render_report`, `layout_report`); the rest you check on stills.

## Contents

1. One idea, one focal point
2. Motion
3. Cuts and carriers
4. Type
5. Colour, depth and texture
6. Layout and the grid
7. Sound
8. Shapes (vertical, horizontal, square)
9. The two frames that matter most
10. A checklist to run on every beat

## 1. One idea, one focal point

A short video is one takeaway; every beat is one idea in service of it. A frame with two things asking for
attention has none. Before you place anything, name the beat's one idea and the one element that carries it;
everything else is support (quieter, smaller, duller, later). The accent colour belongs to the carrier alone.

Design for sound off: most feeds autoplay muted. The takeaway must survive on the frames alone, so the key
words are on screen, not only spoken, and the proof (a chart, a screen, a number) is drawn, not described.

## 2. Motion

- **Nothing moves linearly except machines.** Ease out on entrances (fast start, soft landing: `outExpo`,
  `outCubic`, `outQuint`), ease in on exits (`inCubic`), `outBack` for a pop with overshoot, `outElastic` only
  on something playful. A keyframe without an `ease` is linear: name one.
- **Entrances 0.3 to 0.6 s, exits 0.2 to 0.4 s.** Entrances are watched; exits are forgotten the moment the
  next thing arrives. A carrier at most 0.8 s.
- **Stagger related elements by 2 to 4 frames** (0.07 to 0.13 s at 30 fps; `f.lib.stagger`, a theme's
  `motion.stagger`). A list, a row of icons or the words of a headline arriving as one block looks like a
  slide; arriving one after another looks animated. Never more than about 0.15 s apart, or the viewer waits.
- **Overlap.** The next element starts before the last one has settled. Sequential "in, wait, in, wait" reads
  as a slideshow; overlapping arrivals read as one choreography.
- **Text moves in, stops, is read, moves out.** Text that keeps moving cannot be read. A held line still
  breathes through what is around it, not through itself.
- **Hold still, but never freeze.** A frozen frame half a second long reads as a fault (and `render_report`
  flags freezes from 0.5 s unless a `hold` marker names them). A held scene drifts: `motion-drift` as a
  `loop` on scene items (`amount` 0.003 to 0.006, `tilt` 0.3, `period` 5 to 7), a slow gradient behind it,
  sparse particles, a breathing glow. Constant busy motion is noise; a slow drift is life.
- **Emphasis is rare and timed.** Once per beat, on the key word or number: a `motion-pop` with
  `phase: 'emphasis'` at the word, a keyframe on `params.<name>` (a counter, a progress, a colour), a
  brightness change. Everything else is quiet at that moment.
- **Keep the eye on a path.** Elements enter from where the eye already is, or from the direction the last
  thing left. Left-to-right for a sequence, from the edge the carrier came from, from the centre for the
  one thing to look at.
- **Scale from the anchor.** Pops and zooms scale about the element's own centre (`anchorX`, `anchorY`), not
  the frame's, unless it is a camera move on the whole scene.
- **Cameras move on purpose.** A `kit-camera` zoom lands on the thing to read, at a size that meets the text
  floor, and rests there before anything else happens. The cursor arrives, rests 0.3 s, clicks, then the
  result follows.

## 3. Cuts and carriers

- **Every cut has a carrier**: something that brings the next scene in. A `transition` on the incoming item
  (`trans-push`, `trans-wipe`, `trans-iris`, `trans-glitch`), a `mask` opening, a motion that carries a shape
  across, a camera move, a shared element that stays while everything around it changes. A crossfade is the
  carrier of last resort, when nothing connects the two ideas.
- **Consecutive scenes on one track.** A transition takes the scene it replaces from its own track; scenes on
  different tracks come in over the bare background and the cut looks like a dip.
- **The screen never goes blank**, never dips to a flat colour, never flashes white. A `fadeIn` or `fadeOut`
  with only the background behind it is a dip. Overlap the scenes by 0.3 to 0.5 s (the next comes in while
  the last goes out) so there is always a picture.
- **Nothing flashes more than 3 times a second** (`render_report` counts).
- **Cut on the beat** when there is music: a `bpm` whose bars fall on your cuts (at 120 bpm a bar is 2 s;
  at 112, 2.143 s). Cuts a few frames after the downbeat feel on time; cuts before it feel early.
- **Name every cut and hold** as markers (`cut`, `hold` with `duration`): the sheets show the middle of each
  cut and the report excuses brightness jumps and stills only there.

## 4. Type

- **Hierarchy from size and weight, not colour.** Headline, support line, eyebrow. A 1.25 scale between
  levels at least; a headline at ≥ 7 % of the short side, support at 4 to 5 %, an eyebrow in small caps
  with letter-spacing in the mono or body face.
- **Markup for the key word**: `*asterisks*` colour the word in the accent (and can switch face); that is the
  emphasis of a line. One emphasised phrase per line.
- **Size floors fail loudly.** `f.lib.text.layout` with `fit: true` and a `floor` (or `floor` on the asset):
  a text that cannot be drawn at its floor throws with the item and the time, so you learn at the still, not
  at the render. Give it a bigger box or fewer words; never let it shrink or ellipsise.
- **Line length.** Headlines in 1 to 3 lines; break where the phrase breaks (`\n` in the param) rather than
  where the box happens to end. Captions: 2 lines of about 32 characters in 16:9, 20 in the other shapes.
- **Left-aligned unless it is one centred line.** Ragged-right paragraphs read; centred paragraphs do not.
- **Contrast is measured** against the worst pixels behind the box (`check_clip`, 4.5:1). Text over a
  gradient or footage sits on a plate (`title-plate`, `kit-plate`, a pill) or on a darkened band.
- **The spoken word in captions is marked by brightness**, never by weight or size, which make the line jump.

## 5. Colour, depth and texture

- **One accent.** It marks the thing to look at; the eyebrow, the key word, the line on the chart, the
  button, the active caption word. `accent2` and `accent3` are for data series and secondary marks.
- **Depth without blur.** Plates with stacked translucent shadows (`kit-plate` does it with plain fills), a
  faint top sheen, a hairline border at 15 % ink. Layers in front are lighter and sharper than layers behind.
- **Glow is a spice.** `fx-glow` on the accent element or the logo at `strength` 0.4 to 0.8, never on the
  whole frame; a glow on everything is a glow on nothing.
- **Gradients carry grain.** A wide dark gradient bands once compressed; `fx-grain` at a low `amount` (0.04
  to 0.08) on the gradient's own item or track hides it. Grain over the whole frame at full amount made
  renders of 180 to 600 MB in the showcase, so keep it on the background.
- **A vignette** at 0.3 to 0.5 draws the eye inward and settles the corners (`bg-gradient-drift` has one;
  `fx-vignette` for anything else).
- **Dark backgrounds for feeds, light for documents.** A deep, slightly tinted dark (never pure black)
  makes accents glow and compresses well; a light look needs stronger plates and darker ink.
- **Footage and photos are treated to belong**: graded toward the palette (`fx-duotone`, or a new `fx-*`
  effect built on `f.lib.fx.grade`), masked to the grid, under a plate wherever text sits on them, under a
  quarter of the running time.

## 6. Layout and the grid

- Text inside title-safe (5 %), graphics inside action-safe (3.5 %). Nothing touches the frame edge except
  full-bleed shapes and footage. In any box but the full frame, `f.safe` is the whole box, so text items get
  a box on the grid (`transform` in `space: 'safe'`).
- With burned-in captions, the caption lane (`f.clip.lane`) is part of the grid: nothing but captions enters
  it. With `platforms` set and `safe: 'platform'`, the safe zone follows the tightest platform edge (Shorts,
  Reels and TikTok cover the bottom third and the right edge of a vertical frame).
- Boxes are fractions of the frame or the safe zone, so a layout means the same in every shape; the asset
  draws into its box and stays sharp at any scale.
- Align to a few lines: one left margin for all text in a scene, one baseline grid for a row of items, equal
  gaps. Misaligned by a little reads as careless; aligned reads as designed.
- Give things room. A plate's padding at 3 % of the short side; gaps between a row of items at 2 to 3 %.
  Crowding is the most common amateur tell.

## 7. Sound

- **Music under everything**, from frame 0, ending on its own ending or a 1 s fade, never a hard cut.
  `music-loop` synthesizes a bed with no licence to clear (`bpm`, `scale`, `arp`, `drums`, `bass`,
  `build`, `outroBars`); a new `audio` asset for another mood (ambient pads, a pulse, a riser).
- **`beats: true`** on the music item: every asset gets `f.clip.beats` and can pulse on the beat
  (`bg-gradient-drift`'s `beatPulse`, `beat-bars`, `f.lib.beat.pulse`).
- **Sound design on about one action in five**: the important arrivals (a whoosh on the title, a tick on each
  list item, a soft hit on the number). Synthesized audio assets (`sfx-whoosh`, `sfx-pencil`, `synth-note`,
  drums), placed on an `sfx` track at a modest `gain` (0.3 to 0.5), a few frames before the visual lands.
- **A voice sets the clock**; the music ducks under it (`duck: { by: 18, attack: 0.15, release: 0.45, hold:
  0.25, source: 'words' }`) and comes back between phrases.
- **Loudness** is a composition setting, `{ target: -14, truePeak: -1 }`; the render reaches it on the
  encoded file and reports how. `audio_report` before rendering: the music 16 to 20 LU under the voice, no
  silence over 1 s, no clipping.

## 8. Shapes

- Design the primary shape fully; the others are laid out again from the same composition with
  `formats.<shape>` overrides, never cropped. The assets re-flow from `f.width`, `f.height`, `f.safe`.
- Vertical: stack what was side by side; the upper two thirds is the stage (the platform UI covers the rest);
  bigger type, fewer words per line (20 characters).
- Square: the middle band; one thing at a time; captions at the bottom edge of safe.
- Horizontal: room for a side-by-side (a screen and its labels); captions at 32 characters.
- An item that cannot be made to fit in a shape is hidden there (`formats.<shape>.hidden: true`) and its job
  given to another element, rather than shrunk under the floor.

## 9. The two frames that matter most

- **The first frame** is never empty: the viewer decides in one second. The opening is readable within 1 s:
  the headline is in (or arriving fast) on a background that already has its look.
- **The last frame holds at least 2 s** (a `hold` marker), with the call to action, the name and the URL, and
  nothing moving but a drift. `end-card` with `plate: true` is in within a second and then still.

## 10. A checklist to run on every beat

Before you move to the next beat, look at three stills (start, middle, settled) and a strip across its cut:

- [ ] One focal point; the accent is on it and only on it.
- [ ] Entrances eased out and staggered; exits eased in; the next element starts before the last settles.
- [ ] The cut into this beat has a carrier; the strip shows no empty, flat or popped frame.
- [ ] Nothing frozen: a drift or a breathing element on the hold.
- [ ] Text is on the grid, inside safe, above its floor, on a plate where the background is busy, read for
      `words / 3 + 1` s; the key word is marked.
- [ ] Depth: plate, shadow, sheen or glow where the beat needs it; grain on the gradient.
- [ ] Sound: a music bar on the cut; an sfx if this is one of the five important actions.
- [ ] Each other shape: looked at with `format`, overrides where needed, nothing under the floor.
