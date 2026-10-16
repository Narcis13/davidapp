# A voiced video: narration, anchors, captions, the mix

The narration sets the clock. Nothing in a voiced video is timed by hand: visuals are anchored to words, the
captions are built from the words, the music ducks on the words. A new take moves everything with it.

## 1. What this machine can do

`speech_status {}`: which voice engine (Kokoro locally, ElevenLabs when its key is in `.env`) and which
transcription (whisper.cpp, one or two models) are set up, and what to set for each missing piece. Without a
voice engine, write the script and the anchors anyway, mark the narration as unverified in NOTES.md, and
ask the user for a recording (`add_narration { path, script, align: true, license: 'original' }` times it).

## 2. Script

- About 150 spoken words per minute in English (look up the rate for another language); speech fills at most
  85 % of the length. One beat per idea; on-screen text is the few key words of what is said, never a second
  sentence to read while listening.
- `script.json` holds each beat's `voice` line and its `key` word. The whole take is the beats' lines in order.
- A pronunciation list for names, numbers and URLs (write "eighty-three", "github dot com slash …", as it
  should be read).

## 3. Voice

- `voice_samples { line, count: 3 }` of one real line: the user picks by ear at the style stop; without a
  stop, pick a clear mid-register voice and say which.
- `generate_narration { script, voice, name: '<slug>-voice', for_clip, ai_generated: true, license }`:
  speaks, transcribes, aligns the words to the script and checks the transcript in one call (minutes for a
  long script). The result names any slip or drop; regenerate once with the word respelt, then flag the time
  for the user to listen.
- A new take is `generate_narration` with the same name; then `repin_clip { clip, only: ['<slug>-voice'] }`
  moves every anchored item to the new word times.
- A synthetic voice is `ai_generated: true`; it is listed apart in the credits.

## 4. Place it and anchor to it

```js
// timing.mjs reads the words the studio wrote: data/.. is not in the repo, so copy the words JSON next to the clip
// (get_asset on the narration gives its words; clip 10 keeps them in showcase/voice/<name>.words.json)
{ id: 'voice', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: '<slug>-voice', start: 0.4, duration: <take length> }] }
```

- One item for the whole take, or one per beat (`offset` into the take, as clip 10 does) when beats need room
  between them.
- `anchor: { item: 'vo', word: <index>, offset: -0.15 }` on an item's start, a keyframe's `t` or a marker's
  `t`: the visual lands a few frames before its word is heard. `timing.mjs` can compute word indexes from
  `script.json` (clip 10's `wordOf`). `anchor_report` gives each distance in frames (≤ 2).
- Every asset reads `f.clip.words`; an asset can brighten the spoken word itself.

## 5. Captions

- `captions: { burnIn: true }` on the composition (defaults: 2 lines, 32 chars in 16:9, 20 otherwise, pages on
  phrases, ≥ 0.8 s, gaps under 0.3 s closed), and `text-captions` (newest version) on a text track with
  `role: 'captions'`, spanning the clip. The lane is `f.clip.lane`; nothing else goes there.
- `caption_pages { clip }` lists the pages and the rules they break; `edit_clip` `caption_split`,
  `caption_merge`, `caption_break`, `caption_move`, `caption_auto` change the structure. Times always come
  from the words.
- The spoken word is marked by brightness (the asset's `active` colour), never by size or weight.
- Every render writes `captions.srt`, `captions.vtt` and the words as JSON next to the MP4; `burnIn: false`
  keeps the files and skips the burn-in.

## 6. The mix

```js
{ id: 'music', type: 'audio', role: 'music', items: [{ id: 'bed', asset: 'music-loop', start: 0, duration: D, gain: 0.45, fadeOut: 1,
  beats: true, params: { bpm: 112, scale: 'major' },
  duck: { by: 18, attack: 0.15, release: 0.45, hold: 0.25, source: 'words' } }] }
```

- `beats: true` on the music even when the voice is the first audio item, so assets get the beat grid.
- `composition.loudness: { target: -14, truePeak: -1 }`. `audio_report { clip }` before rendering: the
  music 16 to 20 LU under the voice, silences, clipping. `export_stems` for WAV stems if the user wants to
  mix elsewhere.
- Sound design stays rare under a voice (one action in five, well under the voice).

## 7. Checks that only a voiced video has

`anchor_report` (≤ 2 frames), `caption_pages` (0 broken), `check_transcript { transcribe: true }` (0 slips or
drops), the render's `.srt` equal to the script, and `render_report`'s narration timing (≤ 1 frame).
