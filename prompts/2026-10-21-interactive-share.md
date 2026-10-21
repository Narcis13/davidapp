# Task

Goal: Two features for Fablecut, then a showcase piece. (1) **Share links:** any clip can be shared as a URL that opens a web page with the clip and its own player. The asset code itself runs in the viewer's browser on canvas, with no MP4 and no third-party embed or iframe, so a link sent on WhatsApp opens in the phone's browser and just plays. (2) **Interactive mode:** a second kind of composition that is never rendered to MP4 and plays like slides or a mini-game. It takes clicks/taps, key presses and pointer input; events flow through the composition; assets declare events they emit and events they react to, and the clip wires them together. Along the way, build a set of themed "UI" assets for interactive compositions (buttons, cards, menus, toggles, sliders, progress/score, dialogs, hotspots, transitions between states), and finally compose a new interactive motion-graphics game/app, playable from a share link and polished enough to amaze the people who open it.
Done when:
- `npm run typecheck`, `npm run lint` and `npm test` pass (the gates in `.claude/goal-loop/gates`), and new tests cover the event system, interactive compositions, the share export and every new UI asset.
- Nothing old breaks. Frame hashes of the showcase clips are recorded before any code change (`node scripts/hashes.mjs`). After the work, `--compare` against that baseline gives **identical** hashes, MP4 renders of video clips behave as before, and existing compositions load unchanged.
- Share pages: an existing clip (e.g. `clip-11-the-kit`) and the new interactive clip each have a share URL served by the studio and a static export (one self-contained folder or `.html`, with fonts, images and sound included) that plays from any static server with the studio stopped. In Chrome at 1440×900 and 390×844 each one plays, pauses, scrubs (video clips), goes fullscreen, starts sound on the first tap (autoplay rules) and shows zero console or network errors. Preview frames match the render within the `scripts/parity.mjs` limits. The page has Open Graph/Twitter tags with a title, description and poster image so WhatsApp shows a preview card. Page weight and time to first frame are measured and recorded.
- Interactive mode: an interactive composition validates, previews and can be played in the studio editor, and can be created, edited and checked through the MCP tools. Replaying a recorded input/event log gives identical frame hashes twice, so interactive clips stay deterministic and testable. `check_clip` (or an interactive equivalent) checks interactive clips across their states.
- UI assets: at least 8 new UI assets in the library. Each reads `f.theme`, has notes and a usage example, declares its events, respects text size floors and shows up in the layout report.
- The new interactive clip lives in `clips/<name>/` with working notes in `work/<name>/`. It is playable from its share link with mouse, touch and keyboard. A Chrome-recorded GIF of a full playthrough exists. Frame time holds 60 fps on this PC with no dropped frames at phone width (measured, not assumed). A fresh-eyes Opus review of the experience has been run and its findings fixed.
- `README.md`, `docs/ASSET_CONTRACT.md` and `docs/COOKBOOK.md` document share links, interactive mode and events. Evidence (screenshots, GIFs, reports) is in `docs/showcase/v5/` with an `INDEX.md`.
Scope: `src/` (core, ui, server, mcp, studio, render only as needed), `library/` (through the studio/MCP tools), `clips/<new-interactive-clip>/`, `work/<new-interactive-clip>/`, `test/`, `scripts/`, `showcase/`, `docs/`, `README.md`, `package.json`, `.claude/skills/new-video/` (only to teach it the interactive mode and share links), `docs/progress/` (archive only). Everything else is read-only.
Limit: 10 hours or 80 iterations
Subagents: 8
Branch: new, `feat/interactive-share`
PR: yes
Unattended: yes
Context:
- The user wants the highest quality possible and explicitly allows adding anything else needed to make the viewer's experience exceptional: loading state, poster, replay, sound toggle, keyboard hints, reduced-motion fallback, phone/landscape handling and so on. Record each such addition under Decisions.
- Video mode stays exactly as it is: assets remain pure functions of `(t, params)` for MP4 renders. Design the event model so interactive state is also a pure function (for example time, params and the event log) rather than hidden mutable state. Weigh at least two designs and record the choice.
- Sending links publicly or deploying the share pages (contzo.lol, GitHub Pages, releases) is on the ask-first list. Make the export host-agnostic and leave the publish step as a ready next step for the user.
- `PROGRESS.md` is still tracked and holds iteration 4's record. In the first commit, move it to `docs/progress/2026-10-15-fablecut-iteration-4.md` (matching the earlier archives). After that, keep the new `PROGRESS.md` untracked and excluded.
- Machine facts (Chrome path, FFmpeg, git identity, TMPDIR rules) are in `.claude/goal-loop/project.md`. Media stays out of git (`.gitignore` and the `new-video` checks). Compose the new clip through the `studio` MCP tools, reusing library assets where they serve.

