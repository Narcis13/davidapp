// Snow drawn in ink: little six-armed asterisks that drift down the page, turning and swaying,
// each one boiling like the rest of the drawings. For winters, of every kind.
asset({
  title: 'Sketched snowfall',
  description: 'Hand-drawn snowflakes (ink asterisks) drifting down over the frame, turning and swaying in the wind, boiling like the other sketch assets. Count, colour, size, speed and wind are parameters; fades in and out. Any length.',
  tags: ['sketch', 'hand-drawn', 'particles', 'snow', 'overlay', 'loop', 'weather'],
  uses: ['sketch-ink'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    color: { type: 'enum', options: ['ink', 'accent', 'accent2', 'accent3', 'pencil'], default: 'accent2' },
    count: { type: 'integer', default: 36, min: 1, max: 200 },
    size: { type: 'number', default: 2.4, min: 0.5, max: 10, step: 0.1, description: 'Flake radius in vmin' },
    speed: { type: 'number', default: 14, min: 1, max: 100, step: 0.5, description: 'Fall speed in vmin per second' },
    wind: { type: 'number', default: 3, min: -40, max: 40, step: 0.5, description: 'Sideways drift in vmin per second' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    fade: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const th = f.use(p.theme);
    const b = I.boil(f, p.boil);
    const W = f.width, H = f.height, u = f.vmin;
    ctx.save();
    ctx.globalAlpha = p.fade > 0 ? lib.envelope(f.t, f.duration, p.fade, p.fade) : 1;
    for (let i = 0; i < p.count; i++) {
      const r = f.rng.fork(`flake${i}`);
      const depth = r.range(0.55, 1.25);
      const rad = p.size * u * depth, fall = p.speed * u * depth;
      const span = H + rad * 4;
      const y = lib.mod(r.range(0, span) + f.t * fall, span) - rad * 2;
      const x = lib.mod(r.range(0, W) + f.t * p.wind * u + Math.sin(f.t * r.range(0.8, 1.6) + r.range(0, 6)) * u * 3, W + rad * 4) - rad * 2;
      const rot = r.range(0, Math.PI) + f.t * r.range(-0.8, 0.8);
      const arms = [];
      for (let a = 0; a < 3; a++) {
        const ang = rot + (a * Math.PI) / 3, c = Math.cos(ang) * rad, s = Math.sin(ang) * rad;
        arms.push(I.line(x - c, y - s, x + c, y + s));
      }
      I.strokes(f, arms, { width: Math.max(1.5, rad * 0.22), color: th[p.color] ?? th.ink, boil: b, seed: i * 3, lift: 0, overshoot: 0, style: 'pen', alpha: lib.clamp01(depth) });
    }
    ctx.restore();
  },
});
