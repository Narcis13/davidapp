// Waveforms for audio items: the saved clip's mixed audio is decoded once (an OfflineAudioContext
// needs no user gesture and plays nothing), reduced to peaks per 10 ms, and each audio item draws
// the stretch of the mix it covers.

const RATE = 100;   // peak buckets per second
const cache = new Map();   // url → Promise<{ peaks: Float32Array, rate: number, duration: number } | null>

/** Peaks of an audio file, or null when it cannot be fetched or decoded. Cached per URL. */
export function loadPeaks(url) {
  if (!cache.has(url)) {
    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const Ctx = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
      if (!Ctx) return null;
      const buf = await new Ctx(1, 1, 44100).decodeAudioData(data);
      const n = Math.ceil(buf.duration * RATE);
      const peaks = new Float32Array(n);
      const per = buf.sampleRate / RATE;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < n; i++) {
          let m = 0;
          const a = Math.floor(i * per), b = Math.min(ch.length, Math.floor((i + 1) * per));
          for (let j = a; j < b; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; }
          if (m > peaks[i]) peaks[i] = m;
        }
      }
      return { peaks, rate: RATE, duration: buf.duration };
    })().catch(() => null);
    cache.set(url, p);
    // keep only a few mixes (each revision is a new URL)
    if (cache.size > 4) cache.delete(cache.keys().next().value);
  }
  return cache.get(url);
}

/**
 * Draw the peaks between clip times t0 and t1 into a canvas sized to its CSS box.
 * @param {HTMLCanvasElement} canvas
 * @param {{ peaks: Float32Array, rate: number }} data
 */
export function drawWaveform(canvas, data, t0, t1) {
  const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width));
  const hgt = Math.max(1, Math.round(canvas.clientHeight || canvas.height));
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = Math.min(8192, Math.round(w * dpr)); canvas.height = Math.round(hgt * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(canvas.width / w, 0, 0, canvas.height / hgt, 0, 0);
  g.clearRect(0, 0, w, hgt);
  g.fillStyle = 'rgba(160, 255, 214, 0.55)';
  const mid = hgt / 2;
  const span = Math.max(1e-6, t1 - t0);
  for (let x = 0; x < w; x++) {
    const a = Math.floor((t0 + (x / w) * span) * data.rate), b = Math.max(a + 1, Math.floor((t0 + ((x + 1) / w) * span) * data.rate));
    let m = 0;
    for (let i = a; i < b && i < data.peaks.length; i++) if (i >= 0 && data.peaks[i] > m) m = data.peaks[i];
    const y = Math.max(0.5, Math.min(1, m) * (mid - 2));
    g.fillRect(x, mid - y, 1, y * 2);
  }
}
