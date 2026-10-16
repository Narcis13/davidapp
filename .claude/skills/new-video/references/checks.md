# Checks: what every video passes before it is delivered

Each check names the studio tool that measures it and the number it must give. Results go to the *Checks*
table of `work/<slug>/NOTES.md` as pass, fixed, n/a or open, with the call and the number (or the still you
viewed). Fixed, n/a and open need a note. A pass you did not measure or view is not a pass. The repo's own
list is `craft/CHECKS.md`; if it has lines this file lacks, they hold too.

`scripts/checks-report.mjs <clip> <out.md> [--final <id>] [--second <id>] [--formats a,b]` in the repo writes
the measured rows for a finished clip (set `STUDIO_DATA` to the data dir, `./data` for the studio's own; in
PowerShell `$env:STUDIO_DATA = './data'`); paste them into NOTES.md and add the viewed rows yourself.

## Before the draft (on the clip, then on each other shape with `format`)

| check | call | pass when |
|---|---|---|
| glyphs, text-safe-area, no-collisions, text-contrast, read-time, captions, first and last frame | `check_clip { clip }` and `check_clip { clip, format }` | 0 issues (each issue has an item, a time and a still: open the still) |
| text sizes | `layout_report { clip, t }` on the busiest frames | every text at or above its floor on screen |
| sync (voiced) | `anchor_report { clip }` | every anchor within 2 frames of its word |
| captions (voiced) | `caption_pages { clip }` | no rule broken (2 lines, 32/20 chars, phrases kept, ≥ 0.8 s) |
| the mix | `audio_report { clip }` | music 16 to 20 LU under the voice where it speaks; no silence over 1 s; 0 clipping samples |
| sources | `check_provenance { clip }` | 0 problems (no placeholder, no file without a licence) |

## On the draft (`start_render { draft: true }`)

| check | call | pass when |
|---|---|---|
| frame-sheet | `render_report { id, sheets: true }`, the sheets viewed frame by frame | no black frame (down to 1 frame), no freeze ≥ 0.5 s outside a `hold` marker, no brightness jump away from a `cut` marker, no flash, no silence over 1 s |
| cut-strips | `render_clip_frame { clip, sheet: true, from: cut − 0.4, to: cut + 0.4, frames: 8 }` per cut, viewed | nothing pops, overlaps wrongly or goes blank mid-move |
| takeaway | a fresh subagent (`Explore` or `general-purpose`) sees only the sheets, not the brief, and says in one sentence what the video claims, and what the first 3 s are | its sentence matches the takeaway; the first 3 s say what this is |
| spelling-and-facts | read every word on the stills against `script.json`; every number has a source in NOTES.md | no unsourced claim, no typo |
| literals | grep `compose.mjs` for words, `#hex` and times not from `script.json`, the theme or `timing.mjs`; grep `assets/` for strings of the script | none (boxes as fractions and sub-second motion durations are fine) |

## On the final (`start_render { final: true, formats }`)

| check | call | pass when |
|---|---|---|
| format | `render_report { id }` per shape | 1080p or more, constant fps, H.264 yuv420p, BT.709 tags, AAC 48 kHz, faststart, duration within 5 % of the target, inside the platform's limit |
| loudness | `render_report { id }` | −14 LUFS ±1, true peak ≤ −1 dBTP on the encoded file |
| frame-sheet | `render_report { id, sheets: true }`, viewed | as on the draft |
| sync (voiced) | `render_report { id }` narration timing | the voice within 1 frame of its place in the clip |
| determinism | `frame_hashes { clip, times: <the render's sampled times> }` against `get_render { id }` `stats.frameHashes`; a second `start_render { workers: <another count> }` | identical |
| script-lock (voiced) | the render's `.srt` against `script.json`; `check_transcript { narration, transcribe: true }` | equal after normalising case, punctuation and numerals; 0 slips or drops |
| sources | `clip_credits { clip, format: 'markdown' }`; the final's `credits.md` written | every file with licence and source; AI-generated material listed apart |
| re-render | `export_clip { clip }`, then `import_clip { folder, verify: true }` into an empty data dir (`STUDIO_DATA=<scratch>`), or `node scripts/roundtrip.mjs <slug>` | same refs, same frame hashes |

## When a check fails

Read the issue's still and time. Fix the cause in `compose.mjs` or the asset, push, and re-run only that
check until it passes, then the whole list once more before the final. A note the checks did not catch
becomes a new line in `craft/CHECKS.md` (the tool and the threshold that would have caught it).
