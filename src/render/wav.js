// 16-bit PCM WAV, stereo: what synthesized audio is cached as and what FFmpeg mixes. Plus the
// beat detector that turns a clip's music into f.clip.beats.

export function encodeWav(left, right, sampleRate) {
  const n = left.length;
  // WAVE_FORMAT_EXTENSIBLE, so the file states its channel layout (front left + front right)
  const buf = Buffer.alloc(68 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(60 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(40, 16); buf.writeUInt16LE(0xfffe, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.writeUInt16LE(22, 36); buf.writeUInt16LE(16, 38); buf.writeUInt32LE(3, 40);
  Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(buf, 44);
  buf.write('data', 60); buf.writeUInt32LE(n * 4, 64);
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0, o = 68; i < n; i++, o += 4) {
    buf.writeInt16LE(q(left[i]), o);
    buf.writeInt16LE(q(right[i]), o + 2);
  }
  return buf;
}

/** Find kick-like onsets: peaks in the rise of low-band energy. Returns times in seconds. */
export function detectBeats(samples, sampleRate) {
  const hop = Math.round(sampleRate / 100);
  const frames = Math.floor(samples.length / hop);
  if (frames < 4) return [];
  // two one-pole lowpasses at ~150 Hz isolate kick and bass
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const env = new Float64Array(frames);
  let y1 = 0, y2 = 0;
  for (let f = 0, i = 0; f < frames; f++) {
    let e = 0;
    for (let k = 0; k < hop; k++, i++) { y1 += a * (samples[i] - y1); y2 += a * (y1 - y2); e += y2 * y2; }
    env[f] = Math.sqrt(e / hop);
  }
  const flux = new Float64Array(frames);
  let mean = 0;
  for (let f = 1; f < frames; f++) { flux[f] = Math.max(0, env[f] - env[f - 1]); mean += flux[f]; }
  mean /= frames;
  let sd = 0;
  for (let f = 0; f < frames; f++) sd += (flux[f] - mean) ** 2;
  sd = Math.sqrt(sd / frames);
  const threshold = mean + 1.5 * sd;
  const beats = [];
  const minGap = 20; // 200 ms
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < threshold || flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    const last = beats[beats.length - 1];
    if (last !== undefined && f - last.f < minGap) { if (flux[f] > last.v) beats[beats.length - 1] = { f, v: flux[f] }; continue; }
    beats.push({ f, v: flux[f] });
  }
  return beats.map((b) => Math.round(((b.f * hop) / sampleRate) * 1000) / 1000);
}
