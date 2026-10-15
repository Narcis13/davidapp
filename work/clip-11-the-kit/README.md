# Clip 11 — "The kit"

A 16 s tour (16:9, music only) made so that every kit asset appears in the showcase. It is not a motion-prompt clip
(no gates): clips 9 and 10 are. Built through MCP and journalled (`showcase/journal/clip-11-the-kit.jsonl`); the
composition is `clips/clip-11-the-kit/compose.mjs`, its export `clip.json`.

What it adds to the library: **kit-ui-frame@2** (its chrome text stays at its size floor while it scales in; v1 drew
it 3 % under the floor during `inDur` and failed, which clip 10 worked around with a fade) and **kit-chart-donut@1**
with a usage note. The donut shows clip 10's items from `compounding_report`: 17 of 22 reuse an earlier clip's assets.

Final render #29: 1920×1080, 16.1 s, −14.1 LUFS, −1.1 dBTP, no black frames, freezes, jumps, flashes or silences;
`check_clip` 0 issues; round trip identical (`docs/showcase/v4/reports/roundtrip-clip-11.txt`). Sheet:
`checks/final-sheet-1.png`.

## Where each kit asset appears

| asset | clip |
|---|---|
| kit-ui-frame | 10 (v1, fading in), 11 (v2, scaling in) |
| kit-cursor, kit-spotlight, kit-camera, kit-callout, kit-steps | 9 |
| kit-steps | 9, 11 |
| kit-icon, kit-chart-line | 10 |
| kit-plate | 10, 11 |
| kit-arrow, kit-chart-donut | 11 |
| end-card@3 (with a logo) | 9, 10 |

Every kit asset carries a usage note in the library (`get_asset` → notes).
