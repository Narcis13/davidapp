# goal-loop

A Claude Code skill for long autonomous build sessions. You give it features and a definition of done.
It turns "done" into a contract with evidence for every item, then loops
**implement → gates → run it → look at it → fix** until each item passes or is written down as blocked.
It keeps `PROGRESS.md` as its memory across context compactions, and commits and pushes after each milestone.

```
/goal-loop Feature: … Done means ALL of: …
/goal-loop docs/briefs/my-feature.md
/goal-loop resume
/goal-loop setup
```

The protocol lives in [SKILL.md](SKILL.md) and works in any repository. What's specific to one repository
lives in that repository, under `.claude/goal-loop/`.

## Install

Copy or symlink this folder to where Claude Code looks for skills:

```bash
ln -s "$PWD/goal-loop" ~/.claude/skills/goal-loop               # every repository on this machine
ln -s ../../goal-loop <repo>/.claude/skills/goal-loop           # one repository (relative link, commit it)
```

This repository (edgy) uses the second form: `.claude/skills/goal-loop` points at this folder.

## Per-repository setup

Each repository gets a `.claude/goal-loop/` folder:

| file | what it holds |
|---|---|
| `project.md` | kind of project (UI or not, which browser tooling), how to run it in isolation, screens, where things live, where evidence goes, conventions |
| `gates` | the gate commands `gates.sh` runs: typecheck, lint, tests, build |
| `screens` | the screens `sweep.sh` shoots, with their viewports (UI projects) |
| `serve.sh` *(optional)* | starts and stops an isolated instance with its own data |

You don't have to write these by hand. On the first run in a repository without them, or with
`/goal-loop setup`, the skill explores the code, writes them from [templates/](templates/), runs them to
prove they work, and commits them. Edgy's are in [`../.claude/goal-loop/`](../.claude/goal-loop/) as a worked example.

## What's in here

| path | |
|---|---|
| `SKILL.md` | the protocol: brief → contract → baseline → milestones → loop → showcase → final audit |
| `templates/brief.md` | how to write a brief, shown when `/goal-loop` runs with nothing to do |
| `templates/progress.md` | the starting `PROGRESS.md`: contract, milestones, decisions, blocked, notes, log |
| `templates/project.md`, `gates`, `screens` | starting points for a repository's `.claude/goal-loop/` |
| `scripts/gates.sh` | runs the repository's gates, one PASS/FAIL line each, with logs in `$LOGS` |
| `scripts/sweep.sh` | shoots every screen in the repository's `screens` file and fails on any console/network problem |
| `scripts/cdp.mjs` | headless Chrome over CDP: screenshots (phone emulation, dark mode, full page or per screenful), PDFs, scripted interactions, real key presses |
| `scripts/pdfpng.swift` | renders a PDF's pages side by side into one PNG (macOS) |
| `scripts/montage.swift` | puts screenshots side by side for evidence (macOS) |

## Looking at a UI: headless and Claude in Chrome

The skill checks screens two ways:

- **Headless** (`cdp.mjs`, `sweep.sh`): the default for gates and committed evidence. It's repeatable,
  emulates phones exactly, and fails on console errors.
- **Claude in Chrome** (the `mcp__claude-in-chrome__*` tools from the Chrome extension): for workflows
  that need a real window, like drag and drop, drawing, uploads, hover states and long multi-step flows.
  It can also record a workflow as a GIF for evidence. The skill opens its own tab against the isolated
  server, reads the console after each workflow, and falls back to headless if the extension isn't connected.

Choose per repository with the `Browser:` line in `project.md` (`headless`, `chrome` or `both`), or ask for
it in a brief ("check the invite flow in Chrome").

## Requirements

- Node 22 or later (`cdp.mjs` uses the built-in `WebSocket`) and Google Chrome or Chromium. Set
  `CHROME=/path/to/chrome` if it isn't found.
- bash 3.2 or later (works with the bash that ships with macOS).
- macOS for the two Swift helpers. Without them, `sweep.sh` still prints PDFs; it just doesn't render
  them to PNG.
- Optional: the Claude in Chrome extension, and the `feature-dev` plugin for its code reviewer (any
  reviewer agent will do).
