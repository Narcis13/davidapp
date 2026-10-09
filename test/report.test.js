// The render report: probe facts, black, freezes, jumps, flashes, silences and narration read from an
// encoded MP4, and the frame sheets drawn from it. The inputs are made with FFmpeg's lavfi at 320x180, 30 fps.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpegPath, run } from '../src/render/ffmpeg.js';
import { createCanvas, loadImage } from '../src/render/host.js';
import { analyseFile, encodedSheets, sheetFrames, isFaststart, flashWindows, clock } from '../src/render/report.js';

const FPS = 30;
let dir;

// a moving picture with a steady mean luma: a sine pattern around `mid` that slides every frame
const moving = (mid, amp = 70) => `color=c=gray:s=320x180:r=${FPS},geq=lum='${mid}+${amp}*sin((X+N*9)/17)':cb=128:cr=128`;
const flat = (y) => `color=c=gray:s=320x180:r=${FPS},geq=lum=${y}:cb=128:cr=128`;
const black = `color=c=black:s=320x180:r=${FPS}`;
// `high` for the first `on` frames of every `period` frames, `low` for the rest
const strobe = (period, on, high = 235, low = 80) => `color=c=gray:s=320x180:r=${FPS},geq=lum='if(lt(mod(N,${period}),${on}),${high},${low})':cb=128:cr=128`;

/**
 * Encode segments [source, frames] one after the other, with a sine that has a silent gap, the way the studio encodes.
 * @param {string} file @param {[string, number][]} segments
 * @param {{ seconds?: number, gap?: [number, number], faststart?: boolean, audio?: boolean, tagged?: boolean }} [opts]
 */
