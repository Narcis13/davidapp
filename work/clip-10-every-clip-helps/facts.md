# Facts — clip 10

Every claim the video makes, with its source. Numbers are from `compounding_report` in the library the clip was made
in (clips 1 to 8 rebuilt by `npm run showcase`, clip 9 as committed).

| claim (where) | source |
|---|---|
| "Every video you make leaves pieces behind" (outcome) | `compounding_report`: clips 1 to 9 each list the asset versions they added (`newAssets`), 27 · 8 · 4 · 14 · 7 · 0 · 12 · 0 · 11 |
| "each one becomes an asset: searchable, versioned, and ready for the next clip" (product) | assets are found with `search_assets` and the library screen (seen in the recording `studio-library-search`); every change is a new immutable version (`asset_versions`, `src/db/db.js`); clips 2 to 9 reuse earlier clips' assets (`compounding_report`, `reusedFrom`) |
| "Nine clips added eighty-three assets to the library" and the chart 27, 35, 39, 53, 60, 60, 72, 72, 83 (proof) | the running total of `newAssets` per clip in `compounding_report` (27 + 8 + 4 + 14 + 7 + 0 + 12 + 0 + 11 = 83) |
| "two clips needed no new code at all", "Clips 6 and 8: no new code" (proof) | `compounding_report`: clips 6 and 8 have 0 new code lines and 100 % reuse |
| 127.0.0.1:8787 (the browser's address) | the studio's default address (`src/server/index.js`); the recording was made on a scratch port and the frame shows the address a user sees |
| `github.com/Narcis13/davidapp` (end card) | the repository's remote (`git remote -v`) |

Corrected at the facts check: the first take said "Nine clips in, the library holds eighty-three assets". The library
held 93 assets then (it also holds fonts and files that no clip's code added), so the sentence was false as said. The
line now says what the number counts, in a new take (`clip-10-voice@2`), and the chart's title says "Assets added,
running total".

No number, customer, quote or award is invented. The UI shown is the real studio, recorded. The logo is the repo's
own (`brand/fablecut-logo.svg`), drawn as given.
