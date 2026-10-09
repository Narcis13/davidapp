// A picture of the ducking: the narration's speech as blocks on one lane, the music's gain on the lane under
// it, dipping while the voice speaks and coming back in the pauses. Reads f.clip.words; the dip follows the
// same rule as the studio's mixer (down by `by` dB, an attack before each stretch, a release after it).
asset({
  title: 'Duck meter',
  description: 'A diagram of music ducking under a voice: speech stretches from the narration\'s words on top, the music\'s gain curve below dipping while the voice speaks, scrolling with the clip. Reads f.clip.words; by, attack and release mirror the clip\'s ducking. Takes a theme.',
  tags: ['narration', 'audio', 'ducking', 'diagram', 'scene', 'mix'],
  duration: 6,
  floor: 2.6,
  uses: ['easing'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    by: { type: 'number', default: 18, min: 0, max: 60, step: 0.5, description: 'How far the music drops, in dB' },
    attack: { type: 'number', default: 0.15, min: 0, max: 2, step: 0.01 },
    release: { type: 'number', default: 0.45, min: 0, max: 5, step: 0.01 },
    hold: { type: 'number', default: 0.25, min: 0, max: 2, step: 0.01 },
    seconds: { type: 'number', default: 8, min: 2, max: 30, step: 0.1, description: 'Seconds across the diagram' },
    size: { type: 'number', default: 3.2, min: 2.6, max: 8, step: 0.1, description: 'Label size in % of the frame\'s short side' },
    inDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short;
    const t = f.clip?.t ?? f.t;
    // speech stretches: words closer than `hold` are one stretch
    const regions = [];
    for (const w of f.clip?.words ?? []) {
      const last = regions[regions.length - 1];
      if (last && w.start - last[1] < p.hold) last[1] = Math.max(last[1], w.end); else regions.push([w.start, w.end]);
    }
    const duck = (x) => {
      let db = 0;
      for (const [a, b] of regions) {
        let d = 0;
        if (x >= a && x <= b) d = 1;
        else if (x < a && x > a - p.attack) d = 0.5 - 0.5 * Math.cos(Math.PI * (1 - (a - x) / p.attack));
        else if (x > b && x < b + p.release) d = 0.5 + 0.5 * Math.cos(Math.PI * ((x - b) / p.release));
        db = Math.min(db, -p.by * d);
      }
      return db;
    };
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const pad = size * 0.8, labelW = size * 6;
    const lane = (f.height - pad * 3) / 2;
    const x0 = pad + labelW, x1 = f.width - pad, pps = (x1 - x0) / p.seconds, now = x0 + (x1 - x0) * 0.6;
    const at = (x) => t + (x - now) / pps;
    ctx.save();
    ctx.globalAlpha = Math.min(k, out);
    ctx.fillStyle = th.surface;
    ctx.beginPath();
    ctx.roundRect(0, 0, f.width, f.height, size * 0.4);
    ctx.fill();
    const label = (text, y, color) => {
      const L = lib.text.layout(ctx, text, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size });
      ctx.fillStyle = color;
      lib.text.fill(ctx, L, pad, y - L.height / 2);
    };
    // voice lane
    const vy = pad, my = pad * 2 + lane;
    label('Voice', vy + lane / 2, th.ink);
    ctx.fillStyle = th.accent2;
    for (const [a, b] of regions) {
      const xa = Math.max(x0, now + (a - t) * pps), xb = Math.min(x1, now + (b - t) * pps);
      if (xb > xa) ctx.fillRect(xa, vy + lane * 0.2, xb - xa, lane * 0.6);
    }
    // music lane: the gain curve, 0 dB at the top of the lane, -by dB at its bottom
    label('Music', my + lane / 2, th.ink);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 2) {
      const y = my + lane * 0.15 + (lane * 0.7 * -duck(at(x))) / Math.max(1, p.by);
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // now
    ctx.fillStyle = th.ink;
    ctx.fillRect(now - 1, pad * 0.5, 2, f.height - pad);
    const dbNow = duck(t);
    const tag = lib.text.layout(ctx, dbNow < -0.5 ? `−${Math.round(-dbNow)} dB` : '0 dB', { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size });
    const tx = Math.min(now + size * 0.5, x1 - tag.width - size * 0.3), ty = my + lane - tag.height;
    // its own small plate, so the curve never runs behind the letters
    ctx.fillStyle = th.bg;
    ctx.beginPath();
    ctx.roundRect(tx - size * 0.3, ty - size * 0.15, tag.width + size * 0.6, tag.height + size * 0.3, size * 0.2);
    ctx.fill();
    ctx.fillStyle = th.accent;
    lib.text.fill(ctx, tag, tx, ty);
    ctx.restore();
  },
});
