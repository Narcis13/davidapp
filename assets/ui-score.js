// A score or counter for interactive compositions (a HUD): a number that ticks up (or down) to each new value of a
// bound variable, pops and flashes as it changes, and floats the difference ("+10") above itself. A pill with an
// icon and a small label, a scoreboard stack (label over a big number), or the bare number. A bump event pops it
// without a change (a combo, a bonus).
//
// Usage. The score of a quiz, top right, bound to the variable the answers add to:
//   vars: { "score": 0 }
//   { "id": "score", "asset": "ui-score", "start": 0, "duration": 60,
//     "params": { "value": { "$var": "score" }, "label": "Score", "icon": "star" },
//     "transform": { "space": "safe", "x": 0.8, "y": 0.07, "width": 0.38, "height": 0.1 } }
//   "wires": [{ "on": "right.select", "do": { "add": { "score": 10 } } }]

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
  title: 'Score',
  description: 'An animated score or counter for interactive compositions and game HUDs: the number ticks to each new value of a bound variable, pops with a spring and flashes (the accent on a gain, red on a loss) and floats the difference ("+10") above itself. Styles: a pill with a kit-icon and a small label, a scoreboard stack (label over a big number) or the bare number; prefix, suffix, decimals and thousands separators. A bump event pops it without a change. Keyframe `value` in a video. Text has a size floor; takes a theme.',
  tags: ['ui', 'interactive', 'score', 'counter', 'hud', 'number', 'game', 'quiz'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    accepts: { bump: 'a pop without a change: a combo, a bonus, look here' },
  },
  params: {
    value: { type: 'number', default: 1250, description: 'The number: bind it to a number variable ({ "$var": "score" })' },
    label: { type: 'string', default: 'Score', description: 'A small label (empty: none)' },
    icon: { type: 'string', default: 'star', description: 'A kit-icon name (pill and plain styles; empty: none)' },
    style: { type: 'enum', options: ['pill', 'stack', 'plain'], default: 'pill', description: 'pill: a HUD chip; stack: a scoreboard (label over a big number); plain: the number' },
    prefix: { type: 'string', default: '' },
    suffix: { type: 'string', default: '', description: 'After the number (pts, %, s…)' },
    decimals: { type: 'integer', default: 0, min: 0, max: 3 },
    grouping: { type: 'boolean', default: true, description: 'Thousands separators (1,250)' },
    delta: { type: 'boolean', default: true, description: 'Float the difference above the number when it changes' },
    tick: { type: 'number', default: 0.6, min: 0, max: 3, step: 0.05, description: 'Seconds the count takes to reach a new value' },
    align: { type: 'enum', options: ['center', 'left', 'right'], default: 'center', description: 'Where it sits across its box' },
    color: { type: 'string', default: '', description: 'Icon and flash colour, a CSS colour (empty: the theme\'s accent)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 6, min: 2.6, max: 30, step: 0.1, description: 'Number size in % of the frame\'s short side' },
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
    const kIn = p.inDur > 0 ? clamp01((f.t - p.delay) / p.inDur) : f.t >= p.delay ? 1 : 0;
    const kOut = p.outDur > 0 ? clamp01((f.duration - f.t) / p.outDur) : 1;
    if (kIn <= 0 || kOut <= 0) return;

    const fmt = (n, sign = false) => {
      const neg = n < 0;
      let s = Math.abs(n).toFixed(p.decimals);
      if (p.grouping) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? `.${b}` : ''); }
      return `${neg ? '−' : sign ? '+' : ''}${s}`;
    };
    // the count: from the old value to the new one, then a spring pop and a flash
    const c = f.ui.changed('value');
    const from = c && typeof c.from === 'number' ? c.from : p.value;
    const ct = c ? c.since : Infinity;
    const shown = p.tick > 0 && ct < p.tick ? from + (p.value - from) * E.outCubic(ct / p.tick) : p.value;
    const popT = Math.min(ct, f.ui.since('bump'));
    const pop = popT < 0.8 ? 0.2 * Math.sin(Math.min(1, popT / 0.09) * (Math.PI / 2)) * Math.exp(-Math.max(0, popT - 0.09) * 6.5) * Math.cos(Math.max(0, popT - 0.09) * 13) : 0;
    const gain = p.value >= from;
    const flashC = gain ? p.color || th.accent : K.bad;
    const flash = ct < 1.2 ? Math.exp(-ct * 3.2) : popT < 1 ? Math.exp(-popT * 4) * 0.6 : 0;

    const head = th.fonts?.headline ?? 'Space Grotesk', display = th.fonts?.display ?? 'Anton', mono = th.fonts?.mono ?? 'JetBrains Mono';
    const numFont = p.style === 'pill' ? { font: head, weight: 700 } : { font: display, weight: 400 };
    const str = (n) => `${p.prefix}${fmt(Math.round(n * 10 ** p.decimals) / 10 ** p.decimals)}${p.suffix}`;
    const N = K.text(str(shown), { ...numFont, size: p.size * u, wrap: 'none', lineHeight: 1.05 });
    const slot = Math.max(N.width, K.text(str(p.value), { ...numFont, size: p.size * u, wrap: 'none', lineHeight: 1.05 }).width, K.text(str(from), { ...numFont, size: p.size * u, wrap: 'none', lineHeight: 1.05 }).width);
    const Lb = p.label ? K.text(p.style === 'stack' ? p.label.toUpperCase() : p.label, { font: p.style === 'stack' ? mono : th.fonts?.body ?? 'Inter', weight: 700, size: Math.max(p.size * u * 0.34, 2.65 * u), letterSpacing: p.style === 'stack' ? 0.14 : 0.02, wrap: 'none' }) : null;
    const pill = p.style === 'pill';
    const iconOn = p.icon && p.style !== 'stack';

    // layout
    const numH = N.height;
    const labH = Lb && p.style !== 'plain' ? Lb.height * 0.92 : 0;
    const padY = pill ? numH * 0.32 : 0, padX = pill ? numH * 0.45 : 0;
    const innerH = labH + numH;
    const iconD = iconOn ? (pill ? innerH * 0.92 : numH * 0.8) : 0;
    const gapI = iconOn ? numH * 0.32 : 0;
    const colW = Math.max(slot, labH ? Lb.width : 0);
    const W = padX * 2 + iconD + gapI + colW, H = padY * 2 + innerH;
    const x = p.align === 'left' ? 0 : p.align === 'right' ? f.width - W : (f.width - W) / 2;
    const y = (f.height - H) / 2;
    const flashFill = C.mix(K.surface, flashC, 0.22 * flash);
    const ink = K.legible(th.ink, pill ? flashFill : th.bg);
    const muted = K.legible(th.muted, pill ? flashFill : th.bg);

    const sc = (0.85 + 0.15 * E.outBack(kIn)) * (1 + pop);
    const ox = x + (p.align === 'right' ? W : p.align === 'left' ? 0 : W / 2), oy = y + H / 2;
    ctx.save();
    ctx.globalAlpha *= E.outCubic(kIn) * kOut;
    ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.translate(-ox, -oy);
    if (pill) {
      const r = H / 2;
      K.shadow(x, y, W, H, r, 0.7, 1);
      K.glow(x, y, W, H, r, flashC, 0.25 + 0.75 * flash);
      ctx.fillStyle = flashFill;
      ctx.beginPath(); ctx.roundRect(x, y, W, H, r); ctx.fill();
      const sheen = ctx.createLinearGradient(0, y, 0, y + H);
      sheen.addColorStop(0, C.alpha(th.ink, K.light ? 0.0 : 0.08)); sheen.addColorStop(0.6, C.alpha(th.ink, 0));
      ctx.fillStyle = sheen; ctx.fill();
      ctx.strokeStyle = C.mix(C.alpha(th.ink, K.light ? 0.2 : 0.14), flashC, flash); ctx.lineWidth = Math.max(1, 0.18 * u);
      ctx.stroke();
    }
    let cx = x + padX;
    if (iconOn) {
      const ic = p.color || th.accent;
      if (pill) {
        const ip = K.pair(ic);
        ctx.fillStyle = ip.fill;
        ctx.beginPath(); ctx.arc(cx + iconD / 2, y + H / 2, iconD / 2, 0, Math.PI * 2); ctx.fill();
        const spin = popT < 0.6 ? E.outCubic(popT / 0.6) * Math.PI * 2 : 0;
        ctx.save();
        ctx.translate(cx + iconD / 2, y + H / 2); ctx.rotate(spin); ctx.translate(-(cx + iconD / 2), -(y + H / 2));
        icon(f, p.icon, ip.ink, p.theme, cx + iconD * 0.22, y + H / 2 - iconD * 0.28, iconD * 0.56, 2.5);
        ctx.restore();
      } else icon(f, p.icon, K.legible(ic, th.bg, 3), p.theme, cx, y + H / 2 - iconD / 2, iconD, 2.25);
      cx += iconD + gapI;
    }
    let ty = y + padY;
    const colX = p.style === 'stack' ? x + (W - colW) / 2 : cx;
    if (labH) {
      lib.text.fill(ctx, Lb, p.style === 'stack' ? x + (W - Lb.width) / 2 : colX, ty - Lb.height * 0.04, { color: muted });
      ty += labH;
    }
    const numColor = C.mix(ink, K.legible(flashC, pill ? flashFill : th.bg), flash);
    const nx = p.style === 'stack' ? x + (W - N.width) / 2 : colX + slot - N.width;
    lib.text.fill(ctx, N, nx, ty, { color: numColor });
    const numRight = p.style === 'stack' ? x + (W + slot) / 2 : colX + slot, numTop = ty;
    ctx.restore();

    // the difference, floating up from the number
    if (p.delta && c && ct < 1.1 && p.value !== from) {
      const k = ct / 1.1;
      // above a pill's right end; beside a bare number's top right; rising and fading
      const Dl = K.text(fmt(p.value - from, true), { font: head, weight: 700, size: Math.max(Math.min(p.size * 0.45, 6) * u, 2.7 * u), wrap: 'none' });
      const rise = E.outCubic(k) * Math.min(H, 9 * u) * 0.55;
      let dx = pill ? x + W - Dl.width * 0.7 : numRight + 0.8 * u;
      const dy = pill ? y - Dl.height * 0.95 - rise : numTop + N.height * 0.05 - rise;
      dx = Math.max(0, Math.min(f.width - Dl.width, dx));
      ctx.save();
      ctx.globalAlpha *= kOut * (k < 0.55 ? clamp01(k / 0.08) : 1 - (k - 0.55) / 0.45);
      lib.text.fill(ctx, Dl, dx, dy, { color: K.legible(gain ? p.color || th.accent : K.bad, th.bg) });
      ctx.restore();
    }
  },
});
