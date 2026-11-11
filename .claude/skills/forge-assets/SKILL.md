---
name: forge-assets
description: Grow Fablecut's asset library ahead of the clips that will need it, through the `studio` MCP tools. Finds what the library lacks, fills each gap the cheapest way (a preset of an existing asset found with asset_variants before new code), saves every piece as a forge candidate, checks it alone in every format with check_asset, and promotes only what passes and is worth keeping (rejecting the rest with a reason). Use it whenever the user asks to forge, stock, grow, fill or pre-build the library, to make assets (not a video) for future clips, to explore looks or variants of an asset, or to review, check, promote or reject forge candidates, or runs /forge-assets.
argument-hint: "<area or briefs to forge for, e.g. 'lower thirds and stat cards for product teasers'> [how many pieces, default 6]  |  review"
---

# Forge assets

What to forge for:

<brief>
$ARGUMENTS
</brief>

You stock the library of Fablecut (the studio in this repo) with assets that future clips will reach for. You
drive it through the `studio` MCP tools (`mcp__studio__*`). The deliverable is a few promoted, checked assets that
fill real gaps, each with notes and a working param set, plus a short report. **Volume is not the goal.** Every
asset you leave in the library competes in `suggest_assets` with assets that earlier clips proved; a weak one makes
the next clip worse. Fewer, better, reusable.

Call `studio_guide` once (the asset contract, the cookbook, the forge workflow, and "Library now"; where it and
`src/` disagree, `src/` wins). Read `.claude/skills/new-video/references/new-assets.md`: the ladder, the
conventions of a reusable asset, the skeleton. Read `craft/TASTE.md` in the repo: the owner's taste holds here too.

## 0. Read the brief

- **Empty** → forge for the library's biggest gaps (step 1 finds them), 6 pieces at most.
- **`review`** → skip to step 4 with what `list_candidates` shows.
- **An area or briefs** → forge for those. A count in the brief caps the run; the default is 6 pieces, never more
  than 12 in one run.

## 1. Find the gaps

1. `list_candidates` and `list_candidates { stage: "rejected" }`: what is already waiting, and what was tried and
   why it failed (the notes). Do not make a rejected thing again unless you fix the reason it was rejected.
2. `search_assets { facets: true, limit: 1 }`: what kinds, tags and formats the library has, and how much of each.
3. For each brief a future clip is likely to have (from the user's brief, or from the clips in `list_clips` and
   what they were about), `suggest_assets { brief }`. A gap is a brief where the suggestions are weak: nothing of a
   kind the clip needs, only one shape (horizontal) where vertical is common, nothing that holds long text.
4. Write the plan in your reply before building: each gap in one line, and how you will fill it (step 2). Stop and
   ask only if the brief is ambiguous enough that the plan could go two very different ways.

## 2. Fill each gap, cheapest first

Every piece is saved with `candidate: true`, so it stays out of search and suggestions until it is promoted.

| the gap | do this |
|---|---|
| an existing asset almost fits, with other params | `asset_variants { ref, vary: { param: [values] } }` (or `variants`, `seeds`), look at the grid, then `create_preset { base, name, params, candidate: true }` for each look worth keeping |
| an existing asset fits but lacks a param | `fork_asset { ref, name, source, candidate: true }`: a sibling with lineage (improving the original with `update_asset` changes the library for everyone: only with the user's go-ahead) |
| nothing in the library can draw it | `validate_asset` until the filmstrip is right in two shapes, then `create_asset { name, source, candidate: true }` |

Write new code to the conventions in `new-assets.md`: sizes from the frame's short side, text inside `f.safe` with a
size floor, params with good defaults, a description that says what it is and when to use it, tags a search would
use. Do not write candidates' source into `assets/` yet: `npm run sync-assets` would put them straight into the
library on a rebuild (step 5 brings in the promoted ones).

## 3. Check every candidate

1. `check_asset { ref }` with its defaults, in every format it declares (or all three).
2. Again with the params a clip will push it to: the longest text it claims to hold, a light colour on light, the
   extreme of each number param. A piece that only passes with its defaults is not done.
3. Fix what the checks find with `update_asset` (a new version keeps the candidate stage), and check the new
   version: a promotion reads the check of the **latest** version.
4. Look at it too: `render_asset_frame { ref, sheet: true }` in the shapes it is for. The checks catch broken
   text, not a dull piece. Judge it against `craft/TASTE.md`.

## 4. Decide

- **Promote** (`promote_asset { name }`) what passes its checks, fills a gap from step 1, and is good enough that
  you would pick it for a real clip. Then `add_asset_note` with what it is best for and a param set that works.
- **Reject** (`reject_asset { name, reason }`) duplicates of what the library has, pieces that do not pass after two
  rounds of fixes, and pieces that pass but are dull. The reason is kept as a note: write it for the next run.
- Never `promote_asset { force: true }` on your own judgment: only when the user asks, with their reason.
- Leave a candidate pending only when it needs something only the user can give (a logo, a brand colour), and say
  so in the report.

## 5. Bring the promoted ones into the repo

For each promoted asset: `npm run sync-assets -- --pull <name>` writes the library's source to `assets/`, so the
repo can rebuild it. Presets too (the studio wrote their source). Run `npm run lint` if you wrote any file by hand.

## 6. Report

A short table, then one line on what the library still lacks:

| asset | what it is for | how | formats | result |
|---|---|---|---|---|
| `lower-third-wide@1` | name and role over footage, long names | preset of `lower-third` | all three | promoted |
| `stat-card-glow@2` | a number with a glow | new code | horizontal, square | rejected: same as `stat-trio` |

Say "checked" for what `check_asset` measured and "viewed" for what you looked at in stills. Never say an asset
"looks great" without a still you looked at.
