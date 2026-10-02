# <project>: project facts for the goal loop

What the goal-loop skill needs to know about this repository. The protocol is in the skill; this file
says how to check, run and look at **this** code. Keep it short and true, and fix it when you learn otherwise.

```bash
S=<goal-loop skill directory>/scripts    # generic: gates.sh, sweep.sh, cdp.mjs, pdfpng.swift, montage.swift
P=.claude/goal-loop                      # this repo: project.md, gates, screens, serve.sh
```

Set `TMPDIR` to your scratchpad so logs, data and screenshots stay out of the repo.

## Kind

- **UI:** web | none. With `none` there are no screens, sweep or viewports; "run it" means the
  CLI, API or library, exercised for real.
- **Browser:** headless | chrome | both. Headless (`cdp.mjs`, `sweep.sh`) for the sweep and the
  evidence; Claude in Chrome for workflows that need a real window (see the skill).

## Gates

```bash
$S/gates.sh            # runs $P/gates: one PASS/FAIL line each, exit 1 on any FAIL
```

- How tests are found (a glob? a directory?), so a new test file actually runs. Check that the test count
  goes up when you add tests.
- The test style to follow: <framework>, see `<an exemplary test file>`.
- Warnings that count as findings even though the gate passes.

## Running it for verification

```bash
$P/serve.sh fresh 8791 "$TMPDIR/data"    # build, empty data, start on its own port
$P/serve.sh stop 8791
```

- The user's own dev server and data, which you never touch: <ports, data paths>.
- URLs worth knowing, and how to create test data reproducibly (an API, a seed script, fixtures).
- No UI: the commands, requests or example scripts that exercise it, and where their output goes.

## Screens and viewports

```bash
$S/sweep.sh http://127.0.0.1:8791 "$TMPDIR/sweep" [<id> …]    # every screen in $P/screens
node $S/cdp.mjs shot "<url>" out.png --size 390x844 --mobile [--dark] [--full|--scroll] --js "…"
```

- Viewports to cover: 1440×900 desktop, 390×844 phone; 820×1180 tablet and `--dark` when layout is
  part of the goal.
- Selectors and recipes for the interactions that matter (how to type into a controlled input, open a
  menu, wait for data).
- Workflows better checked in Claude in Chrome (drag, drawing, uploads, long flows), if any.
- Print checks, if the app prints.

## Where things live

```
src/…    <one line per top-level area>
```

- Cross-cutting changes and every place they touch (e.g. "a new field type touches the model, the API
  schema, the form renderer and the docs").

## Showcase and evidence

- How to make the showcase reproducible here (a template, a seed, an example script).
- Committed evidence goes in `docs/showcase/<slug>/`, with an `INDEX.md` mapping each contract item to
  its files. Loop screenshots stay in the scratchpad.
- Finished PROGRESS.md files move to `docs/progress/<YYYY-MM-DD>-<slug>.md`.

## Conventions

- Commit style: see `git log`.
- Language and runtime versions, strictness, and the rule for new dependencies (a reason in **Decisions**).
- Tone of UI text and docs.
