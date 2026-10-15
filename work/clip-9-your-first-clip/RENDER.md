# Render — clip 9

The clip and everything it pins are in the repo: `clips/clip-9-your-first-clip/clip.json` (written by `export_clip`)
and the shared store `library/`. Nothing it uses stays out of git (the recordings are ours, the voice is Apache-2.0).

From a clean checkout, into an empty library:

```bash
npm ci
export STUDIO_DATA=<an empty scratch dir>
node scripts/library.mjs import clips/clip-9-your-first-clip --verify
node scripts/mcp.mjs call start_render '{"clip":"clip-9-your-first-clip","final":true,"wait_seconds":900}'
```

`--verify` draws the frames listed in clip.json and compares their hashes with the ones taken in the library the clip
was made in (same machine). The showcase also rebuilds it through MCP (`npm run showcase` replays
`showcase/journal/clip-9-your-first-clip.jsonl`; the narration is replayed from `showcase/voice/clip-9-voice.m4a`).
