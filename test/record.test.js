import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { probe } from '../src/render/ffmpeg.js';
import { easeInOut, encode, runs, sampleFrames, travelMs } from '../scripts/lib/record.mjs';

test('sampleFrames: each output frame shows the last captured frame at or before its time', () => {
  // frames at 0 s, 0.1 s, 0.5 s; 30 fps for 1 s → 30 output frames
  const idx = sampleFrames([0, 0.1, 0.5], 30, 1);
  assert.equal(idx.length, 30);
  assert.deepEqual(idx.slice(0, 3), [0, 0, 0]); // 0, 33 ms, 67 ms
  assert.equal(idx[3], 1); // 100 ms: the frame stamped exactly on the tick counts
  assert.equal(idx[14], 1); // 467 ms
  assert.equal(idx[15], 2); // 500 ms
  assert.equal(idx[29], 2);
});

test('sampleFrames: a burst between two ticks keeps only the last frame; idle stretches repeat one', () => {
  const idx = sampleFrames([0, 0.01, 0.02, 0.03, 2], 10, 3);
  assert.deepEqual(idx.slice(0, 2), [0, 3]); // t=0 → frame 0; t=0.1 → frame 3 (0.01..0.03 skipped)
  assert.equal(idx[19], 3);
  assert.equal(idx[20], 4);
  assert.equal(idx.length, 30);
});

test('sampleFrames: the count is ceil(duration × fps); a first frame later than 0 is still shown from the start', () => {
  assert.equal(sampleFrames([0], 30, 20.01).length, 601);
  assert.equal(sampleFrames([0], 30, 20).length, 600);
  assert.deepEqual(sampleFrames([0.2], 10, 0.5), [0, 0, 0, 0, 0]);
  assert.equal(sampleFrames([0], 24, 0.001).length, 1);
});

test('sampleFrames: no frames is an error, not an empty video', () => {
  assert.throws(() => sampleFrames([], 30, 1), /no frames/);
});

test('runs: consecutive repeats become one write', () => {
  assert.deepEqual(runs([0, 0, 0, 1, 1, 2, 0]), [{ frame: 0, count: 3 }, { frame: 1, count: 2 }, { frame: 2, count: 1 }, { frame: 0, count: 1 }]);
  assert.deepEqual(runs([]), []);
});

test('the cursor eases in and out and takes a few hundred ms', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9);
  for (const d of [0, 50, 400, 1500, 5000]) assert.ok(travelMs(d) >= 320 && travelMs(d) <= 900);
  assert.ok(travelMs(800) > travelMs(100));
});

test('encode: irregular frames become a constant-rate H.264 file with BT.709 tags', async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'record-test-'));
  try {
    const frames = ['#c03030', '#3050c0', '#30a050'].map((color, i) => {
      const c = createCanvas(64, 48);
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, 64, 48);
      const file = join(dir, `f${i}.png`);
      writeFileSync(file, c.toBuffer('image/png'));
      return { file, time: [0, 0.33, 0.9][i] };
    });
    const out = join(dir, 'out.mp4');
    const r = await encode(frames, { out, fps: 10, duration: 1.5, width: 64, height: 48, format: 'png', preset: 'ultrafast' });
    assert.equal(r.frames, 15);
    assert.equal(r.captured, 3);
    const v = (await probe(out)).streams.find((s) => s.codec_type === 'video');
    assert.equal(v.codec_name, 'h264');
    assert.equal(v.pix_fmt, 'yuv420p');
    assert.equal(v.r_frame_rate, '10/1');
    assert.equal(v.avg_frame_rate, '10/1');
    assert.equal(v.nb_frames, '15');
    assert.equal(v.color_space, 'bt709');
    assert.equal(v.color_transfer, 'bt709');
    assert.equal(v.color_primaries, 'bt709');
    assert.equal(v.width, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
