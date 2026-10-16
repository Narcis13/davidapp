# new-video

A Claude Code skill for making a short video in Fablecut (this repo's studio) through its `studio` MCP tools:
brief → library first → look → script and clock → style frames (one stop) → build beat by beat → sound →
every shape → draft, checks, final → export and leave the library richer.

```
/new-video a 30 s vertical teaser for our launch, text and music, dark and punchy
/new-video docs/briefs/launch.md
/new-video resume launch-teaser
```

| file | |
|---|---|
| `SKILL.md` | the workflow |
| `references/craft.md` | what makes it look finished: motion, cuts, type, colour, layout, sound, shapes |
| `references/new-assets.md` | when to write a new asset and how to write one that the next clip can reuse |
| `references/checks.md` | every check, the tool that measures it, the number it must give |
| `references/voice-and-sound.md` | narration, word anchors, captions, ducking, loudness |
| `scripts/push-clip.mjs` | `clips/<slug>/compose.mjs` → the studio (create, sync assets, update, optionally render) |
| `scripts/check-no-media.mjs` | before every commit: fails if a picture, sound or video outside `library/` and `assets/` is staged |
| `templates/` | `compose.mjs`, `timing.mjs`, `script.json`, `NOTES.md` to copy into `clips/<slug>/` and `work/<slug>/` |

The repo's own conventions it builds on: `docs/ASSET_CONTRACT.md`, `docs/COOKBOOK.md`, `craft/CHECKS.md`,
`craft/TASTE.md`, `motion_prompt_fablecut.md` (the full gated process this skill is the lighter cousin of) and
the worked examples in `clips/` and `work/`.