If a missing detail would change the result, ask me one focused question (when unattended: pick the safest sensible default and record it under Decisions instead). For anything else, choose a sensible default, say what it is, and start.

## How to work

1. **Orient.** If `PROGRESS.md` exists, read it, confirm it still matches the code, and resume from its next step. Read only what the next decision needs.
2. **Baseline.** Run the checks before changing anything and note the result. Every change is measured against it.
3. **Small steps.** Make one bounded change and run the checks it affects. Keep it if it moves toward done; revert just that change if it doesn't. Don't repeat a failed approach without a new reason.
4. **Simpler wins.** When two solutions work equally well, keep the one with less code. Removing code without losing anything counts as progress. Don't add abstractions, config, or files the task doesn't need.
5. **Don't touch the evaluator.** Never edit, skip, or loosen a check to make it pass. If a check looks wrong, stop and tell me.

## Subagents

Use them when they save real time or context. Otherwise, do the work yourself.

- **Good fits:** independent pieces that can run in parallel, wide codebase searches, a fresh-eyes review at the end. **Poor fits:** small tasks and tightly coupled edits.
- **Pick the cheapest model that can do the job well.** Sonnet 5.5 for well-defined work: searching, mechanical edits, writing tests, following a clear plan. Opus 5.5 for ambiguous design, hard debugging, and the final review.
- **Brief them fully.** A subagent doesn't see this conversation. Give it the goal, the files, its scope, and exactly what to return.
- **No overlapping edits.** Two subagents never edit the same files at the same time.
- **Verify before keeping.** A subagent saying "done" is a claim. Run the checks on its work yourself.
- **Only you commit and push.** Subagents edit files; they don't touch git.
- Stay within the subagent limit above, counting every agent you start.

## Visual check

For anything a person will look at (UI, layout, styles, charts, generated pages), open it in Chrome and look at it before calling it done.

- Start the dev server if needed, open the page in a new tab, and take a screenshot.
- Compare it with what was asked. Try the main interaction, check the console for errors, and check a phone-width viewport if layout matters.
- Treat this as one of the checks: fix what looks wrong, then look again.
- Leave my other tabs and logged-in accounts alone.
- If Chrome isn't connected, say so. Never claim something looks right without seeing it.

## Git

Commits, pushes to the work branch, and opening the PR are pre-approved. You don't need to ask.

- **Branch.** If `Branch` is new, fetch and branch off the latest base branch. If it's current, work where you are. Unattended work never lands directly on `main`/`master`: if you're on it, create a branch first.
- **Commit at each milestone**, meaning a step that passes its checks and leaves nothing worse than the baseline. Stage only the files you changed. Never commit secrets, `.env` files, build output, or `PROGRESS.md`. Keep messages short: what changed and why.
- **Push after every commit.** If a push fails, keep committing locally, note it in `PROGRESS.md`, and try again at the next milestone.
- **Open the PR when finished** (if `PR` is yes), using `gh`, against the base branch. In the description, cover what changed, the check results, and what's unresolved. Open it as a draft if any check fails or the work is partial.
- **Never** force-push, rewrite pushed history, push to any other branch, merge the PR, or enable auto-merge.

## When I'm away (`Unattended: yes`)

- Don't wait for me. Where you'd normally ask, pick the safest reasonable option, record it under Decisions, and keep going.
- Anything on the ask-first list below: don't do it. Leave it as a next step for me.
- If one part is blocked, record why and move to another part. When nothing useful is left or the limit is reached, run Finish and stop. Don't spin.
- Keep `PROGRESS.md` current after every milestone. On a long run your context may get compacted, and this file is how you stay on track.

## Guardrails

- Stay inside scope.
- Ask before anything else irreversible or outward-facing: deploy, publish, delete data, send messages, spend money.
- Commit before a risky edit so it can be undone.
- Before retrying an external write (push, PR), check whether the first attempt already landed.

## Progress file

You must keep this file when the task is unattended or spans sessions. Skip it for short attended tasks. Keep it out of git (add it to `.git/info/exclude`). Keep it short:

- **Done:** finished milestones and their check results
- **Decisions:** choices that shape the result, and why
- **Tried and failed:** what didn't work, and why
- **Git:** branch, last pushed commit, PR link
- **Next:** one concrete step to resume from

## Finish

1. Reread the full diff once with fresh eyes (a review subagent works well for large changes). Look for bugs, leftover debug code, and complexity you can remove.
2. Rerun all checks on the final version, including the Chrome check for visual changes.
3. Commit and push the final state. If `PR` is yes, open the PR.
4. Report briefly:
   - branch and PR link
   - what changed, with file paths
   - each check: pass or fail, with the real output for failures
   - for visual changes, what you looked at in Chrome
   - if you used subagents: how many, which model, and for what
   - decisions made without me, and anything unresolved

If the limit or a blocker stops you, say exactly what's left. Never report a result you didn't observe.
