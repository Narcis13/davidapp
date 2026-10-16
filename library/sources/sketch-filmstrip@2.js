// A strip of film drawn by hand: an ink band with sprocket holes and paper windows, each window one frame of a tiny
// animation (a ball rolling across, a bar growing, a square spinning) at that frame's moment, with a handwritten label.
// The band draws on, the frames pop in one after another, then a playhead ring steps from frame to frame for as long
// as the item lasts, so a held strip still moves. Sizes are a share of the frame's short side with a floor.
// Version 2 (on sketch-ink@3): the band no longer turns grey while it fades in.
// Usage: "a video is frames, each one a moment of time", next to the code that draws them.
//   { "asset": "sketch-filmstrip", "start": 9, "duration": 9, "params": { "labels": ["t = 0 s", "t = 1 s", "t = 2 s"],
//       "subject": "ball", "direction": "vertical", "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.8, "y": 0.62, "width": 0.36, "height": 0.7 } }
asset({
  title: 'Sketched film strip',
  description: 'A hand-drawn film strip: an ink band with sprocket holes and paper windows, each window a frame of a tiny animation (ball rolling across, bar growing, square spinning) at its moment, a handwritten label per frame. The band draws on, frames pop in staggered, then a playhead ring steps through the frames. Horizontal or vertical. For doodle explainers of "a video is frames" or "a frame is a function of time".',
  tags: ['sketch', 'hand-drawn', 'doodle', 'film', 'frames', 'animation', 'explainer', 'diagram'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    labels: { type: 'array', of: { type: 'string' }, minItems: 2, maxItems: 6, default: ['t = 0 s', 't = 1 s', 't = 2 s'] },
    subject: { type: 'enum', options: ['ball', 'bar', 'spin'], default: 'ball' },
    direction: { type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal' },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    labelSize: { type: 'number', default: 4.4, min: 2.5, max: 10, step: 0.1, description: '% of the frame\'s short side' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05 },
    drawDur: { type: 'number', default: 0.7, min: 0.1, max: 4, step: 0.05 },
    stagger: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.01, description: 'Seconds between frames popping in' },
    step: { type: 'number', default: 0.8, min: 0, max: 4, step: 0.05, description: 'Seconds the playhead rests on each frame (0: no playhead)' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height), u = short / 100;
    const b = I.boil(f, p.boil);
    const out = p.outDur > 0 ? E.inCubic(lib.clamp01(1 - (f.duration - f.t) / p.outDur)) : 0;
    const n = p.labels.length, vert = p.direction === 'vertical';
    const font = th.fonts?.body ?? 'Kalam';
    const ls = p.labelSize * u;
    const labels = p.labels.map((s) => lib.text.layout(ctx, s, { font, weight: 700, size: ls, maxWidth: vert ? f.width * 0.42 : f.width / n - u, fit: true, wrap: 'none', floor: p.floor }));
    const labelW = Math.max(...labels.map((L) => L.width)), labelH = Math.max(...labels.map((L) => L.height));
    // the band: windows of 16:9 between two rows of sprocket holes
    const rim = u * 3.4, gap = u * 1.6;
    let winW, winH, bx, by, bw, bh;
    if (vert) {
      const availW = f.width - labelW - u * 3, availH = f.height;
      winH = Math.min((availH - rim * 0 - gap * (n + 1)) / n, ((availW - rim * 2) * 9) / 16);
      winW = (winH * 16) / 9;
      bw = winW + rim * 2; bh = winH * n + gap * (n + 1);
      bx = (f.width - bw - labelW - u * 3) / 2; by = (f.height - bh) / 2;
    } else {
      const availH = f.height - labelH - u * 2.5;
      winW = Math.min((f.width - gap * (n + 1)) / n, ((availH - rim * 2) * 16) / 9);
      winH = (winW * 9) / 16;
      bw = winW * n + gap * (n + 1); bh = winH + rim * 2;
      bx = (f.width - bw) / 2; by = (f.height - bh - labelH - u * 2.5) / 2;
    }
    ctx.save();
    ctx.globalAlpha = 1 - out;
    // the band draws on, then fills with ink
    const kd = E.outCubic(lib.clamp01(t / p.drawDur));
    I.card(f, bx, by, bw, bh, { progress: kd, fill: th.ink, color: th.ink, shadow: th.accent, shadowX: u * 0.8, shadowY: u * 1, radius: u * 1.2, boil: b, seed: 5, width: u * 0.45 });
    // sprocket holes along both long edges
    const kh = lib.clamp01((t - p.drawDur * 0.5) / 0.4);
    if (kh > 0) {
      ctx.save();
      ctx.globalAlpha = (1 - out) * kh;
      ctx.fillStyle = th.paper ?? th.bg;
      const holes = vert ? Math.round(bh / (u * 3.2)) : Math.round(bw / (u * 3.2));
      for (let i = 0; i < holes; i++) {
        const s = (i + 0.5) / holes, hw = u * 1.3, hh = u * 1.1;
        if (vert) {
          for (const x of [bx + rim * 0.5, bx + bw - rim * 0.5]) { ctx.beginPath(); ctx.roundRect(x - hh / 2, by + s * bh - hw / 2, hh, hw, u * 0.3); ctx.fill(); }
        } else {
          for (const y of [by + rim * 0.5, by + bh - rim * 0.5]) { ctx.beginPath(); ctx.roundRect(bx + s * bw - hw / 2, y - hh / 2, hw, hh, u * 0.3); ctx.fill(); }
        }
      }
      ctx.restore();
    }
    // the frames
    const t0 = p.drawDur * 0.7;
    const allIn = t0 + p.stagger * (n - 1) + 0.5;
    const head = p.step > 0 && t > allIn ? Math.floor((t - allIn) / p.step) % n : -1;
    for (let i = 0; i < n; i++) {
      const k = E.outBack(lib.clamp01((t - t0 - i * p.stagger) / 0.45));
      if (k <= 0) continue;
      const wx = vert ? bx + rim : bx + gap + i * (winW + gap), wy = vert ? by + gap + i * (winH + gap) : by + rim;
      const cx = wx + winW / 2, cy = wy + winH / 2;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      ctx.fillStyle = th.surface ?? '#fffaf0';
      ctx.beginPath(); ctx.roundRect(wx, wy, winW, winH, u * 0.6); ctx.fill();
      // the subject at this frame's moment
      const m = n > 1 ? i / (n - 1) : 0;
      const pad = winW * 0.14, gy = wy + winH * 0.78;
      I.stroke(f, I.line(wx + pad * 0.6, gy, wx + winW - pad * 0.6, gy), { width: u * 0.3, color: th.pencil, style: 'pencil', boil: b, seed: 40 + i });
      if (p.subject === 'ball') {
        const r = winH * 0.17, x = wx + pad + r + m * (winW - 2 * pad - 2 * r), y = gy - r - u * 0.3;
        // a dotted trail of where it was
        ctx.fillStyle = lib.color.alpha(th.pencil, 0.5);
        for (let d = wx + pad + r; d < x - r * 1.2; d += u * 1.4) { ctx.beginPath(); ctx.arc(d, y, u * 0.25, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = th.accent2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        I.stroke(f, I.circle(x, y, r, { seed: 50 + i }), { width: u * 0.35, color: th.ink, boil: b, seed: 60 + i, wobble: 0.5 });
      } else if (p.subject === 'bar') {
        const h = (0.2 + 0.8 * m) * winH * 0.55, w = winW * 0.22, x = cx - w / 2;
        ctx.fillStyle = th.accent2; ctx.fillRect(x, gy - h, w, h);
        I.strokes(f, I.rect(x, gy - h, w, h), { width: u * 0.35, color: th.ink, boil: b, seed: 70 + i, wobble: 0.5 });
      } else {
        const s = winH * 0.4, a = m * Math.PI * 0.5;
        ctx.save(); ctx.translate(cx, wy + winH * 0.45); ctx.rotate(a);
        ctx.fillStyle = th.accent2; ctx.fillRect(-s / 2, -s / 2, s, s);
        I.strokes(f, I.rect(-s / 2, -s / 2, s, s), { width: u * 0.35, color: th.ink, boil: b, seed: 80 + i, wobble: 0.5 });
        ctx.restore();
      }
      ctx.restore();
      // the label
      const L = labels[i];
      const kl = lib.clamp01((t - t0 - i * p.stagger - 0.15) / 0.3);
      if (kl > 0) {
        ctx.save();
        ctx.globalAlpha = (1 - out) * kl;
        const lx = vert ? bx + bw + u * 3 : cx - L.width / 2, ly = vert ? cy - L.height / 2 : by + bh + u * 2.5;
        lib.text.fill(ctx, L, lx, ly, { color: i === head ? th.accent : th.ink });
        ctx.restore();
      }
      // the playhead: a violet ring around the current frame
      if (i === head) {
        const kr = E.outCubic(lib.clamp01(((t - allIn) % p.step) / 0.25));
        I.stroke(f, I.roundBox(wx - u * 0.7, wy - u * 0.7, winW + u * 1.4, winH + u * 1.4, u * 1), { width: u * 0.7, color: th.accent, progress: kr, closed: true, boil: b, seed: 90 + i, wobble: 0.5 });
      }
    }
    ctx.restore();
  },
});