async function makeClip(file, segments, { seconds, gap, faststart = true, audio = true, tagged = true } = {}) {
  const frames = segments.reduce((s, [, n]) => s + n, 0);
  const secs = seconds ?? frames / FPS;
  const parts = segments.map(([src, n], i) => `${src},format=yuv420p,trim=end_frame=${n},setpts=PTS-STARTPTS[s${i}]`);
  // setparams tags the frames; FFmpeg 9 does not write -color_primaries / -color_trc from the output options alone
  const tag = tagged ? ',setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv' : '';
  const cat = `${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${segments.length}:v=1:a=0${tag}[v]`;
  const volume = gap ? `,volume=enable='between(t,${gap[0]},${gap[1]})':volume=0` : '';
  const graph = [...parts, cat, ...(audio ? [`sine=f=440:r=48000,atrim=end=${secs}${volume}[a]`] : [])].join(';');
  const args = ['-y', '-v', 'error', '-filter_complex', graph, '-map', '[v]', ...(audio ? ['-map', '[a]'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    ...(tagged ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'] : []),
    ...(audio ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'] : []),
    '-t', String(secs), ...(faststart ? ['-movflags', '+faststart'] : []), file];
  const r = await run(ffmpegPath(), args);
  assert.equal(r.code, 0, r.stderr);
  return file;
}

// The main clip, 9 s (270 frames):
//   f0-59 moving   f60-61 black   f62-89 moving   f90-119 frozen (hold marker)   f120-149 moving
//   f150-179 frozen (no marker)   f180-209 moving  f210-239 dark (cut marker at 7.0)   f240-269 bright (no marker)
// and a sine with a silent gap from 5.0 s to 6.5 s.
/** @type {[string, number][]} */
const MAIN = [[moving(128), 60], [black, 2], [moving(128), 28], [flat(128), 30], [moving(128), 30], [flat(128), 30], [moving(128), 30], [moving(60, 30), 30], [moving(190, 30), 30]];
/** @type {import('../src/render/report.js').Marker[]} */
const MARKERS = [{ t: 3, type: 'hold', duration: 1 }, { t: 7, type: 'cut' }, { t: 1.5, type: 'beat' }];
const base = { fps: FPS, duration: 9, width: 320, height: 180, markers: MARKERS };

let main, nofast, strobes, report;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fablecut-report-'));
  main = await makeClip(join(dir, 'main.mp4'), MAIN, { gap: [5, 6.5] });
  nofast = await makeClip(join(dir, 'nofast.mp4'), [[moving(128), 30]], { faststart: false });
  // 10 Hz strobe for 2 s, a second of calm, 2 Hz for 2 s
  strobes = await makeClip(join(dir, 'strobe.mp4'), [[strobe(3, 1), 60], [flat(128), 30], [strobe(15, 8), 60]], { audio: false });
  report = await analyseFile(main, {
    ...base,
    narration: [
      { item: 'a', words: [{ text: 'hello', start: 0.5, end: 0.9 }, { text: 'across', start: 6.8, end: 7.3 }, { text: 'late', start: 8.5, end: 9.2 }] },
      { item: 'b', words: [{ text: 'one', start: 1, end: 1.4 }, { text: 'two', start: 1.5, end: 2.5 }] },
      { item: 'c', words: [] },
    ],
  });
});
after(() => dir && rmSync(dir, { recursive: true, force: true }));

test('probe facts: codec, size, colour, audio, frame count', () => {
  const p = report.probe;
  assert.equal(p.video.codec, 'h264');
  assert.equal(p.video.pixFmt, 'yuv420p');
  assert.equal(p.video.width, 320);
  assert.equal(p.video.height, 180);
  assert.equal(p.video.fps, 30);
  assert.deepEqual({ primaries: p.color.primaries, transfer: p.color.transfer, space: p.color.space }, { primaries: 'bt709', transfer: 'bt709', space: 'bt709' });
  assert.equal(p.audio.codec, 'aac');
  assert.equal(p.audio.sampleRate, 48000);
  assert.equal(p.audio.channels, 2);
  assert.equal(p.frames, 270);
  assert.ok(Math.abs(p.duration - 9) < 1 / FPS, `duration ${p.duration}`);
});

test('faststart is read from the atoms: true with +faststart, false without', async () => {
  assert.equal(report.probe.faststart, true);
  assert.equal(await isFaststart(main), true);
  assert.equal(await isFaststart(nofast), false);
  const r = await analyseFile(nofast, { fps: FPS, duration: 1 });
  assert.equal(r.probe.faststart, false);
  assert.ok(r.problems.some((l) => /faststart/.test(l)), r.problems.join('\n'));
});

test('loudness is measured with ebur128, or taken from the injected function', async () => {
  const l = report.loudness;
  assert.ok(l.integrated < -10 && l.integrated > -40, `I ${l.integrated}`);
  assert.ok(l.range >= 0 && l.range < 30, `LRA ${l.range}`);
  assert.ok(l.truePeak < 0 && l.truePeak > -40, `peak ${l.truePeak}`);
  let asked;
  const r = await analyseFile(nofast, { fps: FPS, duration: 1, loudness: async (p) => ((asked = p), { integrated: -16, range: 4, truePeak: -1.5 }) });
  assert.equal(asked, nofast);
  assert.deepEqual(r.loudness, { integrated: -16, range: 4, truePeak: -1.5 });
});

test('black frames: the two in the middle are found, with their frame count', () => {
  assert.equal(report.black.length, 1);
  const b = report.black[0];
  assert.equal(b.frames, 2);
  assert.ok(Math.abs(b.start - 2) < 0.01 && Math.abs(b.end - 62 / 30) < 0.01, JSON.stringify(b));
});

test('freezes: the frozen second inside a hold marker is excused, the other is not', () => {
  assert.equal(report.freezes.length, 2, JSON.stringify(report.freezes));
  const [a, b] = report.freezes;
  assert.ok(Math.abs(a.start - 3) < 0.05 && Math.abs(a.end - 4) < 0.05, JSON.stringify(a));
  assert.equal(a.excused, 'hold');
  assert.ok(Math.abs(b.start - 5) < 0.05 && Math.abs(b.end - 6) < 0.05, JSON.stringify(b));
  assert.ok(!b.excused);
  assert.ok(Math.abs(b.duration - 1) < 0.05);
});

test('jumps: a hard cut on a cut marker is fine, the same cut off any marker is a jump', () => {
  // frames 60 and 62 are the black frames; 210 is the cut on the marker at 7.0; 240 has no marker
  assert.deepEqual(report.jumps.map((j) => j.frame), [60, 62, 240]);
  const j = report.jumps[2];
  assert.equal(j.t, 8);
  assert.ok(j.from < 0.35 && j.to > 0.6 && j.delta > 0.25, JSON.stringify(j));
});

test('flashes: a steady picture and a few changes do not flash', () => {
  assert.ok(report.flashes.maxPerSecond <= 3, `max ${report.flashes.maxPerSecond}`);
  assert.deepEqual(report.flashes.failing, []);
});

test('flashes: 10 Hz fails, 2 Hz passes', async () => {
  const r = await analyseFile(strobes, { fps: FPS, duration: 5 });
  assert.equal(r.flashes.maxPerSecond, 10);
  assert.ok(r.flashes.failing.length > 0);
  for (const f of r.flashes.failing) {
    assert.ok(f.start < 0.1 && f.end > 1.8 && f.end < 2.2, JSON.stringify(f));
    assert.ok(f.count >= 9 && f.count <= 10);
  }
  assert.ok(r.flashes.failing.some((f) => f.region === 'frame'));
  assert.equal(new Set(r.flashes.failing.map((f) => f.region)).size, 5, 'the whole frame and every quarter');
  assert.equal(r.problems.filter((l) => /flashing/.test(l)).length, 1);

  // nothing fails after the calm second, and the window counts there are the 2 Hz ones
  const second = flashWindows(Array.from({ length: 60 }, (_, i) => (i % 15 < 8 ? 1 : 0.07)), FPS);
  assert.equal(second.max, 2);
  assert.deepEqual(second.failing, []);
});

test('flash counting: steps under 0.1 and light states above 0.8 do not count', () => {
  const alt = (hi, lo, n = 60) => Array.from({ length: n }, (_, i) => (i % 2 ? hi : lo));
  assert.equal(flashWindows(alt(0.5, 0.45), FPS).max, 0, 'a change of 0.05 is not a transition');
  assert.equal(flashWindows(alt(1, 0.85), FPS).max, 0, 'both states are lighter than 0.8');
  assert.ok(flashWindows(alt(1, 0.5), FPS).max >= 14, '15 Hz');
  assert.deepEqual(flashWindows([0.5, 0.5, 0.5], FPS), { max: 0, failing: [] });
});

test('silences: the 1.5 s gap in the sine is found and nothing else', () => {
  assert.equal(report.silences.length, 1, JSON.stringify(report.silences));
  const s = report.silences[0];
  assert.ok(Math.abs(s.start - 5) < 0.1 && Math.abs(s.duration - 1.5) < 0.1, JSON.stringify(s));
  assert.ok(Math.abs(s.end - s.start - s.duration) < 0.002);
});

test('the silence threshold and minimum length are options', async () => {
  const r = await analyseFile(main, { ...base, silence: { threshold: -50, minDuration: 2 } });
  assert.deepEqual(r.silences, []);
});

test('narration: head, tail, first and last word, words over a cut, words past the end', () => {
  const [a, b, c] = report.narration;
  assert.equal(b.item, 'b');
  assert.deepEqual(b.first, { t: 1, frame: 30 });
  assert.deepEqual(b.last, { t: 2.5, frame: 75 });
  assert.equal(b.head, 1);
  assert.equal(b.tail, 6.5);
  assert.deepEqual(b.overCuts, []);
  assert.deepEqual(b.outside, []);

  assert.equal(a.head, 0.5);
  assert.deepEqual(a.overCuts.map((x) => [x.word, x.t, x.cut]), [['across', 6.8, 7]]);
  assert.deepEqual(a.outside.map((w) => w.text), ['late']);
  assert.ok(a.tail < 0);

  assert.equal(c.first, null);
  assert.deepEqual(c.overCuts, []);
});

test('problems: one line for each thing to look at, none for the excused freeze, and the probe facts are checked', async () => {
  const text = report.problems.join('\n');
  assert.equal(report.problems.filter((l) => /black/.test(l)).length, 1, text);
  const frozen = report.problems.filter((l) => /frozen/.test(l));
  assert.equal(frozen.length, 1, text);
  assert.match(frozen[0], /0:05\.0/);
  assert.equal(report.problems.filter((l) => /jump/.test(l)).length, 3, text);
  assert.equal(report.problems.filter((l) => /silence/.test(l)).length, 1, text);
  assert.ok(report.problems.some((l) => /"late"/.test(l)), text);
  assert.equal(report.problems.length, 1 + 1 + 3 + 1 + 1, text);

  // expectations that the file does not meet
  const r = await analyseFile(main, { fps: 25, duration: 12, width: 1920, height: 1080 });
  for (const re of [/size is 320x180, expected 1920x1080/, /frame rate is 30 fps, expected 25/, /duration is .* expected 12/]) assert.ok(r.problems.some((l) => re.test(l)), `${re}\n${r.problems.join('\n')}`);
  // untagged colour is reported
  const untagged = await makeClip(join(dir, 'untagged.mp4'), [[moving(128), 15]], { tagged: false });
  assert.ok((await analyseFile(untagged, { fps: FPS, duration: 0.5 })).problems.some((l) => /colour tags/.test(l)));
  // one frame off is fine
  const ok = await analyseFile(nofast, { fps: FPS, duration: 1 + 1 / FPS });
  assert.ok(!ok.problems.some((l) => /duration/.test(l)));
});

test('sheet frames: every whole second and the middle of every cut segment, in order, no duplicates', () => {
  assert.deepEqual(sheetFrames({ fps: 30, duration: 9, markers: MARKERS }), [0, 30, 60, 90, 104, 120, 150, 180, 210, 239, 240]);
  assert.deepEqual(sheetFrames({ fps: 30, duration: 2, markers: [] }), [0, 29, 30]);
  // a segment middle that is already a whole second is listed once
  assert.deepEqual(sheetFrames({ fps: 2, duration: 3, markers: [{ t: 1, type: 'cut' }] }), [0, 2, 3, 4]);
  assert.equal(clock(12.15), '0:12.15');
  assert.equal(clock(75.5), '1:15.50');
});

/** Mean of R, G, B over a region of a PNG. */
async function regionOf(png, x, y, w, h) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(x, y, w, h).data;
  let sum = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++;
  }
  return { mean: sum / (d.length / 4), white };
}

