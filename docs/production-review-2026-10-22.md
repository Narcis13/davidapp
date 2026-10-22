# Production review, 22 October 2026

Review of the Fablecut studio (this repo) for bugs, security gaps, and rough edges that would matter on a machine other people can reach. It ran in two passes on the same day. The first pass (the sections up to "Left as they are") was committed in `f22b86a`. The second pass, which also covers share links, interactive clips and the documentation, starts at [Second pass](#second-pass); its fixes are in the working tree and are not committed.

The studio stays a local app. Loopback (`127.0.0.1`, `localhost`, `::1`) still opens with no token. Any other `HOST` refuses to start until `STUDIO_TOKEN` is set to at least 16 characters. The sign-in cookie is `HttpOnly`; the first pass made it `SameSite=Strict`, and the second pass changed that to `SameSite=Lax` (see [Share links on a studio with a token](#share-links-on-a-studio-with-a-token)). It is not marked `Secure`, because the server speaks HTTP.

Checked on the tree of the first pass:

- `npm test` — 499 passed, before the sign-in `connect-src` line and the type-only fixes below. The suites that cover those later edits were run again afterwards (HTTP, interactive, isolate): 35 passed.
- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx eslint` on every file this review changed — clean.
- In the browser, a temporary studio on `127.0.0.1:8791` with a token: the sign-in page rejected a wrong token, accepted the right one, opened the library, and the Clips screen showed its empty state. That server and its data directory were removed after the check.

## Asset source could compile new code

The preview worker and the share-page player built asset source with `new Function` and hid names such as `fetch` and `Function`. A constructor chain (`({}).constructor.constructor(...)`) still reached the real `Function`, and that function does not see the hidden names. On the share page and in the preview, that code runs on the studio's own origin. In Node, `vm` already refused generated strings, but a canvas method passed into `render` is a host function, and its `.constructor` is the outer `Function`.

`src/core/isolate.js` is the browser evaluator. It replaces the constructors that compile strings, rejects `import()` and `eval()` in the source (including a unicode escape such as `\u0028`), and keeps `Math.random` and `Date.now` unavailable. The preview worker and the player worker both call it. `eval` cannot be a strict-mode parameter name, so a call to it is rejected by that scan instead of being shadowed.

`src/render/host.js` evaluates inside the vm in strict mode, defines `asset` and `console` inside the context, and poisons the same constructors there. While an asset's `render` or `preview` is on the stack, the outer `Function.prototype.constructor` is a function that throws, so a host method cannot be used to compile a string. It is restored when the outermost asset returns. `codeGeneration: { strings: false, wasm: false }` stays in place for a constructor the realm will not let us replace.

Checked: `test/isolate.test.js` (a normal asset still returns its value; a constructor chain throws in Node and in a worker thread that runs the browser evaluator; a host `fillRect` cannot return `process.pid`; a unicode `import()` is rejected before it runs; `Math.random` and `eval` stay unavailable). Parity tests still match the browser preview to Node. A share export now includes `core/isolate.js` and `core/static-check.js`, and every relative import in that folder resolves (`test/share.test.js`).

## Clip edits could write `Object.prototype`

`update_item`, markers, transforms, and variable patches copied caller keys with assignment. A JSON object can carry `__proto__` as its own field, and assigning that key runs `Object.prototype`'s setter.

`src/studio/clips.js` drops `__proto__`, `constructor`, and `prototype` before it copies a patch. Checked: `test/http.test.js` builds those keys with `Object.defineProperty`, edits a clip, and `Object.prototype` is unchanged. The item's own fields still update.

## An interactive send could do the same

A variable, scene, or item id of `__proto__` matches the name pattern (it starts with `_`). A `send` to an item with that id did `inbox[id] ??= {}`. On an ordinary object that read returns `Object.prototype`, and the next write landed on it.

Composition checking now refuses `__proto__`, `constructor`, and `prototype` as a track id, an item id, a variable name, a scene id, or a send event. At runtime, variables, the change map, the key map, and the inbox are null-prototype objects, so a clip saved earlier cannot reach the setter either. Checked: `test/interactive.test.js` (the reserved names are errors at the right paths, and a hand-built `send` to `__proto__` stores the message on the state and leaves `Object.prototype` alone). The rest of that file still passes, including a full play of a game clip.

## A failed share frame could be reported as success

Frame writes used a pool that dropped a promise once it settled, including when it rejected. `Promise.all` of what remained could succeed with a WebP missing.

`createWritePool` in `src/studio/share.js` keeps the first failure and `join()` throws it after the in-flight work finishes. Checked: `test/share.test.js` (a pool whose encode rejects still rejects from `join`, and a pool of successful writes joins cleanly). The export test still builds a folder that plays from relative URLs.

## A studio on the network was open

`HOST` other than loopback used to answer every `Host` with no secret. Anyone who could reach the port could use the API.

`src/server/index.js` exits if `STUDIO_TOKEN` is shorter than 16 characters, and if the bind address is not loopback and no token is set. `createStudioServer` throws the same way, before it starts timers. With a token, `/api/session` checks it in constant time (SHA-256, then `timingSafeEqual`) and sets the cookie. Other routes answer 401 until the cookie or `Authorization: Bearer` matches. The sign-in page is the only HTML served before that.

The first sign-in page policy was `default-src 'none'` without `connect-src`. The page's `fetch` of `/api/session` was blocked, and the form said the server was unreachable. The policy now allows `connect-src 'self'`. Checked in the browser: a wrong token shows "That token was not accepted.", the right token opens the library, and Clips loads. `test/http.test.js` checks the login HTML, the `connect-src` header, 401 on `/api/status`, 403 for a wrong token, and 200 with the cookie and with a bearer token. A short token and a wide-open host with no token both throw.

## A symlink in the media folders could point at other files

File serving checked that the path string stayed under the folder. A symlink inside `thumbs` (or the other media dirs) could resolve outside it.

Serving now resolves the real path of the file and of the root, and refuses the response when the file is outside (case-folded on Windows). Checked: `test/http.test.js` links `thumbs/leak.json` at `package.json` and `GET /media/thumbs/leak.json` is 403 with no `dependencies` in the body.

## The studio page could be framed

The shell is now sent with `frame-ancestors 'none'`. The preview worker compiles asset source, so the shell does not get a `script-src` that would forbid that. Share pages stay embeddable. SVG assets opened as files still get a sandbox policy. Every response from `send` and `file` sets `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. Checked: the static-file test in `test/http.test.js` matches `frame-ancestors 'none'` on the shell and `nosniff` on the shell and on `/api/status`.

## A footage upload could be a plain-text body

The footage route trusted the file extension and accepted any content type, which is the shape of a cross-site form post. The origin check was already there. The body now has to be `video/*` or `application/octet-stream`; anything else is drained and answered 415. Checked: `POST /api/footage?name=notes.mp4` with `text/plain` is 415.

## A Windows `.cmd` shim expanded `%`

`commandFor` quotes a `.cmd` / `.bat` path for `cmd.exe`. `%VAR%` still expands inside those quotes. Percent signs in the path and the arguments are doubled before quoting. Checked: the existing "how the CLI is started" test in `test/requests.test.js` still passes on this machine.

## A render-queue failure was swallowed

`tick().catch(() => {})` hid a queue error. Those rejections now log `ERROR render queue:` with the stack. A client that disconnects mid-response (`ECONNRESET`, `EPIPE`, and the premature-close / destroyed stream codes) is not logged as a server error. An `uncaughtException` is logged and the process exits 1. An `unhandledRejection` is logged and the process stays up. The render and request tests still pass; there is no separate test that forces the queue to throw.

## Left as they are

- Loopback does not require a token. Set `STUDIO_TOKEN` if the port is reachable from somewhere else.
- The sign-in cookie is not `Secure`, because the server is HTTP.
- Share pages can be embedded. The studio shell cannot.
- Asset isolation is the constructor poison, the source scan, and Node's refusal to generate strings. It is not a separate isolate runtime.
- An unknown licence is still not redistributable, and a final render still refuses placeholders and unlicensed files. That behaviour was already in place.

## Second pass

The second pass looked at what the first did not reach: the share-link pipeline (export, the page, the player and its worker), the interactive runtime (the fold of scenes, variables and wires, hit testing, the crawler, `play_clip`), the studio services and the MCP server (paths, child processes, the render queue, shutdown), the server entry point, and the studio UI's HTML sinks. Three reviewers read those areas in parallel and every finding was checked against the code before anything changed; most were reproduced with a short script first.

How the fixes were checked:

- Every defect fixed below that can be tested in Node has a regression test. The new tests were also run against the code before this pass (a worktree of `f22b86a` with the new test files copied in): every one of them failed there, and all pass now.
- `npm test`: 499 passed before this pass; 510 pass on the final tree (499 and 11 new tests), 0 failed, 0 skipped.
- `npx eslint .` and `npx tsc -p tsconfig.json --noEmit`: clean. `npm audit`: 0 vulnerabilities.
- In the browser (a studio on `127.0.0.1:8791` over a snapshot of the library in a scratch folder, never the running studio or its data): the new Share dialog of a video clip and of an interactive clip, an export with a refused and an accepted base URL, the manual's new pages.
- Clip 12 played in headless Chrome by `scripts/play-check.mjs` with its recorded keyboard steps, on the live page of the old code, the live page of the new code and a fresh export served by `serve-static.mjs`: every `expect` step passed, 0 console or network problems, and the same states, score and frames on the old and the new code.

### A region drawn at scale 0 caught every tap

`f.ui.hit` recorded the region with the canvas transform, and hit testing inverted that matrix with `det || 1e-12`. A transform of scale 0 maps every point of the frame onto the region's origin, so a tap anywhere fired the item: an item with `transform: { scale: 0 }`, or a pop-in keyframe on its first frame, took presses meant for the rest of the frame.

`src/core/runtime.js` adds no region when the (rounded) matrix is singular, and its `toLocal` and `f.ui.pointer` report no position there. `src/core/interactive.js` treats a region with a singular matrix as outside every point, and a range under one keeps its value. Checked: `test/interactive.test.js` "a region drawn at scale 0 is not hittable" (no region is drawn; a tap on a region with a singular matrix is a tap on nothing).

### The null-prototype maps were lost after the first copy

The first pass made the session's variables, change map, inbox and pressed map null-prototype. `advance`, `applyInput` and the crawl copy the state with `structuredClone`, which hands back ordinary objects, so from the second frame on, an item or variable named `toString` read `Object.prototype.toString`: a `send` to it wrote a property onto that shared function and the item never heard the event.

`cloneState` in `src/core/interactive.js` copies a state and makes those maps null-prototype again; the fold and `atRest` in `src/render/frame-worker.js` use it. A `send` checks `Object.hasOwn` before it reuses a box, and `f.ui.since`, `f.ui.received` and `f.ui.changed` read only own keys (a state that came through `postMessage` has ordinary objects too). Checked: "an item called toString gets what is sent to it" (two sends, two counts, every map still null-prototype, `Object.prototype.toString` untouched).

### A restart reached through another scene passed the save, then the clip could not start

Validation refused a restart in a `start` wire or an `enter:<first scene>` wire. With `start → go b`, `enter:b → go next`, `enter:c → restart`, it passed; the first state then threw while it was being made, so neither the share page nor the editor could start the clip, and the crawl failed instead of reporting it.

The check now follows the scenes the start wires `go` to (through `next`, `if` branches and further `enter:` wires, respecting each wire's `scene` filter) and refuses a restart in any of them, naming the wire. Checked: "a restart the start wires reach through another scene is refused" (the error names `interactive.wires[2].do`; the same restart behind a press still saves).

### Variables could become NaN, and wrap was wrong for fractions

`add: { score: 'abc' }`, `set: { score: 'ten' }` followed by an `add`, and `min: 5, max: 4` with `wrap` all produced NaN. `wrap` always used `max - min + 1`, so 0.9 + 0.2 between 0 and 1 gave 1 instead of 0.1.

A save now refuses an `add` amount that is not a number (or a `$var` of a number variable, or the event's value), a `set` literal or `$var` whose type differs from the variable's first value, and `min` above `max`. At run time a value from an event that is not a finite number leaves the variable alone, `add` skips a non-number, and `wrap` uses `max - min + 1` only when the bounds, the value and the step are whole numbers, else `max - min`. Clip 12's own wires (which set numbers from `$value.combo`) still save. Checked: "variables never become NaN, and wrap works on fractions".

### The action budget was per frame, not per event

The 256-action budget that stops a wire loop was shared by every input event of a frame. Keys that piled up during a slow frame (129 presses of a two-action wire) stopped the clip with "do two wires trigger each other?". Each input event now starts with the whole budget. Checked: "each input event has its own action budget" (300 presses in one frame run; the existing wire-loop test still stops a real loop).

### Session time and input size had no bound

A log event at frame 1e9, a step `{ wait: 1e6 }`, or `frames: [1e9]` on the editor's HTTP play route kept a render worker folding frames until the 300 s timeout. The HTTP route also had none of `play_clip`'s array limits.

`src/core/interactive.js` sets the limits in one place (an hour of session time, 20,000 input events, 500 steps); `normalizeLog` and `stepsToLog` refuse anything past them, and `studio.play` checks the frames it is asked to report (at most 1,000, whole, within the hour) and the sizes of `steps` and `log` before any worker starts, so the HTTP route and the MCP tool share the bounds. Checked: "a log or steps past an hour are refused" and, over HTTP, `test/interactive-mcp.test.js` "the editor routes" (`frames: [1e9]` is 400, a log at frame 1e9 is refused with the reason).

### Scripted steps could make a log that does not replay

`stepsToLog` copied `{ down: { x: '5', y: 5 } }` and an unknown pointer name as given, while `normalizeLog` refuses the first and turns the second into `mouse`. `play_clip` replays its own log for stills, so such a call failed. Raw pointer steps now need numeric coordinates and an unknown pointer becomes `mouse`, as a replay reads it. Checked: the same test (a refused step, and a log from steps that `normalizeLog` returns unchanged).

### The share page and the editor read keys differently

The share page sent `Shift`, `CapsLock`, dead keys and function keys to the clip (pressing Shift fired a `key:any` wire) and dropped held keys except a focused slider's arrows; the editor dropped those keys and repeated every arrow. The same keystrokes recorded different logs, so a log copied in the editor did not replay what a viewer did.

`keyFor` in `src/player/session.js` is now the one rule: shortcuts with Ctrl, Cmd or Alt, modifiers and function keys alone, and a Tab that leaves the clip go to the page; a held key is one press except the arrows of a focused slider. `src/player/player.js` and `src/ui/lib/play.js` both call it. Checked: "the share page and the editor read keys by one rule", and clip 12's keyboard playthrough in headless Chrome (above).

### A re-export deleted files that were not the export's, and a failed one destroyed the last

`exportClip` deleted the whole target folder when it held an earlier export, so a `CNAME`, a `_headers` file or a `.git` folder added after publishing was lost on the next export. It also deleted the folder before encoding frames and sound, so an export that failed half way left no working page.

The export is now built in a staging folder next to the target; only when it is complete are the entries an export owns (`.fablecut-share`, `index.html`, `bundle.json`, `poster.jpg`, `og.jpg`, `player/`, `core/`, `media/`) replaced in the target, and everything else there stays. The staging folder is removed whether the export succeeds or fails. A non-empty folder with no earlier export is still refused, and the guard against exporting over the studio's own folders compares paths case-insensitively on Windows. The file and byte counts are the export's own. Checked: `test/share.test.js` "a new export replaces only what an export wrote, and a failed one leaves the last one whole" (a `CNAME` and `.git/HEAD` survive, a stale file under `media/` goes, a forced ffmpeg failure leaves the previous `bundle.json` byte for byte and no staging folder behind).

### A player that never started showed "Loading" for ever

If `player.js` never runs (the folder opened as a `file://` page, a link without its trailing slash on some hosts, scripts served with the wrong type), nothing could replace the loading ring. The page now carries a message that the stylesheet alone reveals after 15 seconds of loading ("Open it from its web address … and reload"), and a `<noscript>` line. Checked in the page template and its CSS (`display` is `none` once the player sets any state other than `loading`); the share tests that read the page still pass.

### One media hiccup ended playback

The player's worker failed a frame on the first non-OK answer or network error, and the clip stopped with no retry. Media fetches now try again after 0.4, 1.2 and 3 s on a network error or a 5xx, 408 or 429 answer; a 404 is final. Checked by reading the code path and by the share tests; there is no automated network-fault test.

### Smaller fixes in the player

- A seek made while the player waited for media was undone when the late frame arrived. The player now counts seeks and keeps the viewer's position.
- With reduced motion the poster covered the canvas until the first play, so seeking before playing changed only the time display. A seek now shows the canvas.
- An error in page-mode full screen hid the only control that leaves it. `fail()` now leaves full screen first.
- A font URL with `(` or `'` in its path (a folder published as `demo (final)/`) made an invalid CSS `url()`. It is quoted now.
- On an iPhone, Web Audio follows the silent switch. An interactive clip with sound sets `navigator.audioSession.type = 'playback'` where the browser has it.

These were checked by reading the paths through the player and in the browser; the existing share and parity tests still pass.

### Share links on a studio with a token

With `STUDIO_TOKEN` set, `/share/<clip>` answered a visitor who had not signed in with `{"error":"Sign in required"}` instead of the sign-in page, and the `SameSite=Strict` cookie was not sent when the owner opened the link from a chat app (a navigation from another site), so even the owner got that JSON.

A share page now gets the sign-in page; its `bundle.json`, the player and the media still answer 401. The cookie is `SameSite=Lax`, which sends it with a top-level navigation but not with a cross-site POST; writes from other sites are still refused by the Origin check and the JSON-only body. Checked: `test/http.test.js` "with a token, the studio is closed until the token is given" (the cookie says `SameSite=Lax`; `/share/demo` is the sign-in page without the cookie and the clip with it; `/share/demo/bundle.json` is 401).

### A share link to a missing clip was a JSON error

`/share/<a clip that is not there>` answered 404 with JSON. It now answers 404 with a short page that says there is no such clip, under a policy that allows no script. Checked: "a share link to a clip that is not there is a page that says so".

### The frame route drew a frame called NaN

`GET /api/clips/<clip>/frame.png?t=abc` asked the worker for frame NaN. A time that is not a number now draws the first frame. Checked: "a frame asked for at a time that is not a number is the first frame".

### The server started its database before checking its settings

`PORT=abc` crashed with a stack trace from `listen`, and a missing `STUDIO_TOKEN` for a network `HOST` was refused only after the studio had opened its database and started its render runner. `src/server/index.js` now checks `PORT` (a whole number from 0 to 65535), the token and the host first, and prints an IPv6 address in brackets. Checked by running it: `PORT=abc` and `HOST=0.0.0.0` without a token both exit 1 with one line that says what to set.

### FFmpeg decoders outlived the studio

The footage service keeps up to four FFmpeg decoders for the editor's preview. Neither the web server nor the MCP server stopped them on shutdown. Both now call `closeFootageService()` after `studio.close()`. `stopRunner` also stops waiting for a stuck render cleanup after 15 seconds, so a shutdown cannot hang on one (the job's heartbeat stops with the process and another runner marks it failed). Checked by reading the shutdown paths; the render tests still pass.

### "Run now" passed the studio's secrets to the claude CLI

The CLI was spawned with the whole environment, including `STUDIO_TOKEN` and `ELEVENLABS_API_KEY`, which it does not need. They are now removed from its environment; the rest (its own sign-in, `PATH`) is kept. The requests tests, which start the CLI path, still pass.

### The share CLI ignored `--name=value`

`node scripts/share.mjs clip --out=/x` dropped `--out` and exported over the default folder. The script now reads `--name value` and `--name=value`, and refuses an option it does not know. Checked by running it: `--outt x` exits 2 and lists the options; `--out=… --base-url=…` writes there with an absolute `og:url`.

### Video clips could not be shared from the studio

For a video clip, sharing was reachable only through `share_clip`, the HTTP API or the script; an interactive clip's Share button showed the live link only. The clip editor now has a Share dialog for every clip (`src/ui/lib/share.js`): the live link with Copy link and Open, a note when the clip has unsaved changes, and Export folder with an optional base URL, which shows the folder, its size, the link-preview address and any warning, and when it was last exported. An interactive clip opens the same dialog from its primary button, with the test ids and the "played in the browser" text the iteration-5 workflow expects. Checked in the browser on a video clip and on clip 12: a refused base URL (`ftp://…`) shows the reason, an accepted one writes 45 files.

### Documentation

- The manual (`/docs`) had no page about share links or interactive clips. It now has a "Share and play" group with **Share a clip as a link** (the dialog, what the viewer sees, what an export holds, publishing, re-exports, the scripts) and **Interactive clips** (scenes, variables, wires, sound, playing in the editor, the checks, determinism, limits, performance). The start page, the editor page, the Claude page, the scripts page, the glossary (hit region, input log, interactive clip, scene, share link, variable, wire) and troubleshooting (nine new questions) point to them. Settings has `STUDIO_TOKEN` and a section on opening the studio to other devices; the troubleshooting answer that told readers to bind `HOST=0.0.0.0` without a token is corrected, and the showcase counts say twelve clips. `test/docs.test.js` checks that search finds the new pages; every page still passes the Faqir UI audit and the link check.
- `README.md`: `STUDIO_TOKEN` in the settings table, 69 MCP tools with `share_clip` and `play_clip` in the table, the security paragraph rewritten (MCP-only path tools, the token, the isolation of asset code), the Share dialog and the manual in the studio table, and the share and interactive sections brought up to the behaviour above.
- `docs/ASSET_CONTRACT.md` (types and ranges of variables, restarts, limits, scale 0) and `docs/COOKBOOK.md` (re-exports) say the same.

### Checked and left as they are

- **HTML injection on the share page.** Every value the page template takes goes through one escaper (`& < > " '`), no JSON is put inside a `<script>`, and the template is filled in one pass. The studio UI builds every element with `textContent`; its four `innerHTML` uses are constant icon markup. Provenance URLs shown as links are validated as `http(s)` when they are saved.
- **Paths and processes.** Every tool that takes a file or folder path is MCP-only; the HTTP routes take slugs matched by `[a-z0-9-]+`. `import_clip` validates SHA-256, suffix and role before it builds a path. Every child process is spawned with an argument array; the one `shell: true` (a Windows `.cmd` shim) quotes and escapes its arguments and sends the prompt on stdin. Neither the ElevenLabs key nor the token is logged or returned.
- **The render heartbeat.** A runner marks a job failed when its heartbeat is 45 s old, and the heartbeat is a timer on the main thread. Mixing clips 6 and 7 (90 and 62 s) blocked the event loop for at most 108 ms, so a live render is not declared dead by the mix. `STALE_MS` is unchanged.
- **Caches.** The exchange's hash cache and the transcribe cache key are unbounded in principle but small in practice (one entry per file exported or transcribed); left as they are.

### Observed, not changed

- In headless Chrome without a GPU, the play-check bot caught 5 of clip 12's 55 notes, where `work/clip-12-tap-the-beat/README.md` reports 53 for the run of 21 October. The old code and the new code give the same 5 hits, score and frames on the same machine and library, so this pass did not cause it; the bot or the machine's timing is worth a separate look.
- A share export sets no cache headers of its own; a host that caches long can serve an old player with a new `bundle.json` after a re-export. The manual and the README say to purge the cache after exporting again.
