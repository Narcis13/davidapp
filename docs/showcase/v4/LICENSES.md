# Licences of the iteration 4 showcase

## The voices of clips 9 and 10

Iteration 3's route still works on this PC, so it is kept (contract item D23): Kokoro-82M through kokoro-js for the
voice, whisper.cpp for the word times and the transcript check. No service, no key; nothing is paid for. The studio
now runs them itself (`generate_narration`, `voice_samples`, `transcribe`, `check_transcript { transcribe: true }`).

| what | version | licence | source |
|---|---|---|---|
| Kokoro-82M weights (ONNX, q8) | v1.0 | Apache-2.0 | https://huggingface.co/hexgrad/Kokoro-82M · https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX |
| voices `af_heart` (the takes), `bf_emma`, `am_fenrir`, `am_michael` (gate samples) | v1.0 | Apache-2.0 (same as the model) | https://huggingface.co/hexgrad/Kokoro-82M/tree/main/voices |
| kokoro-js (with transformers.js, phonemizer) | 1.2.1 (3.8.1, 1.2.1) | Apache-2.0 | https://www.npmjs.com/package/kokoro-js |
| onnxruntime-node | 1.21.0 | MIT | https://github.com/microsoft/onnxruntime |
| whisper.cpp, Windows x64 build | tag b5454 | MIT | https://github.com/ggml-org/whisper.cpp/releases/tag/b5454 |
| Whisper weights (`ggml-small.en`, `ggml-base.en`) | as published 2026-10-09 | MIT | https://huggingface.co/ggerganov/whisper.cpp |

The Kokoro model card puts no restriction on the audio it produces, and the English voices are not built on its two
CC BY datasets. The takes are committed as AAC (`showcase/voice/clip-9-voice.m4a`, 375 KB;
`showcase/voice/clip-10-voice.m4a`, 213 KB) with their word times, and as WAV in the repo's content store
(`library/files/`, each under 2 MB), each recorded in the studio as Apache-2.0, AI-generated, credited
"Voice: Kokoro-82M, voice af_heart (Apache-2.0)". The gate samples are in `work/clip-*/voice-samples/`. The models
are installed outside the repository and never committed; the helper script that drives kokoro-js is
`tools/voice/tts/say.mjs` (its `node_modules` and model cache are ignored).

## Footage and logos

The screen recordings in `showcase/footage/` are of this studio, made by `scripts/record-studio.mjs` (original,
recorded in the studio as `license: original`, creator Fablecut). The Fablecut logo (`brand/fablecut-logo.svg`) is
the project's own.

## Icons

`kit-icon` draws Lucide icons, vendored in `vendor/lucide/` with their licence (ISC; see `vendor/lucide/LICENSE`
and `VERSION.json`).

## Everything else

The music and sound are synthesised by the library's audio assets (`music-loop` and the drums); the graphics are
drawn by code in this repository; the fonts are the bundled OFL families (licences in `fonts/licenses`). Every
final render writes its credits next to the MP4 (`<render>.credits.md`, from `clip_credits`), and
`reports/sources.md` lists the credits and source problems of clips 7 to 11 (none).
