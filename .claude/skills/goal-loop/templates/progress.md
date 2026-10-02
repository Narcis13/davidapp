# Progress

Goal: <one paragraph: the features, in the user's terms>

Started <YYYY-MM-DD> on branch `<branch>` at `<short sha>`.

**Next:** <the single next action; keep this current, since it is what a resumed session reads first>

## Contract (Done means)

| # | criterion | verified by | evidence | status |
|---|---|---|---|---|
| G1 | Every gate in `.claude/goal-loop/gates` passes (typecheck, lint, tests, build) | `gates.sh` | Log | open |
| G2 | Zero console/network problems on every screen at every viewport *(UI projects; drop otherwise)* | `sweep.sh`, Chrome console | Log | open |
| G3 | A reproducible showcase exercising every new feature, verified the way project.md says | sweep / Chrome / running it + reading the evidence | `docs/showcase/<slug>/` | open |
| D1 | … | … | … | open |

Status: `open` → `pass` (with evidence) or `blocked` (see Blocked).

## Milestones

1. [ ] **<name>**: <what it delivers> (D1, D2)
2. [ ] …
n. [ ] **Final audit**: clean build, empty data, all gates, full sweep (UI), every contract item checked

## Decisions

- <choice made where the brief was silent>: <why>. *(overrule if you disagree)*

## Blocked

- *(none)*. Use the form: **what** · why · what was tried · what would unblock it

## Notes

- <gotchas, constraints, things a resumed session must know>

## Log

- <YYYY-MM-DD>: baseline: <N> tests pass, gates <all pass / which fail>, sweep <0/N> problems.
