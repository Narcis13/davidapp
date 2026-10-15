# Facts — clip 9

Every claim the video makes, with its source.

| claim (where) | source |
|---|---|
| "This is a clip made in Fablecut" (result: the gallery plays clip 7) | clip 7 was built in this studio through MCP (`showcase/journal/clip-7-a-video-that-checks-itself.jsonl`) |
| "every asset shows you what it draws" (find) | the library's cards show each asset's thumbnail and a hover filmstrip (`src/ui/screens/library.js`); seen in `studio-library-search` |
| "the preview follows at once" (tune) | the playground redraws the frame on every parameter change (`src/ui/preview.js`); seen in `studio-playground-param` |
| "Drag it on the timeline, and trim it" (place) | timeline items move and trim at their edges (`src/ui/lib/timeline.js`); seen in `studio-editor-place` |
| "The studio checks the file it made, from loudness to frozen frames" (render) | every render measures its encoded file: loudness (EBU R128), black frames, freezes, flashes, jumps, silences (`src/render/report.js`); the zoom shows clip 7's row: −14.1 LUFS, "Target met" |
| `npm run studio` (end card) | `package.json` scripts: `"studio": "node src/server/index.js"` |
| `github.com/Narcis13/davidapp` (end card) | the repository's remote (`git remote -v`) |

No number, customer, quote, logo or award is invented. The UI shown is the real studio, recorded (no screen is rebuilt or invented).
