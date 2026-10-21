// A hotspot for interactive compositions: a pulsing marker over a picture or footage that emits press when it is tapped,
// with a label bubble that appears on hover and keyboard focus (or always). Rings pulse out from it on the session
// clock while the scene waits; a visited hotspot (bindable) calms down and shows a tick. Its point is in the picture's
// pixels, mapped into the item box the way footage is placed there (the kit convention: `space` and `fit`).
//
// Usage. Three hotspots over a 1440 x 900 picture that fills the frame; each opens its own scene and is ticked after:
//   vars: { "seenLens": false }
//   { "id": "lens", "asset": "ui-hotspot", "start": 0, "duration": 20,
//     "params": { "point": { "x": 512, "y": 300 }, "space": { "width": 1440, "height": 900 }, "fit": "cover",
//                 "label": "The lens", "visited": { "$var": "seenLens" } },
//     "transform": { "x": 0.5, "y": 0.5, "width": 1, "height": 1 } }
//   "wires": [{ "on": "lens.press", "do": [{ "set": { "seenLens": true } }, { "go": "lens" }] }]
// Give it the same transform and fit as the picture item. On a phone there is no hover: use labelOn "always" there.

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
  title: 'Hotspot',
  description: 'A pulsing hotspot for interactive compositions: a marker over a picture or footage (rings pulsing out on the session clock, a kit-icon or a short mark in the dot) that emits press on a tap, its hotkey or Tab + Enter, with a label bubble that appears on hover and focus (or always) and stays inside the box. A bound `visited` calms it and shows a tick; a ping event sends a strong ripple (a hint). The point is in the picture\'s pixels with `space` and `fit`, like the kit callouts: give it the picture item\'s transform. The tap target is at least a thumb wide. Takes a theme.',
  tags: ['ui', 'interactive', 'hotspot', 'marker', 'pin', 'explore', 'picture', 'footage', 'game'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    emits: { press: 'when it is tapped, or pressed with its hotkey or Tab + Enter; the value is `value` (or the label)' },
    accepts: { ping: 'a strong ripple and a bump: here (a hint after a while)' },
  },
  params: {
    point: { type: 'object', fields: { x: { type: 'number', default: 720 }, y: { type: 'number', default: 450 } }, description: 'Where it sits, in the picture\'s pixels' },
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the point refers to' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the picture item\'s fit)' },
    label: { type: 'string', default: 'Take a closer look', description: 'Its name in a bubble beside it (empty: none)' },
    labelOn: { type: 'enum', options: ['hover', 'always', 'never'], default: 'hover', description: 'When the label shows: on hover and focus, always (best on phones), never' },
    side: { type: 'enum', options: ['auto', 'right', 'left', 'top', 'bottom'], default: 'auto', description: 'Where the label sits; it flips when it would leave the box' },
    icon: { type: 'string', default: 'plus', description: 'A kit-icon name in the dot (empty: none, or the mark)' },
    mark: { type: 'string', default: '', description: 'A short text in the dot instead of the icon (1, 2, ?)' },
    visited: { type: 'boolean', default: false, description: 'Seen already: a calm dot with a tick (bind it to a boolean)' },
    value: { type: 'string', default: '', description: 'Sent with press (empty: the label)' },
    hotkey: { type: 'string', default: '', description: 'A key that presses it (empty: none)' },
    disabled: { type: 'boolean', default: false },
    pulse: { type: 'boolean', default: true, description: 'Rings pulsing out while it waits' },
    color: { type: 'string', default: '', description: 'Dot colour, a CSS colour (empty: the theme\'s accent)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 7, min: 2.5, max: 20, step: 0.1, description: 'Dot diameter in % of the frame\'s short side (the tap target is at least 11)' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05 },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
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

    // the point in the box, placed like footage with this fit
    const sx = f.width / p.space.width, sy = f.height / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const X = (f.width - p.space.width * kx) / 2 + p.point.x * kx, Y = (f.height - p.space.height * ky) / 2 + p.point.y * ky;
    const rD = (p.size * u) / 2;
    const hitD = Math.max(rD * 3.2, 11 * u);

    const s = f.ui.hit('press', X - hitD / 2, Y - hitD / 2, hitD, hitD, { shape: 'circle', value: p.value || p.label, label: p.label || 'hotspot', keys: p.hotkey ? [p.hotkey] : undefined, disabled: p.disabled });
    const live = !p.disabled;
    const hov = live && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.18)) : 0;
    const press = !live ? 0 : s.down ? 1 : s.pressed < 0.4 ? 1 - E.outBack(s.pressed / 0.4) : 0;
    const ping = Math.min(f.ui.since('ping'), live ? s.pressed : Infinity);
    const vc = f.ui.changed('visited');
    const visitK = p.visited ? (vc ? E.outCubic(clamp01(vc.since / 0.4)) : 1) : 0;
    const now = f.ui.now;

    const dotPair = K.pair(p.color || th.accent);
    const accent = dotPair.fill;
    const rim = K.light ? '#ffffff' : C.mix(th.ink, '#ffffff', 0.4);
    const labelK = p.label && p.labelOn !== 'never' ? (p.labelOn === 'always' ? 1 : Math.max(hov, s.focus ? 1 : 0)) : 0;
    const head = th.fonts?.headline ?? 'Space Grotesk';
    const L = p.label && p.labelOn !== 'never' ? K.text(p.label, { font: head, weight: 600, size: 3.2 * u, maxWidth: Math.max(1, Math.min(f.width * 0.6, 48 * u)), lineHeight: 1.15 }) : null;
    const M = !p.visited && p.mark ? K.text(p.mark, { font: head, weight: 700, size: rD * 0.95, wrap: 'none' }) : null;

    const appear = E.outCubic(kIn) * kOut * (p.disabled ? 0.5 : 1);
    ctx.save();
    ctx.globalAlpha *= appear;

    // the rings: two, half a period apart, on the session clock (calmer once visited)
    if (p.pulse && live) {
      for (let j = 0; j < 2; j++) {
        const k = (((now / 1.9 + j * 0.5) % 1) + 1) % 1;
        ctx.strokeStyle = C.alpha(accent, 0.8 * (1 - k) * (1 - 0.75 * visitK));
        ctx.lineWidth = Math.max(1.5, 0.6 * u * (1 - k * 0.5));
        ctx.beginPath(); ctx.arc(X, Y, rD * (1.05 + 1.5 * E.outCubic(k)), 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (ping < 0.9) {
      const k = ping / 0.9;
      ctx.fillStyle = C.alpha(accent, 0.28 * (1 - k));
      ctx.beginPath(); ctx.arc(X, Y, rD * (1 + 3.2 * E.outCubic(k)), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.alpha(accent, 0.8 * (1 - k)); ctx.lineWidth = Math.max(2, 0.6 * u * (1 - k));
      ctx.beginPath(); ctx.arc(X, Y, rD * (1 + 2.4 * E.outCubic(k)), 0, Math.PI * 2); ctx.stroke();
    }

    const bump = ping < 0.5 ? Math.sin((Math.PI * ping) / 0.5) * 0.18 : 0;
    const breathe = live && !p.visited ? 0.04 * Math.sin(now * 3.3) : 0;
    const sc = E.outBack(kIn) * (1 + 0.14 * hov + bump + breathe + (s.focus ? 0.08 : 0)) * (1 - 0.12 * Math.max(0, press));
    ctx.save();
    ctx.translate(X, Y); ctx.scale(sc, sc); ctx.translate(-X, -Y);
    // shadow, rim, dot
    for (let i = 4; i >= 1; i--) {
      ctx.fillStyle = K.shade((K.light ? 0.06 : 0.16) * (1.1 - i / 4) + 0.04);
      ctx.beginPath(); ctx.arc(X, Y + 0.4 * u, rD * 1.12 + i * 0.32 * u, 0, Math.PI * 2); ctx.fill();
    }
    K.glow(X - rD, Y - rD, rD * 2, rD * 2, rD, accent, 0.9 * (1 - visitK) + 0.5 * hov);
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(X, Y, rD * 1.12, 0, Math.PI * 2); ctx.fill();
    const body = C.mix(accent, K.surface, visitK * 0.85);
    const g = ctx.createLinearGradient(0, Y - rD, 0, Y + rD);
    g.addColorStop(0, C.mix(body, '#ffffff', 0.18)); g.addColorStop(1, body);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X, Y, rD, 0, Math.PI * 2); ctx.fill();
    if (visitK > 0) {
      K.mark('check', X, Y, rD * 1.25, K.legible(accent, body, 3), visitK);
    } else if (M) {
      lib.text.fill(ctx, M, X - M.width / 2, Y - M.height / 2, { color: dotPair.ink });
    } else if (p.icon) {
      // the plus turns a quarter on hover: it reads as "open"
      ctx.save();
      ctx.translate(X, Y); ctx.rotate(hov * Math.PI * 0.25); ctx.translate(-X, -Y);
      icon(f, p.icon, dotPair.ink, p.theme, X - rD * 0.62, Y - rD * 0.62, rD * 1.24, 2.75);
      ctx.restore();
    }
    ctx.restore();
    K.ring(X - rD * 1.12, Y - rD * 1.12, rD * 2.24, rD * 2.24, rD * 1.12, s.focus ? 1 : 0);

    // the label bubble: beside the dot, flipped to stay inside the box
    if (L && labelK > 0) {
      const padX = 1.8 * u, padY = 1.1 * u;
      const bw = L.width + padX * 2, bh = L.height + padY * 2;
      const gap = rD * 1.12 + 2 * u;
      const room = { right: f.width - (X + gap + bw), left: X - gap - bw, top: Y - gap - bh, bottom: f.height - (Y + gap + bh) };
      const order = p.side === 'auto' ? ['right', 'left', 'top', 'bottom'] : [p.side, { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[p.side], 'right', 'left', 'top', 'bottom'];
      const side = order.find((k) => room[k] >= 0) ?? order[0];
      let bx = side === 'right' ? X + gap : side === 'left' ? X - gap - bw : X - bw / 2;
      let by = side === 'top' ? Y - gap - bh : side === 'bottom' ? Y + gap : Y - bh / 2;
      bx = Math.max(0, Math.min(f.width - bw, bx)); by = Math.max(0, Math.min(f.height - bh, by));
      const k = E.outBack(labelK);
      const ox = side === 'right' ? bx : side === 'left' ? bx + bw : bx + bw / 2, oy = side === 'top' ? by + bh : side === 'bottom' ? by : by + bh / 2;
      ctx.save();
      ctx.globalAlpha *= clamp01(labelK * 1.5);
      ctx.translate(ox, oy); ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k); ctx.translate(-ox, -oy);
      K.shadow(bx, by, bw, bh, bh / 2, 0.8, 1);
      ctx.fillStyle = K.surface;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, Math.min(bh / 2, 2.4 * u)); ctx.fill();
      ctx.strokeStyle = C.alpha(accent, 0.55); ctx.lineWidth = Math.max(1, 0.2 * u); ctx.stroke();
      lib.text.fill(ctx, L, bx + padX, by + padY, { color: K.legible(th.ink, K.surface) });
      ctx.restore();
    }
    ctx.restore();
  },
});
