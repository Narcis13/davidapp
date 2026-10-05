// "A Sketchbook History of AI": the composition of the 40-second vertical clip, pushed to the
// studio through its MCP server.
//
//   node clips/history-of-ai/compose.mjs            create the clip if missing, sync its assets from
//                                                   assets/, save the composition (update_clip)
//   node clips/history-of-ai/compose.mjs --render   ...and render it into STUDIO_DATA/renders
//
// Chapters are sketch-chapter pages that erase themselves; a timeline runs along the bottom, the
// pencil sound sits under every page that draws itself and an eraser sound under every rub-out.

import { fileURLToPath } from 'node:url';
import { connect, callTool } from '../../scripts/mcp.mjs';
import { syncAssets } from '../../scripts/sync-assets.mjs';

const ERASE = 0.6;
const chapters = [
  { id: 'intro', start: 0, dur: 4.6, year: 'AI', yearColor: 'ink', yearMark: 'scribble', title: 'A *sketchbook* history', doodle: 'robot', note: 'From a question asked in 1950 to the *chatbot* in your pocket.' },
  { id: 'y1950', start: 4.6, dur: 4.6, year: '1950', yearColor: 'accent2', yearMark: 'line', title: 'Can machines *think*?', doodle: 'turing', note: 'Alan Turing proposes the *imitation game*: can a machine pass for a human?' },
  { id: 'y1956', start: 9.2, dur: 4.2, year: '1956', yearColor: 'accent', yearMark: 'circle', title: 'The name is *born*', doodle: 'lightbulb', note: 'A summer workshop at Dartmouth coins the term *artificial intelligence*.' },
  { id: 'y1958', start: 13.4, dur: 4.6, year: '1958', yearColor: 'accent3', yearMark: 'double', title: 'The *Perceptron*', art: 'network', layers: [3, 1], inputs: ['x1', 'x2', 'x3'], output: 'yes / no', sum: true, doodleDur: 1.6, note: 'Frank Rosenblatt builds a machine that *learns* from examples.' },
  { id: 'y1974', start: 18.0, dur: 4.4, year: '1974-93', yearColor: 'accent2', yearMark: 'none', title: 'The AI *winters*', doodle: 'snowflake', note: 'Big promises, slow computers. The funding *freezes*. Twice.' },
  { id: 'y1997', start: 22.4, dur: 4.4, year: '1997', yearColor: 'ink', yearMark: 'line', title: '*Checkmate*', doodle: 'chess-king', note: "IBM's Deep Blue beats world chess champion *Garry Kasparov*." },
  { id: 'y2012', start: 26.8, dur: 4.6, year: '2012', yearColor: 'accent', yearMark: 'circle', title: 'Deep *learning*', doodle: 'cat', doodleLabel: 'cat 0.98', note: 'Big data + GPUs + many layers: computers learn to *see*.' },
  { id: 'y2022', start: 31.4, dur: 5.0, year: '2022', yearColor: 'accent3', yearMark: 'double', title: 'Chatbots go *mainstream*', art: 'chat', note: '2017 brings the transformer. Then everyone starts *talking* to AI.', noteAt: 2.1,
    messages: [{ from: 'user', text: 'Explain AI in one line?' }, { from: 'ai', text: 'Machines that learn patterns from examples, not hand-written rules.' }] },
  { id: 'outro', start: 36.4, dur: 3.6, year: 'NEXT?', yearColor: 'accent', yearMark: 'scribble', title: 'The next page is *blank*', doodle: 'rocket', note: 'What will *you* draw on it?', exit: 'fade', doodleAt: 0.5, doodleDur: 1.4, noteAt: 1.0, noteDur: 0.9 },
];

