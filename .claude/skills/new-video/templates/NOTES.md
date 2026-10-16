# <slug>

Clip: http://127.0.0.1:8787/clips/<slug> · `clips/<slug>/compose.mjs` · push: `node .claude/skills/new-video/scripts/push-clip.mjs <slug>`

## Brief

- What: …
- For whom: …
- Takeaway: …
- Length, shape(s), voiced: … · runs on: … · language: …
- Product / brand / call to action: …

## Look

- Theme: `theme-…` (bg …, accent … for …)
- Type: … (headline), … (body); sizes: headline … %, support … %, captions … %
- Grid: … · shape language: … · depth and texture: …
- Reference clips: …

## Script and clock

- Beats: see `script.json`; bpm … (bar … s); cuts at …; holds at …
- Voice: … (voice id, take name) / text and music only

## Library

- Reused: …
- New (name, kind, what for): …
- Presets and precomps: …
- Notes left (`add_asset_note`): … · featured: …

## Decisions (defaults taken, to overrule at the stop)

- …

## Checks

| check | status | evidence | note |
|---|---|---|---|
| check_clip (primary) | | | |
| check_clip (other shapes) | | | |
| audio_report | | | |
| frame-sheet (draft, viewed) | | | |
| cut-strips (viewed) | | | |
| takeaway (fresh eyes) | | | |
| spelling-and-facts | | | |
| literals | | | |
| check_provenance / clip_credits | | | |
| format (final, per shape) | | | |
| loudness (final) | | | |
| determinism | | | |
| re-render (export, import verify) | | | |

## Render

Final renders: #… (primary), #… · `out/final.mp4`, … · poster at … s

From a clean checkout, into an empty library:

```bash
npm ci
# STUDIO_DATA=<an empty scratch dir>
node scripts/library.mjs import clips/<slug> --verify
node scripts/mcp.mjs call start_render '{"clip":"<slug>","formats":["<shape>"],"final":true,"wait_seconds":900}'
```

## Open / unverified

- …

## Next

- …
