// Progress for interactive compositions: a bar, a row of step dots or a ring, with an optional label and the value
// as a percentage or a count ("3 / 5"). Bind `value` to a variable and the fill glides to each new value (a dot pops
// as it is reached); a shimmer runs along a bar's fill on the session clock while the scene waits; a pulse event makes
// it glow. It fills in from zero when it appears.
//
// Usage. "Question 2 of 5" at the top of a quiz, bound to the question counter:
//   vars: { "q": 1 }
//   { "id": "prog", "asset": "ui-progress", "start": 0, "duration": 60,
//     "params": { "value": { "$var": "q" }, "max": 5, "style": "dots", "label": "Question", "showValue": "count" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.08, "width": 0.9, "height": 0.08 } }
//   "wires": [{ "on": "next.press", "do": [{ "add": { "q": 1 }, "max": 5 }, { "send": "prog", "event": "pulse" }] }]

const FLOOR = 2.6;

// ── ui toolkit: the same block opens every ui-* asset (sizes in % of the frame's short side, contrast, soft shadows, rings) ──
function toolkit(f, th) {
  const { ctx, lib } = f;
  const C = lib.color;
  const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
  const u = short / 100;
  const m = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  const lum = (c) => C.luminance(c);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const light = lum(th.bg) > 0.4;
  /** c nudged toward black or white until it reads on bg at min:1 (4.8 by default: a margin over 4.5 for what is behind). */
  const legible = (c, bg, min = 4.8) => {
    if (ratio(c, bg) >= min) return c;
    const to = lum(bg) > 0.18 ? '#000000' : '#ffffff';
    for (let k = 0.1; k < 1; k += 0.1) { const x = C.mix(c, to, k); if (ratio(x, bg) >= min) return x; }
    return to;
  };
  /** The theme ink that reads best on a fill; when none reaches 4.8:1, the lighter ink on the fill darkened until it does. */
  const pair = (fill) => {
    const a = ratio(th.ink, fill), b = ratio(th.bg, fill);
    if (Math.max(a, b) >= 4.8) return { fill, ink: a >= b ? th.ink : th.bg };
    const ink = lum(th.ink) > lum(th.bg) ? th.ink : th.bg;
    for (let k = 0.06; k < 1; k += 0.06) { const x = C.mix(fill, '#000000', k); if (ratio(ink, x) >= 4.8) return { fill: x, ink }; }
    return { fill: '#000000', ink };
  };
  /** The top and bottom of a filled control's gradient: lit from above, but never paler behind a light label. */
  const face = (fill, ink) => (lum(ink) > lum(fill) ? [fill, C.mix(fill, '#000000', 0.12)] : [C.mix(fill, '#ffffff', 0.12), fill]);
  const surface = th.surface ?? C.mix(th.bg, '#ffffff', light ? 0.6 : 0.07);
  const good = th.success ?? (light ? '#1e7f55' : '#43d692');
  const bad = th.danger ?? (light ? '#c2413b' : '#ff6b6b');
  const S = C.parse(light ? th.ink : '#000000');
  const shade = (a) => `rgba(${Math.round(S[0])},${Math.round(S[1])},${Math.round(S[2])},${Math.max(0, a).toFixed(4)})`;
  /** A soft drop shadow under a rounded rect: stacked translucent shapes (no blur, no filter). lift 0..2. */
  const shadow = (x, y, w, h, r, lift = 1, k = 1) => {
    const n = 6, reach = (0.4 + 1.2 * lift) * u, drop = (0.2 + 0.6 * lift) * u, base = (light ? 0.05 : 0.1) * k;
    for (let i = n; i >= 1; i--) {
      const g = (reach * i) / n;
      ctx.fillStyle = shade(base * (1.15 - i / n));
      ctx.beginPath(); ctx.roundRect(x - g, y - g + drop, w + 2 * g, h + 2 * g, Math.max(0, r + g)); ctx.fill();
    }
  };
  /** A coloured glow around a rounded rect (stacked translucent shapes): the neon edge of a lit control on a dark theme. */
  const glow = (x, y, w, h, r, color, k = 1) => {
    if (k <= 0 || light) return;
    const c = C.parse(color), n = 5, reach = 1.7 * u;
    for (let i = n; i >= 1; i--) {
      const g = (reach * i) / n;
      ctx.fillStyle = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${(0.075 * k * (1.12 - i / n)).toFixed(4)})`;
      ctx.beginPath(); ctx.roundRect(x - g, y - g, w + 2 * g, h + 2 * g, Math.max(0, r + g)); ctx.fill();
    }
  };
  /** The ripple of a press: a soft-edged disc growing from (x, y) to radius r over `dur` seconds since the press. */
  const ripple = (x, y, r, color, since, dur = 0.6, strength = 0.3) => {
    if (!(since < dur)) return;
    const k = since / dur, e = 1 - (1 - k) ** 3, rr = Math.max(1, r * (0.12 + 0.88 * e)), a = strength * (1 - k);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, C.alpha(color, a * 0.8)); g.addColorStop(0.9, C.alpha(color, a)); g.addColorStop(1, C.alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  };
  const focusColor = legible(th.accent, th.bg, 3);
  /** The keyboard focus ring around a rounded rect, breathing a little. */
  const ring = (x, y, w, h, r, k = 1) => {
    if (k <= 0) return;
    const off = (0.75 + 0.12 * Math.sin(f.ui.now * 5)) * u;
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.strokeStyle = focusColor; ctx.lineWidth = Math.max(2, 0.45 * u);
    ctx.beginPath(); ctx.roundRect(x - off, y - off, w + 2 * off, h + 2 * off, Math.max(0, r + off)); ctx.stroke();
    ctx.restore();
  };
  /** Text through f.lib.text (measured, in the layout report), never under the floor on screen. */
  const text = (str, o) => lib.text.layout(ctx, str, { ...o, size: Math.max(o.size, ((FLOOR / 100) * short / scale) * 1.005) });
  /** A tick, a cross, an "i" or a "!" stroked in a box of side s around (cx, cy), drawn on with k. */
  const mark = (kind, cx, cy, s, color, k = 1) => {
    if (k <= 0) return;
    const lines = { check: [[[-0.34, 0.02], [-0.1, 0.26], [0.36, -0.24]]], x: [[[-0.25, -0.25], [0.25, 0.25]], [[0.25, -0.25], [-0.25, 0.25]]], info: [[[0, -0.04], [0, 0.3]]], alert: [[[0, -0.3], [0, 0.07]]] }[kind];
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.5, s * 0.15); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pts of lines) {
      let left = k * pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
      ctx.beginPath(); ctx.moveTo(cx + pts[0][0] * s, cy + pts[0][1] * s);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay), q = Math.min(1, left / d);
        ctx.lineTo(cx + (ax + (bx - ax) * q) * s, cy + (ay + (by - ay) * q) * s);
        left -= d;
      }
      ctx.stroke();
    }
    if (kind === 'info' || kind === 'alert') { ctx.beginPath(); ctx.arc(cx, cy + (kind === 'info' ? -0.27 : 0.29) * s, s * 0.09 * Math.min(1, k * 2), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  };
  return { ctx, lib, C, u, short, scale, light, ratio, legible, pair, face, surface, good, bad, shade, shadow, glow, ripple, ring, text, mark };
}

/** A kit-icon drawn at the context's current opacity (kit-icon sets its own: it is given that opacity as its fade-out). */
function icon(f, name, color, theme, x, y, s, weight = 2.25) {
  const a = f.ctx.globalAlpha;
  if (!name || a <= 0.004 || s <= 0) return;
  f.use('kit-icon', { name, color, theme, weight, draw: 0, pop: 0, outDur: 1 }, { x, y, width: s, height: s, t: Math.min(0.999, 1 - a), duration: 1 });
}
// ── end of the ui toolkit ──

asset({
  title: 'Progress',
  description: 'Progress for interactive compositions and explainers: a bar, a row of step dots (done ones ticked, the current one breathing) or a ring, with an optional label and the value as a percentage or a count. Bind `value` (and `max`) to variables: the fill glides to each new value and a reached dot pops; a shimmer runs along a bar on the session clock while a scene waits; a pulse event makes it glow. Fills in from zero when it appears; keyframe `value` in a video. Text has a size floor; takes a theme.',
  tags: ['ui', 'interactive', 'progress', 'bar', 'steps', 'ring', 'hud', 'quiz', 'game'],
  floor: FLOOR,
  uses: ['easing'],
  events: {
    accepts: { pulse: 'a glow over the filled part: progress was made' },
  },
  params: {
    value: { type: 'number', default: 2, description: 'How far along, from 0 to max: bind it to a number variable' },
    max: { type: 'number', default: 5, min: 0.0001, description: 'The value when complete (dots: the number of steps, 2 to 12)' },
    style: { type: 'enum', options: ['bar', 'dots', 'ring'], default: 'bar' },
    label: { type: 'string', default: 'Progress', description: 'A label (bar and dots: at the left above; ring: under the number); empty: none' },
    showValue: { type: 'enum', options: ['percent', 'count', 'none'], default: 'count', description: 'percent: 40%; count: 2 / 5' },
    color: { type: 'string', default: '', description: 'Fill colour, a CSS colour (empty: the theme\'s accent)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 2.2, min: 0.6, max: 10, step: 0.1, description: 'Bar thickness (dots: their size; ring: its stroke) in % of the frame\'s short side' },
    textSize: { type: 'number', default: 3.2, min: 2.6, max: 9, step: 0.1, description: 'Label size in % of the frame\'s short side' },
    tick: { type: 'number', default: 0.7, min: 0, max: 3, step: 0.05, description: 'Seconds the fill takes to reach a new value' },
    fillIn: { type: 'boolean', default: true, description: 'Fill from zero when it appears' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05 },
    inDur: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const K = toolkit(f, th);
    const { u, C } = K;
    const clamp01 = lib.clamp01;
    if (p.color) { try { C.parse(p.color); } catch { throw new Error(`color "${p.color}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme's accent`); } }
    const t = f.t - p.delay;
    const kIn = p.inDur > 0 ? clamp01(t / p.inDur) : t >= 0 ? 1 : 0;
    const kOut = p.outDur > 0 ? clamp01((f.duration - f.t) / p.outDur) : 1;
    if (kIn <= 0 || kOut <= 0) return;

    // the shown value: glides from the old one when the bound value changes, fills in from 0 on entry
    const c = f.ui.changed('value');
    let v = p.value;
    if (c && typeof c.from === 'number' && p.tick > 0 && c.since < p.tick) v = c.from + (p.value - c.from) * E.outCubic(c.since / p.tick);
    if (p.fillIn) v *= E.inOutCubic(clamp01((t - 0.1) / 0.9));
    const frac = clamp01(v / p.max);
    const pu = f.ui.since('pulse');
    const glowK = (pu < 1 ? (1 - pu) * 0.9 : 0) + 0.35;
    const pairF = K.pair(p.color || th.accent);
    const fillC = pairF.fill;
    const now = f.ui.now;
    const head = th.fonts?.headline ?? 'Space Grotesk', mono = th.fonts?.mono ?? 'JetBrains Mono', body = th.fonts?.body ?? 'Inter';
    const label = (s) => (p.showValue === 'percent' ? `${Math.round(clamp01(s / p.max) * 100)}%` : p.showValue === 'count' ? `${Math.round(s * 100) / 100} / ${Math.round(p.max * 100) / 100}` : '');
    const valueText = label(p.value);

    ctx.save();
    ctx.globalAlpha *= E.outCubic(kIn) * kOut;
    ctx.translate(0, (1 - E.outCubic(kIn)) * 2 * u);
    const ink = K.legible(th.ink, th.bg), muted = K.legible(th.muted, th.bg);

    if (p.style === 'ring') {
      const L = p.label ? K.text(p.label, { font: body, weight: 600, size: p.textSize * u, maxWidth: Math.max(1, f.width), wrap: 'none', fit: true }) : null;
      const sw = Math.max(2, p.size * u * 1.5);
      const R = Math.max(sw, Math.min(f.width, f.height) / 2 - sw / 2 - 1.5 * u);
      const cx = f.width / 2, cy = f.height / 2;
      const V = valueText ? K.text(valueText, { font: head, weight: 700, size: R * (p.showValue === 'count' ? 0.42 : 0.5), maxWidth: R * 1.5, wrap: 'none', fit: true }) : null;
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.mix(th.bg, th.ink, K.light ? 0.14 : 0.16); ctx.lineWidth = sw;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      if (frac > 0.001) {
        const a0 = -Math.PI / 2, a1 = a0 + Math.min(frac, 0.9999) * Math.PI * 2;   // a sweep of exactly 2π draws nothing in Skia
        if (!K.light) for (let i = 4; i >= 1; i--) {
          ctx.strokeStyle = C.alpha(fillC, 0.06 * glowK * (1.1 - i / 4)); ctx.lineWidth = sw + i * 0.9 * u;
          ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
        }
        ctx.strokeStyle = fillC; ctx.lineWidth = sw;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
        ctx.fillStyle = C.mix(fillC, '#ffffff', 0.5);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, sw * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      const gap = L && V ? R * 0.06 : 0;
      const bh = (V ? V.height : 0) + gap + (L ? L.height : 0);
      let y = cy - bh / 2;
      if (V) { lib.text.fill(ctx, V, cx - V.width / 2, y, { color: ink }); y += V.height + gap; }
      if (L) lib.text.fill(ctx, L, cx - L.width / 2, y, { color: muted });
      ctx.restore();
      return;
    }

    // bar and dots: the label and the value on a line above
    const L = p.label ? K.text(p.label, { font: body, weight: 600, size: p.textSize * u, maxWidth: Math.max(1, f.width * 0.65), wrap: 'none', fit: true }) : null;
    const V = valueText ? K.text(valueText, { font: mono, weight: 700, size: p.textSize * u * 0.95, wrap: 'none' }) : null;
    const headH = L || V ? Math.max(L ? L.height : 0, V ? V.height : 0) : 0;
    const bodyH = p.style === 'dots' ? Math.max(p.size * u * 2, 3.4 * u) : Math.max(2, p.size * u);
    const gapH = headH ? 1.1 * u : 0;
    const top = (f.height - headH - gapH - bodyH) / 2;
    if (L) lib.text.fill(ctx, L, 0, top, { color: muted });
    if (V) lib.text.fill(ctx, V, f.width - V.width, top + (headH - V.height) / 2, { color: ink });
    const by = top + headH + gapH;

    if (p.style === 'bar') {
      const W = f.width, h = bodyH, r = h / 2;
      ctx.fillStyle = C.mix(th.bg, th.ink, K.light ? 0.14 : 0.15);
      ctx.beginPath(); ctx.roundRect(0, by, W, h, r); ctx.fill();
      const fw = Math.max(frac > 0 ? h : 0, W * frac);
      if (fw > 0) {
        K.glow(0, by, fw, h, r, fillC, glowK);
        const g = ctx.createLinearGradient(0, 0, fw, 0);
        g.addColorStop(0, C.mix(fillC, th.bg, 0.3)); g.addColorStop(1, fillC);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.roundRect(0, by, fw, h, r); ctx.fill();
        // the shimmer along the fill, on the session clock
        ctx.save();
        ctx.beginPath(); ctx.roundRect(0, by, fw, h, r); ctx.clip();
        const ph = (now % 2.4) / 2.4, sx = -W * 0.3 + ph * (fw + W * 0.6), sw = Math.max(h * 4, W * 0.18);
        const sg = ctx.createLinearGradient(sx - sw / 2, 0, sx + sw / 2, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.3)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(0, by, fw, h);
        const hg = ctx.createLinearGradient(0, by, 0, by + h);
        hg.addColorStop(0, 'rgba(255,255,255,0.28)'); hg.addColorStop(0.5, 'rgba(255,255,255,0)');
        ctx.fillStyle = hg; ctx.fillRect(0, by, fw, h);
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    // dots: done (ticked), current (a ring breathing), to come (hollow); the line between them fills
    const n = Math.max(2, Math.min(12, Math.round(p.max)));
    const d = bodyH, rD = d / 2;
    const step = (f.width - d) / (n - 1);
    const cy = by + rD;
    const lw = Math.max(2, d * 0.14);
    const dv = clamp01(v / p.max) * n;   // the shown value in dots
    ctx.lineCap = 'round';
    for (let i = 0; i < n - 1; i++) {
      const xa = rD + i * step + rD * 1.35, xb = rD + (i + 1) * step - rD * 1.35;
      if (xb <= xa) continue;
      ctx.strokeStyle = C.mix(th.bg, th.ink, K.light ? 0.18 : 0.2); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(xa, cy); ctx.lineTo(xb, cy); ctx.stroke();
      const k = clamp01(dv - i);   // the line into the current step is already filled
      if (k > 0) { ctx.strokeStyle = fillC; ctx.beginPath(); ctx.moveTo(xa, cy); ctx.lineTo(xa + (xb - xa) * k, cy); ctx.stroke(); }
    }
    for (let i = 0; i < n; i++) {
      const x = rD + i * step;
      const e = p.inDur > 0 ? E.outBack(clamp01((t - i * 0.05) / Math.max(0.05, p.inDur))) : 1;
      if (e <= 0) continue;
      const done = clamp01((dv - i) / 0.35);
      const current = dv >= i - 0.001 && dv < i + 1 && p.value < p.max ? 1 : 0;
      ctx.save();
      ctx.translate(x, cy);
      const popK = done > 0 && done < 1 ? 1 + 0.25 * Math.sin(Math.PI * done) : 1;
      ctx.scale(e * popK, e * popK);
      if (done > 0) {
        if (!K.light) { ctx.fillStyle = C.alpha(fillC, 0.18 * glowK); ctx.beginPath(); ctx.arc(0, 0, rD * 1.45, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = C.mix(C.mix(th.bg, th.ink, 0.18), fillC, done);
        ctx.beginPath(); ctx.arc(0, 0, rD, 0, Math.PI * 2); ctx.fill();
        K.mark('check', 0, 0, d * 0.7, pairF.ink, done);
      } else if (current) {
        const br = 0.5 + 0.5 * Math.sin(now * 4);
        ctx.fillStyle = C.alpha(fillC, 0.16 + 0.1 * br);
        ctx.beginPath(); ctx.arc(0, 0, rD * (1.15 + 0.15 * br), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = fillC; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(0, 0, rD - lw / 2, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = fillC;
        ctx.beginPath(); ctx.arc(0, 0, rD * 0.32, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = C.mix(th.bg, th.ink, K.light ? 0.3 : 0.32); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.arc(0, 0, rD - lw / 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  },
});
