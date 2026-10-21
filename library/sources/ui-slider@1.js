// A slider for interactive compositions: a label and its value over a track with a thumb. The track is a range hit
// region: the runtime computes the value under the finger while it drags (snapped to `step`) and from the arrow keys
// once the slider has focus, and emits change with it. Bind `value` to a variable and the thumb follows (gliding when
// the value jumps), a bubble with the value floats over the thumb while it is dragged, ticks mark the steps.
//
// Usage. A speed slider from 0.5× to 2× in steps of 0.1:
//   vars: { "speed": 1 }
//   { "id": "speed", "asset": "ui-slider", "start": 0, "duration": 10,
//     "params": { "label": "Speed", "value": { "$var": "speed" }, "min": 0.5, "max": 2, "step": 0.1, "decimals": 1, "suffix": "×" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.5, "width": 0.9, "height": 0.16 } }
//   "wires": [{ "on": "speed.change", "do": { "set": { "speed": "$value" } } }]
// Without a bound value the thumb stays where it is: always bind it.

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
  title: 'Slider',
  description: 'A slider for interactive compositions (volume, speed, difficulty, a guess on a scale): a label and its formatted value over a track and a thumb. The track is a range region: the runtime turns a drag (snapped to `step`) or the arrow keys (once focused) into a value and emits change with it. Bind `value` to a variable: the filled track and the thumb follow, glide when the value jumps, a bubble shows the value while dragging, ticks mark the steps. Hover halo, focus ring; a thumb-sized target on a phone. Takes a theme.',
  tags: ['ui', 'interactive', 'slider', 'range', 'settings', 'volume', 'control'],
  floor: FLOOR,
  uses: ['easing'],
  events: {
    emits: { change: 'while it is dragged, or moved with the arrow keys once focused; the value is the new number, snapped to step' },
    accepts: { pulse: 'a halo around the thumb: look here' },
  },
  params: {
    label: { type: 'string', default: 'Volume', description: 'Its name, above the track at the left (empty: none)' },
    value: { type: 'number', default: 0.6, description: 'The value: bind it to a number variable ({ "$var": "volume" })' },
    min: { type: 'number', default: 0 },
    max: { type: 'number', default: 1 },
    step: { type: 'number', default: 0.05, min: 0, description: 'The value snaps to multiples of it from min (0: continuous); also the arrow key step' },
    display: { type: 'enum', options: ['auto', 'value', 'percent', 'none'], default: 'auto', description: 'value: the number with prefix, suffix and decimals; percent: where it is between min and max; auto: the value when a prefix, suffix or decimals are set or the range is not 0 to 1, else the percentage' },
    decimals: { type: 'integer', default: 0, min: 0, max: 4 },
    prefix: { type: 'string', default: '' },
    suffix: { type: 'string', default: '', description: 'After the number (%, ×, s, km…)' },
    ticks: { type: 'enum', options: ['auto', 'on', 'off'], default: 'auto', description: 'Marks at the steps (auto: when there are 2 to 12)' },
    disabled: { type: 'boolean', default: false, description: 'Dimmed and not draggable' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 6, min: 3, max: 14, step: 0.1, description: 'Thumb diameter in % of the frame\'s short side (the hit region is at least 11)' },
    textSize: { type: 'number', default: 3.6, min: 2.6, max: 9, step: 0.1, description: 'Label size in % of the frame\'s short side' },
    color: { type: 'string', default: '', description: 'Fill colour, a CSS colour (empty: the theme\'s accent)' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05 },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0, min: 0, max: 3, step: 0.01, description: 'Seconds of the exit at the item\'s end (0 while a scene holds for input)' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const K = toolkit(f, th);
    const { u, C } = K;
    const clamp01 = lib.clamp01;
    if (!(p.max > p.min)) throw new Error(`max (${p.max}) must be greater than min (${p.min})`);
    if (p.color) { try { C.parse(p.color); } catch { throw new Error(`color "${p.color}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme's accent`); } }
    const kIn = p.inDur > 0 ? clamp01((f.t - p.delay) / p.inDur) : f.t >= p.delay ? 1 : 0;
    const kOut = p.outDur > 0 ? clamp01((f.duration - f.t) / p.outDur) : 1;
    if (kIn <= 0 || kOut <= 0) return;

    const display = p.display !== 'auto' ? p.display : p.prefix || p.suffix || p.decimals > 0 || p.min !== 0 || p.max !== 1 ? 'value' : 'percent';
    const fmt = (v) => {
      if (display === 'percent') return `${Math.round(((v - p.min) / (p.max - p.min)) * 100)}%`;
      const n = Math.abs(v) < 1e-9 ? 0 : v;
      return `${p.prefix}${n.toFixed(p.decimals)}${p.suffix}`;
    };
    const head = th.fonts?.headline ?? 'Space Grotesk', mono = th.fonts?.mono ?? 'JetBrains Mono';
    const D = p.size * u, hitH = Math.max(11 * u, D * 1.8);
    const L = p.label ? K.text(p.label, { font: head, weight: 600, size: p.textSize * u, maxWidth: Math.max(1, f.width * 0.62), wrap: 'none', fit: true }) : null;
    const V = display !== 'none' ? K.text(fmt(p.value), { font: mono, weight: 700, size: p.textSize * u * 0.95, wrap: 'none' }) : null;
    const headH = L || V ? Math.max(L ? L.height : 0, V ? V.height : 0) : 0;
    const total = headH + hitH * 0.85;
    const top = (f.height - total) / 2;
    const cy = top + headH + hitH * 0.42;
    const x0 = D / 2, x1 = f.width - D / 2, span = Math.max(1, x1 - x0);

    const s = f.ui.hit('change', x0, cy - hitH / 2, span, hitH, { range: { min: p.min, max: p.max, step: p.step, value: p.value }, label: p.label || 'slider', disabled: p.disabled });
    const live = !p.disabled;
    const hov = live && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.16)) : 0;
    const held = live && s.down;
    // the shown value glides to a value that jumped (a key, a wire); while dragging it is exact
    const c = f.ui.changed('value');
    let shown = p.value;
    if (c && !held && c.since < 0.24 && typeof c.from === 'number') shown = c.from + (p.value - c.from) * E.outCubic(c.since / 0.24);
    const frac = clamp01((shown - p.min) / (p.max - p.min));
    const grow = clamp01(0.25 * hov + (held ? 1 : 0) + (s.focus ? 0.25 : 0));
    const pu = f.ui.since('pulse');

    const pairF = K.pair(p.color || th.accent);
    const fillC = pairF.fill;
    const trackH = Math.max(3, D * 0.3);
    const kx = x0 + span * frac * E.outCubic(kIn);

    ctx.save();
    ctx.globalAlpha *= E.outCubic(kIn) * kOut * (p.disabled ? 0.5 : 1);
    if (L) lib.text.fill(ctx, L, 0, top + (headH - L.height) / 2, { color: K.legible(th.ink, th.bg) });
    if (V) {
      const vColor = K.legible(held || c?.since < 0.3 ? fillC : th.ink, th.bg);
      lib.text.fill(ctx, V, f.width - V.width, top + (headH - V.height) / 2, { color: vColor });
    }

    // the track: the rest, then the filled part with a glow on a dark theme
    ctx.fillStyle = C.mix(th.bg, th.ink, K.light ? 0.16 : 0.18);
    ctx.beginPath(); ctx.roundRect(x0 - trackH / 2, cy - trackH / 2, span + trackH, trackH, trackH / 2); ctx.fill();
    const steps = p.step > 0 ? Math.round((p.max - p.min) / p.step) : 0;
    if (p.ticks === 'on' || (p.ticks === 'auto' && steps >= 2 && steps <= 12)) {
      for (let i = 0; i <= steps; i++) {
        const tx = x0 + (span * i) / Math.max(1, steps);
        ctx.fillStyle = tx <= kx ? C.alpha(pairF.ink, 0.5) : C.alpha(th.ink, 0.35);
        ctx.beginPath(); ctx.arc(tx, cy, trackH * 0.18, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (kx > x0 - trackH / 2) {
      K.glow(x0 - trackH / 2, cy - trackH / 2, kx - x0 + trackH, trackH, trackH / 2, fillC, 0.6);
      const g = ctx.createLinearGradient(x0, 0, kx, 0);
      g.addColorStop(0, C.mix(fillC, th.bg, 0.25)); g.addColorStop(1, fillC);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x0 - trackH / 2, cy - trackH / 2, kx - x0 + trackH, trackH, trackH / 2); ctx.fill();
    }

    // the halo (hover, focus, drag, pulse), the thumb's shadow, the thumb
    const halo = D * (0.5 + 0.42 * grow);
    if (grow > 0) { ctx.fillStyle = C.alpha(fillC, 0.12 + 0.1 * grow); ctx.beginPath(); ctx.arc(kx, cy, halo, 0, Math.PI * 2); ctx.fill(); }
    if (pu < 0.8) {
      const k = pu / 0.8;
      ctx.strokeStyle = C.alpha(fillC, 0.7 * (1 - k)); ctx.lineWidth = Math.max(2, 0.4 * u);
      ctx.beginPath(); ctx.arc(kx, cy, D * (0.55 + 0.9 * E.outCubic(k)), 0, Math.PI * 2); ctx.stroke();
    }
    const rT = (D / 2) * (1 + 0.08 * grow);
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = K.shade((K.light ? 0.06 : 0.14) * (1.1 - i / 4));
      ctx.beginPath(); ctx.arc(kx, cy + 0.35 * u, rT + i * 0.22 * u, 0, Math.PI * 2); ctx.fill();
    }
    const thumb = K.light ? '#ffffff' : C.mix(th.ink, '#ffffff', 0.5);
    const tg = ctx.createLinearGradient(0, cy - rT, 0, cy + rT);
    tg.addColorStop(0, thumb); tg.addColorStop(1, C.mix(thumb, th.bg, 0.12));
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.arc(kx, cy, rT, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = fillC; ctx.lineWidth = Math.max(2, rT * 0.16);
    ctx.beginPath(); ctx.arc(kx, cy, rT - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = fillC;
    ctx.beginPath(); ctx.arc(kx, cy, rT * 0.24 * (1 + grow * 0.4), 0, Math.PI * 2); ctx.fill();
    K.ring(kx - rT, cy - rT, 2 * rT, 2 * rT, rT, s.focus ? 1 : 0);

    // the bubble with the value while it is dragged (and a moment after)
    const bubK = held ? 1 : live && s.pressed < 0.5 ? 1 - E.inCubic(s.pressed / 0.5) : 0;
    if (bubK > 0 && display !== 'none') {
      const B = K.text(fmt(p.value), { font: mono, weight: 700, size: Math.max(D * 0.5, 2.8 * u), wrap: 'none' });
      const bw = B.width + D * 0.7, bh = B.height + D * 0.3, by = cy - rT - bh - D * 0.42;
      const bx = Math.max(0, Math.min(f.width - bw, kx - bw / 2));
      ctx.save();
      ctx.globalAlpha *= bubK;
      ctx.translate(kx, cy - rT); ctx.scale(0.7 + 0.3 * bubK, 0.7 + 0.3 * bubK); ctx.translate(-kx, -(cy - rT));
      ctx.fillStyle = pairF.fill;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh * 0.38); ctx.fill();
      ctx.beginPath(); ctx.moveTo(kx - D * 0.2, by + bh - 1); ctx.lineTo(kx, by + bh + D * 0.22); ctx.lineTo(kx + D * 0.2, by + bh - 1); ctx.fill();
      lib.text.fill(ctx, B, bx + (bw - B.width) / 2, by + (bh - B.height) / 2, { color: pairF.ink });
      ctx.restore();
    }
    ctx.restore();
  },
});
