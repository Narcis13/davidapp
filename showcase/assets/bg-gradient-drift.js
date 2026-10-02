// A living background: large soft blobs of colour drifting on noise over a dark base, with a
// vignette. It can breathe with the clip's beats.
asset({
  title: 'Gradient drift',
  description: 'Full-frame animated background: soft colour blobs drift slowly over a dark base, with a vignette. Loops for any length; optionally pulses on the clip\'s beats.',
  tags: ['background', 'gradient', 'ambient', 'loop'],
  params: {
    base: { type: 'color', default: '#0b0b12' },
    colors: { type: 'array', of: { type: 'color' }, default: ['#ff5c8a', '#ffd166', '#5b6cff'], minItems: 1, maxItems: 5 },
    intensity: { type: 'number', default: 0.42, min: 0, max: 1, step: 0.01 },
    speed: { type: 'number', default: 0.12, min: 0, max: 1, step: 0.01 },
    blobSize: { type: 'number', default: 0.75, min: 0.2, max: 1.5, step: 0.01, description: 'Blob radius as a fraction of the longer side' },
    vignette: { type: 'number', default: 0.55, min: 0, max: 1, step: 0.01 },
    beatPulse: { type: 'number', default: 0.15, min: 0, max: 1, step: 0.01, description: 'How much the blobs brighten on each beat' },
  },
  render(f, p) {
    const { ctx, width: w, height: h, lib } = f;
    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, w, h);
    const n = lib.noise(f.seed);
    const t = f.clip.t * p.speed;
    const pulse = lib.beat.pulse(f.clip.t, f.clip.beats, 0.3) * p.beatPulse;
    const r = Math.max(w, h) * p.blobSize;
    ctx.globalCompositeOperation = 'lighter';
    p.colors.forEach((color, i) => {
      const cx = w * (0.5 + 0.55 * n(t, i * 7.3, 1.1));
      const cy = h * (0.5 + 0.55 * n(i * 3.7, t, 5.9));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * (0.85 + 0.15 * n(t * 1.7, i, 9)));
      g.addColorStop(0, lib.color.alpha(color, Math.min(1, p.intensity + pulse)));
      g.addColorStop(0.55, lib.color.alpha(color, (p.intensity + pulse) * 0.28));
      g.addColorStop(1, lib.color.alpha(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    ctx.globalCompositeOperation = 'source-over';
    if (p.vignette > 0) {
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, lib.color.alpha('#000000', p.vignette));
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
  },
});
