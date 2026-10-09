# Licences of the iteration 3 showcase

## The voice of clip 7

**Why this voice:** the brief's order was a recording in `brand/voice/` (there was none), then a voice service
with a key in `.env` (there was no `.env`), then a local open model whose code, weights and voice allow commercial
use and redistribution. Kokoro-82M is one; it runs on this PC's CPU through kokoro-js, with no service and no key.

| what | version | licence | source |
|---|---|---|---|
| Kokoro-82M weights (ONNX, q8) | v1.0 | Apache-2.0 | https://huggingface.co/hexgrad/Kokoro-82M · https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX |
| voice `af_heart` (Kokoro voice pack) | v1.0 | Apache-2.0 (same as the model) | https://huggingface.co/hexgrad/Kokoro-82M/tree/main/voices |
| kokoro-js (and transformers.js, phonemizer) | 1.2.1 (3.8.1, 1.2.1) | Apache-2.0 | https://www.npmjs.com/package/kokoro-js |
| onnxruntime-node | 1.21.0 | MIT | https://github.com/microsoft/onnxruntime |
| whisper.cpp, Windows x64 build | tag b5454 | MIT | https://github.com/ggml-org/whisper.cpp/releases/tag/b5454 |
| Whisper weights (`ggml-small.en`, `ggml-base.en`) | as published 2026-10-09 | MIT | https://huggingface.co/ggerganov/whisper.cpp |

The Kokoro model card says it was trained only on permissive or non-copyrighted audio, and puts no restriction on
the audio it produces; the English voices are not built on its two CC BY datasets. The narration file in
`showcase/voice/clip-7-narration.m4a` (AAC 96 kb/s, 659 KB) is therefore committed, with its word timings
(`clip-7-narration.whisper.json`) and the two transcripts. The models are installed outside the repository
(`C:/newme/fablecut-voice/`, about 1.5 GB) and never committed. Credit, as a courtesy: Kokoro-82M (hexgrad, Apache-2.0).

## Everything else

The music and sound are synthesised by the library's audio assets (`music-loop` and the drums); the graphics are
drawn by code in this repository; the fonts are the bundled OFL families (licences in `fonts/licenses`), with
their Latin Extended files from the same `@fontsource` packages.
