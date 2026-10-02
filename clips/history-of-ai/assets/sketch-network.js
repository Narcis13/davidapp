// A neural network sketched on paper: neurons are hand-drawn circles coloured in with marker,
// connections are pencil lines of uneven weight. It draws layer by layer, then signals run through
// it as ink dots and each neuron flashes when they arrive.
asset({
  title: 'Sketched neural network',
  description: 'Hand-drawn neural network that draws itself layer by layer (circles for neurons, pencil lines of varying weight for connections), then fires: dots of ink travel through the layers and neurons light up as they arrive. Layer sizes are a parameter: [3, 1] is a perceptron, [4, 6, 6, 3] a deep net. Optional input and output labels.',
  tags: ['sketch', 'hand-drawn', 'diagram', 'neural-network', 'draw-on', 'ai'],
  uses: ['sketch-ink', 'easing'],
  params: {
    layers: { type: 'array', of: { type: 'integer', min: 1, max: 12 }, default: [3, 5, 5, 2], minItems: 2, maxItems: 8 },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    inputs: { type: 'array', of: { type: 'string' }, default: [], maxItems: 12, description: 'Labels written left of the input neurons' },
    output: { type: 'string', default: '', description: 'Label written right of the output layer' },
    sum: { type: 'boolean', default: false, description: 'Write Σ inside the output neurons (a perceptron)' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05 },
    drawDur: { type: 'number', default: 2, min: 0.2, max: 10, step: 0.05 },
    fire: { type: 'boolean', default: true, description: 'Send signals through once it is drawn' },
    period: { type: 'number', default: 1.4, min: 0.4, max: 6, step: 0.05, description: 'Seconds per wave of signals' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    pad: { type: 'number', default: 0.08, min: 0, max: 0.4, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const b = I.boil(f, p.boil);
    const n = p.layers.length, most = Math.max(...p.layers);
    const labelW = (p.inputs.length ? 0.12 : 0) * f.width, outW = (p.output ? 0.24 : 0) * f.width;
    const bx = f.width * p.pad + labelW, by = f.height * p.pad, bw = f.width * (1 - 2 * p.pad) - labelW - outW, bh = f.height * (1 - 2 * p.pad);
    const colGap = bw / Math.max(1, n - 1), rowGap = bh / most;
    const r = Math.min(colGap * 0.16, rowGap * 0.34, f.vmin * 7);
    const pos = p.layers.map((m, l) => Array.from({ length: m }, (_, j) => [bx + (n === 1 ? bw / 2 : l * colGap), by + bh / 2 + (j - (m - 1) / 2) * rowGap]));
    const lw = Math.max(1.5, r * 0.14);

    // draw order: a layer's neurons, then the connections to the next layer
    const items = [];
    pos.forEach((layer, l) => {
      layer.forEach((c, j) => items.push({ kind: 'node', l, j, pts: I.circle(c[0], c[1], r, { seed: l * 7 + j, turns: 1.08 }), width: lw * 1.2, color: th.ink }));
      if (l < n - 1) layer.forEach((a, j) => pos[l + 1].forEach((c, m) => {
        const w = 0.35 + I.hash(l * 31 + j * 7 + m * 3) * 0.9;
        const dx = c[0] - a[0], dy = c[1] - a[1], d = Math.hypot(dx, dy);
        items.push({ kind: 'edge', l, j, m, pts: I.line(a[0] + (dx / d) * r * 1.1, a[1] + (dy / d) * r * 1.1, c[0] - (dx / d) * r * 1.1, c[1] - (dy / d) * r * 1.1), width: lw * w, color: th.pencil, style: 'pencil', overshoot: 0 });
      }));
    });
    const lens = items.map((it) => I.lengthOf(it.pts)), total = lens.reduce((a, c) => a + c, 0);
    let acc = 0;
    const ends = lens.map((len) => (acc += len) / total);
    const k = lib.clamp01(t / p.drawDur);

    // neurons fill with marker once their circle is closed
    const fillCol = (l) => (l === 0 ? th.accent2 : l === n - 1 ? th.accent : th.highlight);
    const wave = p.fire ? (t - p.drawDur - 0.2) / p.period : -1;
    const front = wave >= 0 ? lib.fract(wave) * (n - 0.4) : -10;
    items.forEach((it, i) => {
      if (it.kind !== 'node') return;
      const fk = lib.clamp01((t - ends[i] * p.drawDur) / 0.25);
      if (fk <= 0) return;
      const c = pos[it.l][it.j];
      const glow = Math.max(0, 1 - Math.abs(front - it.l) * 2.5);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.8 * E.outCubic(fk);
      ctx.fillStyle = fillCol(it.l);
      ctx.beginPath(); ctx.arc(c[0] + r * 0.08, c[1] + r * 0.06, r * (0.92 + 0.25 * glow), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (glow > 0) I.stroke(f, I.circle(c[0], c[1], r * (1.3 + 0.35 * (1 - glow)), { seed: it.l + 40, turns: 1 }), { width: lw * 0.8, color: th.accent, alpha: glow, boil: b, seed: 70 + i });
    });
    I.strokes(f, items, { progress: k, boil: b, seed: 3, lift: 0 });

    // signals: ink dots travelling along every connection of the layer the wave is crossing
    if (front >= 0) {
      const l = Math.floor(front), u = front - l;
      if (l < n - 1) {
        ctx.fillStyle = th.ink;
        pos[l].forEach((a, j) => pos[l + 1].forEach((c, m) => {
          if (I.hash(j * 5 + m * 11 + Math.floor(wave) * 3) < 0.35 && pos[l].length * pos[l + 1].length > 6) return;
          const e = E.inOutQuad(lib.clamp01(u));
          ctx.beginPath(); ctx.arc(lib.lerp(a[0], c[0], e), lib.lerp(a[1], c[1], e), r * 0.17, 0, Math.PI * 2); ctx.fill();
        }));
      }
    }

    // labels
    const fs = Math.max(14, r * 0.9);
    ctx.font = `700 ${fs}px "Space Grotesk"`;
    ctx.textBaseline = 'middle';
    const lk = lib.clamp01((k - 0.15) / 0.2);
    if (lk > 0) {
      ctx.save();
      ctx.globalAlpha *= lk;
      ctx.fillStyle = th.ink;
      ctx.textAlign = 'right';
      p.inputs.slice(0, p.layers[0]).forEach((s, j) => ctx.fillText(s, pos[0][j][0] - r * 1.6, pos[0][j][1]));
      ctx.restore();
    }
    const ok = lib.clamp01((k - 0.95) / 0.05);
    if (ok > 0) {
      ctx.save();
      ctx.globalAlpha *= ok;
      const last = pos[n - 1];
      if (p.sum) for (const [cx, cy] of last) {
        const q = r * 0.45;
        I.stroke(f, [[cx + q, cy - q], [cx - q, cy - q], [cx + q * 0.15, cy], [cx - q, cy + q], [cx + q, cy + q]], { width: lw * 1.1, color: th.ink, boil: b, seed: 21, progress: ok * 1.5 });
      }
      if (p.output) {
        ctx.font = `700 ${fs}px "Space Grotesk"`; ctx.textAlign = 'left'; ctx.fillStyle = th.accent;
        const cy = last.reduce((a, c) => a + c[1], 0) / last.length;
        ctx.fillText(p.output, last[0][0] + r * 2.4, cy);
        I.strokes(f, I.arrow(last[0][0] + r * 1.2, cy, last[0][0] + r * 2.1, cy, { bend: 0, head: r * 0.3 }), { width: lw, color: th.accent, boil: b, seed: 9 });
      }
      ctx.restore();
    }
  },
});