test('encoded sheets: the frames asked for, PNGs of the right size, labels drawn, pictures from the right frames', async () => {
  const cw = 160, ch = 90, pad = 8, gap = 6, cols = 4;
  const sheets = await encodedSheets(main, { fps: FPS, duration: 9, markers: MARKERS, cellWidth: cw, cols, perSheet: 6 });
  assert.deepEqual(sheets.map((s) => s.frames), [[0, 30, 60, 90, 104, 120], [150, 180, 210, 239, 240]]);
  for (const s of sheets) {
    assert.equal(s.png.subarray(1, 4).toString(), 'PNG');
    assert.equal(s.width, pad * 2 + cols * cw + (cols - 1) * gap);
    assert.equal(s.height, pad * 2 + 2 * ch + gap);
    const img = await loadImage(s.png);
    assert.equal(img.width, s.width);
    assert.equal(img.height, s.height);
  }
  const cell = (i) => ({ x: pad + (i % cols) * (cw + gap), y: pad + Math.floor(i / cols) * (ch + gap) });

  // the label pill is not empty: white glyph pixels on a dark ground
  const c0 = cell(0);
  const label = await regionOf(sheets[0].png, c0.x, c0.y, 110, 20);
  assert.ok(label.white > 20, `${label.white} white pixels in the label`);
  assert.ok(label.mean < 120, `label ground ${label.mean}`);
  // on the black cell of frame 60 the only light pixels are the label's
  const c2 = cell(2);
  const l60 = await regionOf(sheets[0].png, c2.x, c2.y, 110, 20);
  const below = await regionOf(sheets[0].png, c2.x, c2.y + 30, 110, 20);
  assert.ok(l60.white > 20 && below.white === 0, `label ${l60.white}, below it ${below.white}`);

  // frame 60 is black, frame 30 is mid gray; 210 is dark and 240 bright
  const lower = (s, i) => regionOf(sheets[s].png, cell(i).x, cell(i).y + 24, cw, ch - 24);
  const f30 = await lower(0, 1), f60 = await lower(0, 2);
  assert.ok(f60.mean < 25, `frame 60 mean ${f60.mean}`);
  assert.ok(f30.mean > 90 && f30.mean < 170, `frame 30 mean ${f30.mean}`);
  const f210 = await lower(1, 2), f240 = await lower(1, 4);
  assert.ok(f240.mean - f210.mean > 80, `frame 210 ${f210.mean}, frame 240 ${f240.mean}`);
});

test('encoded sheets: defaults put a short clip on one sheet', async () => {
  const sheets = await encodedSheets(nofast, { fps: FPS, duration: 1, markers: [] });
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].frames, [0, 14]);
  assert.equal(sheets[0].width, 8 * 2 + 2 * 320 + 6);
});