const chapterItem = (c) => ({
  id: c.id, asset: 'sketch-chapter', start: c.start, duration: c.dur,
  params: Object.fromEntries(Object.entries({
    year: c.year, title: c.title, note: c.note, art: c.art ?? 'doodle', doodle: c.doodle ?? 'none', doodleLabel: c.doodleLabel,
    layers: c.layers, inputs: c.inputs, output: c.output, sum: c.sum, messages: c.messages,
    yearColor: c.yearColor, yearMark: c.yearMark, doodleAt: c.doodleAt ?? 0.7, doodleDur: c.doodleDur ?? 1.7, noteAt: c.noteAt ?? 1.45, noteDur: c.noteDur ?? 1.15,
    exit: c.exit ?? 'erase', outDur: c.exit === 'fade' ? 0.7 : ERASE,
  }).filter(([, v]) => v !== undefined)),
});

const T0 = chapters[1].start;
const stops = [...chapters.slice(1, -1).map((c) => ({ at: +(c.start - T0).toFixed(2), label: c.year.slice(0, 4) })), { at: +(chapters.at(-1).start - T0).toFixed(2), label: 'next?' }];

export const composition = {
  format: 'vertical', fps: 30, duration: 40, background: '#f3ecdc', seed: 1950,
  tracks: [
    { id: 'paper', type: 'visual', items: [{ id: 'paper', asset: 'bg-paper', start: 0, duration: 40, params: { pattern: 'ruled', rings: true, stain: true } }] },
    { id: 'weather', type: 'visual', items: [{ id: 'snow', asset: 'sketch-snowfall', start: 18.0, duration: 4.4, params: { count: 34, color: 'accent2', speed: 12, wind: 4, fade: 0.5 } }] },
    { id: 'pages', type: 'visual', items: chapters.map(chapterItem) },
    { id: 'timeline', type: 'visual', items: [{ id: 'timeline', asset: 'sketch-timeline', start: T0, duration: 40 - T0, params: { stops, outDur: 0.7 } }] },
    { id: 'music', type: 'audio', items: [{ id: 'music', asset: 'music-loop', start: 0, duration: 40, gain: 0.5, params: { bpm: 92, scale: 'dorian', arpWave: 'triangle', drums: 0.55, bass: 0.6, arp: 0.4, swing: 0.12, outroBars: 1 } }] },
    { id: 'pencil', type: 'audio', items: chapters.map((c, i) => ({ id: `pencil-${c.id}`, asset: 'sfx-pencil', start: c.start + 0.05, duration: 2.6, gain: 0.32, params: { rate: 5 + (i % 3), mode: 'pencil' } })) },
    { id: 'eraser', type: 'audio', items: chapters.filter((c) => c.exit !== 'fade').map((c) => ({ id: `erase-${c.id}`, asset: 'sfx-pencil', start: +(c.start + c.dur - ERASE).toFixed(2), duration: ERASE, gain: 0.5, params: { mode: 'eraser', rate: 8 } })) },
  ],
};

const SLUG = 'history-of-ai';
const ASSETS = ['theme-sketchbook', 'bg-paper', 'sfx-pencil', 'sketch-chapter', 'sketch-snowfall', 'sketch-timeline', 'music-loop'];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = await connect({});
  const must = (r, what) => { if (r.isError) throw new Error(`${what}: ${r.text}`); return r; };
  try {
    if ((await callTool(client, 'get_clip', { clip: SLUG })).isError) {
      must(await callTool(client, 'create_clip', { name: SLUG, title: 'A Sketchbook History of AI', format: composition.format, fps: composition.fps, duration: composition.duration }), 'create_clip');
      console.log(`✓ created clip ${SLUG}`);
    }
    await syncAssets(client, ASSETS, { forClip: SLUG });
    const r = must(await callTool(client, 'update_clip', { clip: SLUG, composition }), 'update_clip');
    console.log(r.text.slice(0, 3000));
    if (process.argv.includes('--render')) {
      const job = must(await callTool(client, 'start_render', { clip: SLUG, wait_seconds: 900 }), 'start_render').json;
      console.log(`render #${job.id} ${job.status} → ${job.output}`);
    }
  } finally { await client.close(); }
}
