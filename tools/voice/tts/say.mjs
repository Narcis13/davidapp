// Local Kokoro-82M text-to-speech. Usage:
//   node say.mjs --voice af_heart --speed 1 --out out.wav "text"
//   node say.mjs --voice bm_george --text-file narration.txt --out out.wav --timings out.json
//   node say.mjs --list
// Text is split into sentences (kokoro-js stream), each synthesised separately and joined
// with --gap seconds of silence (default 0.18), because one generate() call truncates at ~510 tokens.
// --timings writes sentence-level timings only: kokoro-js exposes no word/token timestamps.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "@huggingface/transformers";
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

const here = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.resolve(here, "..", "cache"); // keep Hugging Face downloads out of the user profile
env.allowLocalModels = false;

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const args = process.argv.slice(2);
const opt = { voice: "af_heart", speed: 1, dtype: "q8", gap: 0.18 };
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => args[++i];
  if (a === "--voice") opt.voice = val();
  else if (a === "--speed") opt.speed = Number(val());
  else if (a === "--out") opt.out = val();
  else if (a === "--text-file") opt.textFile = val();
  else if (a === "--timings") opt.timings = val();
  else if (a === "--dtype") opt.dtype = val();
  else if (a === "--gap") opt.gap = Number(val());
  else if (a === "--list") opt.list = true;
  else rest.push(a);
}

const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: opt.dtype, device: "cpu" });

if (opt.list) {
  for (const [id, v] of Object.entries(tts.voices)) {
    console.log(`${id.padEnd(12)} ${v.language.padEnd(6)} ${v.gender.padEnd(7)} grade ${v.overallGrade}`);
  }
  process.exit(0);
}

const text = opt.textFile ? fs.readFileSync(opt.textFile, "utf8").trim() : rest.join(" ").trim();
if (!text || !opt.out) {
  console.error('usage: node say.mjs [--voice id] [--speed n] [--dtype q8|fp32] [--gap s] [--timings out.json] --out out.wav ("text" | --text-file f)');
  process.exit(1);
}

const chunks = [];
const sentences = [];
let sr = 24000;
let t = 0;
const splitter = new TextSplitterStream();
splitter.push(text);
splitter.close(); // stream(string) never flushes the last sentence, so close the splitter ourselves
for await (const { text: sentence, audio } of tts.stream(splitter, { voice: opt.voice, speed: opt.speed })) {
  sr = audio.sampling_rate;
  const pcm = audio.audio;
  const dur = pcm.length / sr;
  sentences.push({ text: sentence, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
  chunks.push(pcm, new Float32Array(Math.round(opt.gap * sr)));
  t += dur + opt.gap;
}
chunks.pop(); // no trailing gap
const total = chunks.reduce((n, c) => n + c.length, 0);
const wav = Buffer.alloc(44 + total * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + total * 2, 4); wav.write("WAVE", 8);
wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(total * 2, 40);
let o = 44;
for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), o);
}
fs.writeFileSync(opt.out, wav);
if (opt.timings) {
  fs.writeFileSync(opt.timings, JSON.stringify({
    voice: opt.voice, speed: opt.speed, sampleRate: sr, duration: +(total / sr).toFixed(3),
    granularity: "sentence", sentences,
  }, null, 2));
}
console.log(`wrote ${opt.out}: ${(total / sr).toFixed(2)} s, ${sr} Hz mono, voice ${opt.voice}, ${opt.dtype}`);
