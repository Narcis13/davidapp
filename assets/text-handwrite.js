// Hand-lettered text, written glyph by glyph: each letter is revealed by the pen moving across it
// (a pencil rides the writing), sits at its own slightly-off angle and baseline like real
// handwriting, and keeps boiling once written. Three looks: plain ink, marker (colour fill with a
// misregistered ink outline) and sketch (an ink outline with hatching inside). *Emphasis* gets a
// highlighter swipe; an underline, double underline, scribble or circle is drawn when it is done.
asset({
  title: 'Hand-lettered text',
  description: 'Text written on by hand, glyph by glyph with a pencil at the pen, irregular per-letter angles and baselines that boil. Looks: ink, marker (fill + offset outline) or sketch (outline + hatching). *Emphasised* words get their own colour and a highlighter swipe; an underline, double underline, scribble or circle is drawn after the writing. Fits the safe zone or its box.',
  tags: ['text', 'text-animation', 'sketch', 'hand-drawn', 'handwriting', 'write-on'],
  uses: ['sketch-ink', 'easing'],
  params: {
    text: { type: 'text', default: 'A brief history of *AI*' },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    look: { type: 'enum', options: ['ink', 'marker', 'sketch'], default: 'ink' },
    font: { type: 'font', default: 'Space Grotesk' },
    weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
    size: { type: 'number', default: 120, min: 12, max: 600, step: 1, description: 'Largest size; shrinks to fit' },
    lineHeight: { type: 'number', default: 1.08, min: 0.7, max: 2, step: 0.01 },
    uppercase: { type: 'boolean', default: false },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
    valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
    color: { type: 'enum', options: ['ink', 'accent', 'accent2', 'accent3', 'pencil', 'highlight'], default: 'ink' },
    emColor: { type: 'enum', options: ['ink', 'accent', 'accent2', 'accent3', 'pencil', 'highlight'], default: 'accent' },
    highlight: { type: 'boolean', default: true, description: 'Highlighter swipe behind *emphasis*' },
    underline: { type: 'enum', options: ['none', 'line', 'double', 'scribble', 'circle'], default: 'none' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05 },
    writeDur: { type: 'number', default: 1.2, min: 0.1, max: 20, step: 0.05, description: 'Seconds to write the whole text' },
    jitter: { type: 'number', default: 1, min: 0, max: 3, step: 0.05, description: 'How unsteady the hand is' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    pencil: { type: 'boolean', default: true },
    exit: { type: 'enum', options: ['none', 'fade'], default: 'none' },
    outDur: { type: 'number', default: 0.4, min: 0.05, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const box = f.safe;
    const L = lib.text.layout(ctx, p.text, { font: p.font, weight: p.weight, size: p.size, lineHeight: p.lineHeight, maxWidth: box.width, maxHeight: box.height, fit: true, minSize: 12, align: p.align, markup: true, transform: p.uppercase ? 'upper' : undefined });
    const x0 = box.x, y0 = box.y + (p.valign === 'top' ? 0 : p.valign === 'bottom' ? box.height - L.height : (box.height - L.height) / 2);
    const S = L.size, b = I.boil(f, p.boil), J = p.jitter;
    const col = (role) => th[role] ?? th.ink;

    // when each glyph is written: wider letters take longer, a short pause between words
    const G = L.glyphs;
    const weights = G.map((g, i) => g.width + (i && G[i - 1].word !== g.word ? S * 0.35 : 0));
    const total = weights.reduce((a, c) => a + c, 0) || 1;
    let acc = 0;
    const timing = G.map((g, i) => { acc += weights[i]; const end = (acc / total) * p.writeDur, len = Math.max(0.05, (g.width / total) * p.writeDur * 1.4); return [end - len, len]; });
    const kOf = (i) => lib.clamp01((t - timing[i][0]) / timing[i][1]);

    const pose = (g) => {
      const h = (n) => I.hash(g.index * 12.9898 + n);
      const rot = (h(1) - 0.5) * 0.1 * J + (I.hash(b * 3.1 + g.index) - 0.5) * 0.025 * J;
      const dy = (h(2) - 0.5) * S * 0.06 * J + (I.hash(b * 1.7 + g.index) - 0.5) * S * 0.012 * J;
      const dx = (I.hash(b * 2.3 + g.index * 0.7) - 0.5) * S * 0.012 * J;
      const sc = 1 + (h(3) - 0.5) * 0.08 * J;
      return { rot, dx, dy, sc };
    };
    const at = (c, g, k, draw) => {
      const q = pose(g);
      const gx = x0 + g.x, gy = y0 + g.y;
      c.save();
      c.translate(gx + g.width / 2 + q.dx, gy - S * 0.35 + q.dy);
      c.rotate(q.rot);
      c.scale(q.sc, q.sc);
      c.translate(-(gx + g.width / 2), -(gy - S * 0.35));
      if (k < 1) { c.beginPath(); c.rect(gx - S * 0.2, y0 + g.top - S * 0.3, S * 0.2 + g.width * k, g.height + S * 0.6); c.clip(); }
      c.font = g.font; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      draw(c, g, gx, gy);
      c.restore();
    };

    ctx.save();
    if (p.exit === 'fade') ctx.globalAlpha = lib.clamp01((f.duration - f.t) / p.outDur);

    // highlighter behind emphasised words, swiped as each word is written
    if (p.highlight) {
      for (const w of L.words) {
        if (!w.em || !w.glyphs.length) continue;
        const first = w.glyphs[0].index, last = w.glyphs[w.glyphs.length - 1].index;
        const k = lib.clamp01((t - timing[first][0] + 0.08) / (timing[last][0] + timing[last][1] - timing[first][0] + 0.1));
        if (k <= 0) continue;
        const y = y0 + w.y - S * 0.3;
        I.stroke(f, I.line(x0 + w.x - S * 0.08, y + S * 0.04, x0 + w.x + w.width + S * 0.08, y - S * 0.02), { style: 'marker', width: S * 0.62, color: th.highlight, progress: E.outCubic(k), boil: b, seed: w.index * 5 + 2, wobble: 0.6 });
      }
    }

    const roleOf = (g) => (g.em ? p.emColor : p.color);
    if (p.look === 'sketch') {
      // hatching clipped to the letters: fill the written letters on a layer, keep the hatch lines inside them
      const mask = f.offscreen(f.width, f.height);
      G.forEach((g, i) => { const k = kOf(i); if (k > 0) at(mask.ctx, g, k, (c, gg, x, y) => { c.fillStyle = '#000'; c.fillText(gg.ch, x, y); }); });
      const layer = f.offscreen(f.width, f.height);
      const gap = Math.max(3, S * 0.075);
      I.strokes(f, I.hatch(x0, y0 - S * 0.2, box.width, L.height + S * 0.4, { gap, angle: -0.9, seed: 4 }), { ctx: layer.ctx, width: Math.max(1.2, S * 0.022), color: col(p.color), style: 'pen', boil: b, lift: 0, wobble: 0.5 });
      layer.ctx.globalCompositeOperation = 'destination-in';
      layer.ctx.drawImage(mask.canvas, 0, 0);
      if (L.words.some((w) => w.em)) {
        // emphasised letters hatch in their own colour: repaint them on top through a second mask
        const em = f.offscreen(f.width, f.height);
        G.forEach((g, i) => { const k = kOf(i); if (k > 0 && g.em) at(em.ctx, g, k, (c, gg, x, y) => { c.fillStyle = '#000'; c.fillText(gg.ch, x, y); }); });
        em.ctx.globalCompositeOperation = 'source-in';
        em.ctx.fillStyle = col(p.emColor);
        em.ctx.globalAlpha = 0.8;
        em.ctx.fillRect(0, 0, f.width, f.height);
        ctx.drawImage(em.canvas, 0, 0);
      }
      ctx.drawImage(layer.canvas, 0, 0);
      G.forEach((g, i) => {
        const k = kOf(i);
        if (k <= 0) return;
        at(ctx, g, k, (c, gg, x, y) => {
          c.strokeStyle = col(roleOf(gg)); c.lineJoin = 'round';
          c.lineWidth = Math.max(1.5, S * 0.03); c.strokeText(gg.ch, x, y);
          c.globalAlpha *= 0.5; c.lineWidth = Math.max(1, S * 0.014); c.strokeText(gg.ch, x + S * 0.012 * J, y - S * 0.01 * J);
        });
      });
    } else {
      G.forEach((g, i) => {
        const k = kOf(i);
        if (k <= 0) return;
        at(ctx, g, k, (c, gg, x, y) => {
          if (p.look === 'marker') {
            const off = S * 0.035 * J;
            c.save();
            c.globalCompositeOperation = 'multiply';
            c.fillStyle = col(gg.em ? p.emColor : p.color === 'ink' ? 'accent' : p.color);
            c.globalAlpha *= 0.9;
            c.fillText(gg.ch, x + off, y + off * 0.6);
            c.restore();
            c.strokeStyle = th.ink; c.lineJoin = 'round'; c.lineWidth = Math.max(1.5, S * 0.028);
            c.strokeText(gg.ch, x, y);
          } else {
            c.fillStyle = col(roleOf(gg));
            c.fillText(gg.ch, x, y);
          }
        });
      });
    }

    // the pencil follows the letter being written, bobbing like a hand forming strokes
    const writing = G.findIndex((g, i) => { const k = kOf(i); return k > 0 && k < 1; });
    if (p.pencil && writing >= 0) {
      const g = G[writing], k = kOf(writing), q = pose(g);
      I.pencil(f, [x0 + g.x + g.width * k + q.dx, y0 + g.y - S * (0.25 + 0.3 * Math.abs(Math.sin(t * 26))) + q.dy], { size: lib.clamp(S * 1.3, f.vmin * 9, f.vmin * 19) });
    }

    // the finishing mark
    const uk = lib.clamp01((t - p.writeDur - 0.05) / 0.45);
    if (p.underline !== 'none' && uk > 0 && L.lines.length) {
      const last = L.lines[L.lines.length - 1];
      const ux = x0 + last.x, uy = y0 + last.y + S * 0.18, uw = last.width;
      const o = { width: Math.max(2, S * 0.06), color: col(p.emColor), boil: b, progress: E.outCubic(uk) };
      if (p.underline === 'line') I.stroke(f, I.spline([[ux - S * 0.1, uy + S * 0.02], [ux + uw * 0.5, uy - S * 0.03], [ux + uw + S * 0.1, uy + S * 0.01]]), { ...o, seed: 3 });
      else if (p.underline === 'double') I.strokes(f, [I.line(ux - S * 0.1, uy, ux + uw + S * 0.05, uy - S * 0.03), I.line(ux, uy + S * 0.13, ux + uw * 0.9, uy + S * 0.11)], { ...o, seed: 4 });
      else if (p.underline === 'scribble') {
        const pts = [];
        for (let i = 0; i <= 14; i++) pts.push([ux + (uw * i) / 14, uy + (i % 2 ? S * 0.1 : 0)]);
        I.stroke(f, I.spline(pts, 4), { ...o, width: o.width * 0.7, seed: 5 });
      } else {
        const cx = x0 + L.lines.reduce((m, l) => m + l.x + l.width / 2, 0) / L.lines.length, cy = y0 + L.height / 2;
        I.stroke(f, I.circle(cx, cy, L.width * 0.62 + S * 0.2, { ry: L.height * 0.62 + S * 0.15, turns: 1.12, start: -2.4, seed: 8 }), { ...o, width: o.width * 0.8, seed: 6 });
      }
    }
    ctx.restore();
  },
});
