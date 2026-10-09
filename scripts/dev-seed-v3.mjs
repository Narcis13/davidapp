// Development data for the iteration-3 studio screens, on top of a data dir built with `serve.sh seed`
// (the showcase library): a narration (a stand-in voice: tones at the word times, test fixture only), a
// clip "v3-demo" with typed markers, a word-anchored title and marker, captions from the words
// (text-captions@2), gain automation and ducking on the music, a loudness target, and one render (so the
// renders and gallery screens show loudness and the render report).
//
//   STUDIO_DATA=<dir> node scripts/dev-seed-v3.mjs [--no-render]

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStudio } from '../src/studio/studio.js';
import { encodeWav } from '../src/render/wav.js';

const studio = createStudio({ role: 'seed', runner: !process.argv.includes('--no-render') });
const A = 'dev-seed';
const SLUG = 'v3-demo';
const have = (slug) => !!studio.library.versionRow(slug);
try {
  if (!have('easing') || !have('music-loop')) throw new Error('Seed the showcase library first: bash .claude/goal-loop/serve.sh seed <port> <dir>');
  // the word-timed captions are version 2 of text-captions
  const cap = studio.library.versionRow('text-captions');
  if (!cap || cap.version < 2) await studio.library.updateAsset({ slug: 'text-captions', source: readFileSync(new URL('../assets/text-captions.v2.js', import.meta.url), 'utf8'), author: A, note: 'Captions from the narration words (dev seed)' });

  const script = 'Every frame is a function of time. Change the words, and the captions follow. The music steps back while I speak.';
  const words = script.split(/\s+/);
  const times = [];
  let t = 0.6;
  for (const [i, w] of words.entries()) {
    const d = 0.12 + w.length * 0.045;
    times.push([t, t + d]);
    t += d + (/[.,]$/.test(w) ? 0.42 : 0.07);
    if (i === 6) t += 0.5;
  }
  if (!have('demo-voice')) {
    const SR = 48000, n = Math.ceil((t + 1) * SR), l = new Float32Array(n);
    for (const [a, b] of times) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) { const x = i / SR; l[i] = 0.22 * (Math.sin(2 * Math.PI * 170 * x) + 0.4 * Math.sin(2 * Math.PI * 510 * x)) * Math.min(1, (i / SR - a) * 40, (b - i / SR) * 40); }
    const dir = mkdtempSync(join(tmpdir(), 'v3-seed-'));
    writeFileSync(join(dir, 'voice.wav'), encodeWav(l, l, SR));
    await studio.audio.addNarration({ slug: 'demo-voice', path: join(dir, 'voice.wav'), script, timings: words.map((w, i) => ({ word: w, start: times[i][0], end: times[i][1] })), author: A, title: 'Demo narration (test tones)', voice: { name: 'test tones', license: 'original (dev fixture)' } });
  }
  if (!studio.db.prepare('SELECT 1 FROM clips WHERE slug = ?').get(SLUG)) await studio.clips.createClip({ slug: SLUG, title: 'Iteration 3 demo', author: A, format: 'horizontal', fps: 30, duration: 12 });
  await studio.clips.updateClip(SLUG, { composition: {
    format: 'horizontal', fps: 30, duration: 12, background: '#0b0b12', loudness: { target: -14, truePeak: -1 }, platforms: ['youtube'],
    captions: { maxChars: 32 },
    markers: [
      { t: 0, type: 'cut', label: 'open' },
      { t: 4.2, type: 'cut', label: 'second shot' },
      { t: 8, type: 'beat', label: 'downbeat' },
      { t: 10, type: 'hold', duration: 2, label: 'end card' },
      { t: 0, type: 'word', label: 'captions', anchor: { item: 'vo', word: 10 } },
      { t: 6, type: 'note', label: 'tighten this' },
    ],
    tracks: [
      { id: 'bg', name: 'Background', type: 'visual', items: [{ id: 'drift', asset: 'bg-gradient-drift', start: 0, duration: 12 }] },
      { id: 'titles', name: 'Titles', type: 'text', items: [
        { id: 'title', asset: 'text-kinetic', start: 0.6, duration: 3.4, params: { words: ['Every', 'frame'] } },
        { id: 'follow', asset: 'text-word-reveal', start: 0, duration: 4, anchor: { item: 'vo', word: 8 }, params: { text: 'The captions follow', size: 96 }, transform: { space: 'safe', x: 0.5, y: 0.3, width: 1, height: 0.3 } },
      ] },
      { id: 'caps', name: 'Captions', type: 'text', role: 'captions', items: [{ id: 'cap', asset: 'text-captions', start: 0, duration: 12 }] },
      { id: 'voice', name: 'Narration', type: 'audio', role: 'narration', items: [{ id: 'vo', asset: 'demo-voice', start: 0, duration: Math.min(12, Math.ceil(t + 0.5)) }] },
      { id: 'music', name: 'Music', type: 'audio', role: 'music', items: [{ id: 'bed', asset: 'music-loop', start: 0, duration: 12, gain: 0.8, fadeOut: 1.5,
        keyframes: { volume: [{ t: 0, v: -18 }, { t: 1, v: 0, ease: 'outCubic' }, { t: 10, v: 0 }, { t: 11.5, v: -6, ease: 'inOutSine' }] },
        duck: { by: 18, attack: 0.15, release: 0.45, source: 'words' } }] },
    ],
  } });
  console.log(`clip ${SLUG} saved (narration words: ${words.length})`);
  if (!process.argv.includes('--no-render')) {
    const r = studio.renders.enqueue({ clip: SLUG, requestedBy: A });
    const done = await studio.renders.wait(r.id, 600000);
    console.log(`render #${done.id} ${done.status}${done.error ? `: ${done.error}` : ''} · ${done.stats?.loudness?.measured?.integrated} LUFS, ${done.stats?.loudness?.measured?.truePeak} dBTP`);
  }
} finally {
  await studio.close();
}
