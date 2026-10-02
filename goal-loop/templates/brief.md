# Brief for /goal-loop

Pass the brief inline, or save it as a file and pass its path:

```
/goal-loop Feature: … Done: …
/goal-loop docs/briefs/offline-sync.md
/goal-loop resume
/goal-loop setup          # only write .claude/goal-loop/ for this repository, then stop
```

## Format

```markdown
Feature: <what to build, in your own words. Several features are fine; one per paragraph or bullet.
Mark the parts that need deep design with "ultrathink".>

Done means ALL of:
- <an outcome you can check, e.g. "a customer can export a document as .xlsx and open it in Numbers">
- <another one>

Constraints (optional): <things not to touch, dependencies to avoid, deadlines, a branch to use,
"check the drag-and-drop flows in Chrome">
```

You don't have to restate the standard gates. Every goal also has to meet these:

- every gate in `.claude/goal-loop/gates` passes (typecheck, lint, tests, build), and new logic has tests
- for a project with a UI: no console or network errors on any screen, at desktop and phone size
- a reproducible showcase that uses every new feature, verified the way the project's `project.md` says,
  with the evidence committed (by default under `docs/showcase/<slug>/`)
- PROGRESS.md kept current; a commit and push after each milestone; blockers written down instead of stopping

## Example

```markdown
Feature: Let a team share a board. An owner invites people by email; invited people see the board and
can comment, and only the owner can change cards. Ultrathink how invitations work without an email
provider configured. Tables on a board become cards per row on phones.

Done means ALL of:
- the features above work end to end, signed in as the owner and as an invited person
- a showcase board demonstrates every one of them, with no glitches or errors on desktop or phone
- the invite-and-accept flow is recorded as a GIF in Chrome
```
