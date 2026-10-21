// A switch with a label for interactive compositions: a settings row (label, optional detail) with an iOS-like
// switch at its end. The whole row is the hit region, so a tap anywhere on it, its hotkey or Tab + Enter emits change
// with the new boolean. Bind `on` to a variable: the thumb then slides over with a little overshoot, stretches while
// held, and the track fills with the accent (a tick and a cross ride in the thumb).
//
// Usage. A sound switch bound to a boolean variable:
//   vars: { "sound": true }
//   { "id": "snd", "asset": "ui-toggle", "start": 0, "duration": 10,
//     "params": { "label": "Sound", "detail": "Music and effects", "on": { "$var": "sound" }, "hotkey": "m" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.4, "width": 0.92, "height": 0.12 } }
//   "wires": [{ "on": "snd.change", "do": { "set": { "sound": "$value" } } }]
// ({ "toggle": "sound" } works as well.) Without a bound `on` the switch emits but never moves.

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
  title: 'Toggle',
  description: 'A labelled switch for interactive compositions (settings, options, sound on/off): a row with a label, an optional muted detail and an iOS-like switch. The whole row is the hit region; a tap, its hotkey or Tab + Enter emits change with the new boolean. Bind `on` to a variable and the thumb slides with a slight overshoot, stretches while held, the track fills with the accent and a tick or cross rides in the thumb. Focus ring, hover and press feedback; the row is at least a thumb tall on a phone. Takes a theme.',
  tags: ['ui', 'interactive', 'toggle', 'switch', 'checkbox', 'settings', 'control'],
  floor: FLOOR,
  uses: ['easing'],
  events: {
    emits: { change: 'when it is tapped, or toggled with its hotkey or Tab + Enter; the value is the new state (true or false)' },
    accepts: { shake: 'a sideways shake of the switch: a setting that cannot change now' },
  },
  params: {
    label: { type: 'string', default: 'Sound', description: 'The setting\'s name' },
    detail: { type: 'string', default: '', description: 'A muted second line (empty: none)' },
    on: { type: 'boolean', default: true, description: 'Its state: bind it to a boolean variable ({ "$var": "sound" })' },
    hotkey: { type: 'string', default: '', description: 'A key that toggles it (m, s…; empty: none)' },
    disabled: { type: 'boolean', default: false, description: 'Dimmed and not switchable' },
    plate: { type: 'boolean', default: true, description: 'Sit on a surface row (off: bare, over the background)' },
    side: { type: 'enum', options: ['right', 'left'], default: 'right', description: 'Which end of the row the switch sits at' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 6.2, min: 3, max: 14, step: 0.1, description: 'Switch height in % of the frame\'s short side (the row is at least 11)' },
    textSize: { type: 'number', default: 3.8, min: 2.6, max: 9, step: 0.1, description: 'Label size in % of the frame\'s short side' },
    color: { type: 'string', default: '', description: 'Track colour when on, a CSS colour (empty: the theme\'s accent)' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05 },
    inDur: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0, min: 0, max: 3, step: 0.01, description: 'Seconds of the exit at the item\'s end (0 while a scene holds for input)' },
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

    // geometry: a row across the box, the switch at one end
    const th0 = p.size * u;
    const rowH = Math.min(f.height, Math.max(11 * u, th0 * 2.05, (p.detail ? 2.5 : 1.6) * p.textSize * u * 1.2));
    const W = f.width, x = 0, y = (f.height - rowH) / 2;
    const padX = p.plate ? Math.min(3 * u, rowH * 0.3) : 0;
    const tw = th0 * 1.72, tx = p.side === 'right' ? x + W - padX - tw : x + padX, ty = y + (rowH - th0) / 2;
    const rr = Math.min(rowH * 0.32, 3 * u);
    const head = th.fonts?.headline ?? 'Space Grotesk', body = th.fonts?.body ?? 'Inter';
    const plateFill = K.surface;
    const under = p.plate ? plateFill : th.bg;
    const textX = p.side === 'right' ? x + padX : tx + tw + Math.max(2.4 * u, padX);
    const textW = Math.max(1, W - padX * 2 - tw - Math.max(2.4 * u, padX));
    const L = K.text(p.label, { font: head, weight: 600, size: p.textSize * u, maxWidth: textW, wrap: 'none', fit: true });
    const D = p.detail ? K.text(p.detail, { font: body, weight: 500, size: Math.max(p.textSize * u * 0.78, 2.65 * u), maxWidth: textW, wrap: 'none', fit: true }) : null;

    const s = f.ui.hit('change', x, y, W, rowH, { value: !p.on, keys: p.hotkey ? [p.hotkey] : undefined, label: p.label, disabled: p.disabled });
    const live = !p.disabled;
    const hov = live && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.16)) : 0;
    const held = live && s.down ? 1 : 0;
    const press = !live ? 0 : held ? 1 : s.pressed < 0.3 ? 1 - E.outCubic(s.pressed / 0.3) : 0;

    // the thumb slides from the old state when the bound value changes (a little past, then back)
    const c = f.ui.changed('on');
    const to = p.on ? 1 : 0;
    const from = c ? (c.from ? 1 : 0) : to;
    const k = c ? clamp01(c.since / 0.36) : 1;
    const pos = from + (to - from) * E.outBack(k);
    const col = from + (to - from) * E.outCubic(clamp01(k * 1.5));
    const sh = f.ui.since('shake');
    const shakeX = sh < 0.6 ? Math.sin(sh * 46) * Math.exp(-sh * 7) * th0 * 0.25 : 0;

    const onPair = K.pair(p.color || th.accent);
    const offFill = C.mix(under, th.ink, K.light ? 0.2 : 0.22);
    const track = C.mix(offFill, onPair.fill, col);

    ctx.save();
    ctx.globalAlpha *= E.outCubic(kIn) * kOut * (p.disabled ? 0.5 : 1);
    ctx.translate((1 - E.outCubic(kIn)) * 3 * u, 0);
    if (p.plate) {
      K.shadow(x, y, W, rowH, rr, 0.5 + 0.6 * hov, 0.9);
      ctx.fillStyle = C.mix(plateFill, th.ink, 0.04 * hov + 0.04 * press);
      ctx.beginPath(); ctx.roundRect(x, y, W, rowH, rr); ctx.fill();
      ctx.strokeStyle = C.alpha(th.ink, K.light ? 0.18 : 0.12); ctx.lineWidth = Math.max(1, 0.15 * u); ctx.stroke();
    }
    const tH = (L ? L.height : 0) + (D ? D.height * 0.95 : 0);
    let ly = y + (rowH - tH) / 2;
    lib.text.fill(ctx, L, textX, ly + L.size * 0.02, { color: K.legible(th.ink, under) });
    ly += L.height * 0.95;
    if (D) lib.text.fill(ctx, D, textX, ly, { color: K.legible(th.muted, under) });

    // the switch
    ctx.save();
    ctx.translate(shakeX, 0);
    const r = th0 / 2;
    if (col > 0.02) K.glow(tx, ty, tw, th0, r, onPair.fill, 0.7 * col);
    ctx.fillStyle = track;
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, th0, r); ctx.fill();
    // inner shade at the top of the track (it reads as a groove), and its edge when off
    const gg = ctx.createLinearGradient(0, ty, 0, ty + th0);
    gg.addColorStop(0, 'rgba(0,0,0,0.18)'); gg.addColorStop(0.5, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fill();
    ctx.strokeStyle = C.alpha(th.ink, 0.22 * (1 - col)); ctx.lineWidth = Math.max(1, 0.15 * u);
    ctx.beginPath(); ctx.roundRect(tx + 0.5, ty + 0.5, tw - 1, th0 - 1, r - 0.5); ctx.stroke();

    const inset = th0 * 0.1, d = th0 - inset * 2;
    const stretch = d * 0.26 * press;
    const x0 = tx + inset, x1 = tx + tw - inset - d;
    const kx = x0 + (x1 - x0) * pos - (pos > 0.5 ? stretch : 0);
    const thumbW = d + stretch;
    // the thumb's shadow, then the thumb
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = K.shade((K.light ? 0.07 : 0.16) * (1.1 - i / 3));
      ctx.beginPath(); ctx.roundRect(kx - i * 0.12 * u, ty + inset - i * 0.12 * u + 0.25 * u, thumbW + i * 0.24 * u, d + i * 0.24 * u, d / 2 + i * 0.12 * u); ctx.fill();
    }
    const thumb = K.light ? '#ffffff' : C.mix(th.ink, '#ffffff', 0.5);
    const tg = ctx.createLinearGradient(0, ty + inset, 0, ty + inset + d);
    tg.addColorStop(0, thumb); tg.addColorStop(1, C.mix(thumb, th.bg, 0.1));
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.roundRect(kx, ty + inset, thumbW, d, d / 2); ctx.fill();
    const mcx = kx + thumbW / 2, mcy = ty + inset + d / 2;
    if (col > 0.05) { ctx.save(); ctx.globalAlpha *= col; K.mark('check', mcx, mcy, d * 0.62, K.legible(onPair.fill, thumb, 3), 1); ctx.restore(); }
    if (col < 0.95) { ctx.save(); ctx.globalAlpha *= 1 - col; K.mark('x', mcx, mcy, d * 0.5, C.mix(th.muted, th.bg, 0.15), 1); ctx.restore(); }
    K.ring(tx, ty, tw, th0, r, s.focus ? 1 : 0);
    ctx.restore();
    ctx.restore();
  },
});
