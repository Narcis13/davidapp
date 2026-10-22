# Production review, 22 October 2026

Review of the Fablecut studio (this repo) for bugs, security gaps, and rough edges that would matter on a machine other people can reach. Fixes are in the working tree. Nothing was committed.

The studio stays a local app. Loopback (`127.0.0.1`, `localhost`, `::1`) still opens with no token. Any other `HOST` refuses to start until `STUDIO_TOKEN` is set to at least 16 characters. The sign-in cookie is `HttpOnly` and `SameSite=Strict`. It is not marked `Secure`, because the server speaks HTTP.

Checked on the final tree:

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
