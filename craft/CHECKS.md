# Checks

What every video is checked for before each gate, and the studio tool that measures it. The process is in
`motion_prompt_fablecut.md` (`<checks>`); this file says how each check is run on this studio. Results go to
`work/<slug>/checks/report.md`, each as pass, fixed, n/a or open, with the call and the number.

| check | how | pass when |
|---|---|---|
| takeaway | a fresh subagent sees only the frame sheets (and the first 3 s), not the brief | its sentence says what the takeaway says |
| spelling-and-facts | read every word against script.json; `facts.md` lists each claim with its source | no unsourced claim |
| script-lock | the render's `.srt` against script.json; `check_transcript { transcribe: true }`; `list_clip_assets` against the approved revision | equal; no slips or drops; no pinned version changed |
| literals | grep compose.mjs for words, `#hex` and numbers not from script.json, the theme or timing.mjs; grep `assets/` for script strings | none |
| determinism | `frame_hashes` at the render's sampled frames vs `get_render` stats.frameHashes; a second `start_render { workers }` with another count | identical |
| glyphs, text-safe-area, no-collisions, text-contrast, read-time, captions | `check_clip` on the clip and on each shape (`format`) | 0 issues |
| frame-sheet | the render's encoded-file sheets (`render_report`), viewed; black frames down to 1 frame, freezes down to 0.5 s, brightness jumps | none outside named holds and cuts |
| cut-strips | `render_clip_frame { sheet: true, from, to, frames: 8 }` across every cut, viewed | nothing pops, overlaps or goes blank |
| format | `render_report` probe: H.264, AAC 48 kHz, yuv420p, BT.709, faststart, size, fps, duration within 5 % | all |
| loudness | `render_report` loudness on the file; `audio_report` music under the voice where it speaks; silences | −14 LUFS ±1, TP ≤ −1 dBTP, 16–20 LU, no silence over 1 s |
| sync | `anchor_report` (key words); `render_report` narration timing | ≤ 2 frames; ≤ 1 frame |
| sources | `clip_credits`, `check_provenance` | every file licensed and sourced; no placeholder |
| re-render | `export_clip`, then `import_clip { verify: true }` into an empty data dir from a clean checkout | same refs, same frame hashes |
