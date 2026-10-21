# Iteration 5 decisions: share links and interactive mode

The designs weighed and the choices made while building share links, interactive compositions, the UI kit and
clip 12, with the reason for each. The evidence for each is listed in [INDEX.md](INDEX.md).

## The event model (three designs weighed)

1. **Imperative handlers in assets** (`onClick() { this.score++ }`). Rejected: hidden mutable state that can't be
   replayed or checked without running it, and it breaks the pure `(t, params)` contract every other tool relies on.
2. **Per-asset reducers** (Elm style: each asset has `update(state, event)`, with state folded per item). Pure, but
   the state is scattered across assets, wiring between items needs a second mechanism, and every UI asset grows an
   init/update contract.
3. **Chosen: one state machine per composition, folded from a frame-stamped input log.** An interactive composition
   is a normal composition (its tracks are the *design timeline*, so every existing tool keeps working on it) plus
   `interactive: { start, vars, scenes, wires, transition }`. Scenes are time ranges of that timeline; the playhead
   moves through a scene and then holds, loops or goes on. Wires route events (`<item>.<event>`, `key:<key>`, `tap`,
   `start`, `enter:<scene>`, `end:<scene>`) to actions (`go`, `set`, `add`, `toggle`, `send`, `play`, `if`,
   `restart`). Params bind to variables with `{ "$var": … }`, and items show `when` a condition holds. Assets stay
   pure: they read the derived state through `f.ui` and declare hit regions with `f.ui.hit(...)` while drawing
   (immediate-mode GUI). Each definition declares `events: { emits, accepts }`.
   **State at frame n = fold(composition, the log's input events stamped before n).** An input event stamped with
   frame j is read against the hit regions that frame j drew (what the viewer saw), so the live player, which drew
   frame j, and a replay, which draws frame j again, agree exactly. The same log gives the same frames (tested by
   hashing a replay twice).

Other choices in the interactive core:

- **Hit regions recorded while drawing**, as a quad in frame pixels through the context transform, rather than
  hit-testing item boxes. A menu has several regions in one item, and rotated or scaled items are hit where they show.
- **Input timing:** an event is stamped with the frame being drawn (or the one on screen if none is pending). It is
  applied when the next frame is computed, against that frame's regions, so its effect shows from the next frame on.
  Region matrices are rounded to 1e-4 and pointer coordinates to 0.1 px, so Chrome and Skia agree unless a point
  lies within ~1e-4 px of an edge.
- **`{ disabled: true }` regions** report their state (a caught note) without being hittable.
- **Modal regions** (`f.ui.hit(..., { modal: true })`, used by ui-dialog's scrim) put everything drawn before them out
  of reach (no taps, focus or hotkeys), and check_clip skips the text behind them (it is dimmed on purpose). Chosen
  over guessing from a region's size, which would also catch a full-frame "tap to continue" layer.
- **A screen safe zone for interactive clips** (4 % of the short side). A share page shows the whole frame with
  nothing over it; the format's platform zone (13 % top, 21 % bottom on vertical) flagged the game's lane pads.
- **Scene transitions hold the scene they leave** as its last frame showed it (its own ui, recorded in the state when
  the scene changes), drawn once per transition rather than every frame of it.
- **Transition dims in whole 8-bit steps; clip 12's iris has no dim.** A near-zero alpha over a whole frame rounds
  one level apart in Chrome and in Node's Skia (frames 197/198 measured at mean 1.6, then 0.84 without the dim).
- **`$value.field` in wire values** (`{ "combo": "$value.combo" }`) so one event can carry several numbers. beat-lanes
  sends `{ lane, combo }` with each catch and keeps its own streak, so a stray press or a note let through breaks it
  without a second wire.
- **Video mode untouched:** `f.ui` is a lazy getter, so an asset that never reads it allocates nothing; compositions
  without `interactive` normalize exactly as before; MP4 renders refuse interactive compositions with a message
  saying they are played.

## Share links

- **A folder rather than one self-contained HTML file.** `index.html` plus the player, the core modules the clip
  needs, and its media, all with relative URLs, so it plays under any host and sub-path (checked with
  `serve-static.mjs --prefix`). One file would inline the media as base64 (a third bigger, never streamed, never
  cached between visits); clip 11's footage alone is 12 MB.
- **The player runs `src/core` in a Web Worker** on an OffscreenCanvas and shows each frame through a
  `bitmaprenderer` canvas. It is the same engine as the studio preview, which keeps parity with the Node render,
  and the main thread is left free for the clock and input.
- **Footage as WebP frames (q80)**, only the frames the clip shows, a repeated frame stored once. A `<video>` element
  isn't frame-exact (seek and `requestVideoFrameCallback` land near a frame, not on it), which parity with the
  render needs.
- **Sound.** A video clip plays the studio's own mix as one AAC through an `<audio>` element, which is also the
  clock. An interactive clip gets one AAC per audio item (that item mixed solo), played through Web Audio when the
  state cues it, so a hit sound follows the tap and the music follows the scene.
- **The sound starts at the viewer's first real activation** (`navigator.userActivation.isActive`; a touch
  pointerdown is not one), with the sound already decoded in an OfflineAudioContext. The context itself is made while
  the page loads and stays suspended with nothing started on it; the gesture resumes it (see "Measuring 60 fps" for
  why it is not made at the tap). The first time it runs, the music and timeline sound the clip asked for start at
  the offset they would have reached on the session's clock, which stands still while the page is paused, so a tab
  hidden before the first tap doesn't push the music ahead. A context that comes to run while the page is paused is
  held again; a pause later suspends it and play resumes it where it was, so the music never restarts.
- **Host-agnostic export:** `og:image` and `og:url` are relative unless `--base-url` is given (link previews such as
  WhatsApp's need them absolute, so publishing re-exports with the real URL). Nothing is published by the studio.
- **An export never overwrites a folder that isn't one:** a `.fablecut-share` marker is written first and checked
  before anything is replaced.
- **Frame canvas without `willReadFrequently`** unless the clip has a clip-level effect (the only thing that reads the
  frame back), so Chrome can keep it on the GPU.

## Measuring 60 fps

This PC's display hands a visible Chrome ~32 animation frames per second (also on `about:blank`), and headless
Chrome with its GPU on follows the display. So 60 fps is measured in **headless Chrome without a GPU**: a steady
60 Hz clock and software raster, which is the slowest drawing and stands in for a phone's worst case. `--headful` and
`--gpu` stay as options in `scripts/play-check.mjs`.

Measured over the whole visit (from the title, before the tap on Play), the first runs lost frames that a window
opened after the tap had hidden. Each cause was found with a Chrome trace (and timing marks in a copy of the export)
and fixed at its root, not in the measurement:

- **The AudioContext is made while the poster covers the frame, and resumed in the first gesture.** Made at the tap,
  its constructor held the main thread 33 ms (two frames). Made early it costs nothing at the tap, and Chrome logs
  nothing for it: only starting a sound or calling `resume()` before the viewer's activation draws the autoplay
  warning, and the page does neither. Resuming inside the gesture is also what WebKit needs. Tried first: listing the
  devices at load (33 → 8 ms) and making the context in the frame after the gesture (lost WebKit's gesture).
- **The frame a scene changes on shows the scene it leaves**, as held; the transition asset draws from the next frame.
  The first transition frame had rasterized both scenes (17–22 ms in software); now the held scene and the incoming
  one are paid for on two frames. For the iris, progress 0 was a 54 px disc with no ring: nothing a viewer loses.
- **The page warms each scene transition before it shows anything**, as it already warmed each scene: the asset's
  code and the layers it draws through exist before the viewer's first scene change.
- **A frame back just after its slot doesn't lose the next one:** when an animation frame comes while a frame is
  still being drawn, the clock's frame is drawn as soon as that one is back. At the tap, the worker drew its frame in
  7.5 ms but the reply reached the page 16.6 ms after the request (no task on the page's thread ran over 1 ms: it
  waited in the queue while the touch was handled), missing its slot by a fraction of a millisecond.
- **The session's clock is set between animation frames** and read from the animation frame's own time. On the
  second animation frame after a start or a resume (two give the refresh interval) the clock moves by half a frame at
  most so that animation frames come half a refresh after a frame of the clip begins: half way through it when the
  screen runs at the clip's rate, at a quarter and three quarters at twice its rate. With a frame boundary right at
  the animation frames, their jitter of a millisecond skipped a frame and showed the next twice, over and over, in the
  runs that happened to start in that phase (21 and 30 skips with no slow frame at all); at twice the rate it would
  hold frames one refresh and three by turns. Both cases are tests.

## Clip 12, "Tap the beat"

- **A rhythm game rather than a quiz:** it shows continuous motion, sound and precise input at once, and it is the
  kind of thing people send each other. Vertical, 60 fps; title (play, how to play, options), a 55-note song at
  120 bpm whose chart is built from the same tempo, and results with a rank and replay.
- **Accuracy counts stray presses** (`hits / (notes + strays)`) so mashing every key doesn't earn an S.
- **Escape doesn't quit the song** (it did in the first build): one press threw a run away, and in full screen the
  browser takes Escape to leave full screen anyway. Menu on the results card goes back to the title.
