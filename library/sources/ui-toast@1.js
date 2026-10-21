// A toast for interactive compositions: feedback that drops in, holds and leaves. The clip sends it show with a text as
// the value ("Correct", "Try again"): its tone comes from the `tone` param, from the event (success, error) or from a
// prefix of the text ("ok: Nice one", "error: Not quite", "info: …", "warn: …", or a leading ✓ / ✗). A tick, a cross,
// an "i" or a "!" pops in a tinted circle, a thin line counts the hold down, an error shakes, a success sparkles. With
// `text` set it also shows from the item's start without any event (a video, a still).
//
// Usage. Feedback after an answer, sent by the wires of the answer cards:
//   { "id": "toast", "asset": "ui-toast", "start": 0, "duration": 60, "params": { "edge": "top" } }
//   "wires": [{ "on": "right.select", "do": { "send": "toast", "event": "success", "value": "Correct, +10" } },
//             { "on": "wrong.select", "do": { "send": "toast", "event": "show", "value": "error: Not quite" } }]
// Give it the whole frame (or a band) as its box: it sits at the top, middle or bottom of the box's safe area.

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
  title: 'Toast',
  description: 'Feedback for interactive compositions: a toast that drops in, holds and leaves when the clip sends it show (the value is its text: "Correct", "Try again"). The tone (success green with a tick, error red with a cross that shakes, info, warn) comes from the tone param, the event (success, error) or a prefix of the text ("ok: …", "error: …", ✓, ✗). The icon pops, a thin line counts the hold down, a success sparkles; the latest message replaces the one showing. With `text` set it shows from the item\'s start without an event (videos, stills). Sits at the top, middle or bottom of its box. Text has a size floor; takes a theme.',
  tags: ['ui', 'interactive', 'toast', 'feedback', 'notification', 'badge', 'quiz', 'game'],
  floor: FLOOR,
  uses: ['easing'],
  events: {
    accepts: {
      show: 'shows the value as its text; the tone from the param, or from a prefix of the text ("ok: …", "error: …", "info: …", "warn: …", ✓, ✗)',
      success: 'shows the value (default "Correct") as a success: green, a tick, a sparkle',
      error: 'shows the value (default "Try again") as an error: red, a cross, a shake',
    },
  },
  params: {
    text: { type: 'string', default: '', description: 'A message shown from the item\'s start without any event (empty: wait for one)' },
    tone: { type: 'enum', options: ['auto', 'info', 'success', 'error', 'warn', 'neutral'], default: 'auto', description: 'auto: from the event name or the text\'s prefix, else info' },
    hold: { type: 'number', default: 1.8, min: 0, max: 30, step: 0.1, description: 'Seconds it stays before it leaves (0: it stays)' },
    edge: { type: 'enum', options: ['top', 'center', 'bottom'], default: 'top', description: 'Where it sits in the box\'s safe area' },
    icon: { type: 'boolean', default: true, description: 'The tone\'s icon in a circle at the left' },
    timer: { type: 'boolean', default: true, description: 'A thin line along the bottom counting the hold down' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 3.8, min: 2.6, max: 10, step: 0.1, description: 'Text size in % of the frame\'s short side' },
    width: { type: 'number', default: 82, min: 20, max: 100, step: 1, description: 'Widest it gets, in % of the frame\'s short side (never wider than the box)' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05, description: 'Seconds into the item before `text` shows' },
    inDur: { type: 'number', default: 0.42, min: 0.05, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.3, min: 0.05, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const K = toolkit(f, th);
    const { u, C } = K;
    const clamp01 = lib.clamp01;

    // the latest message: an event (show, success, error), else `text` from the item's start
    let msg = null;
    for (const ev of ['show', 'success', 'error']) {
      const r = f.ui.received(ev);
      if (r && (!msg || r.since < msg.since)) msg = { since: r.since, text: r.value === null || r.value === undefined ? '' : String(r.value), ev };
    }
    if (!msg && p.text) msg = { since: f.t - p.delay, text: p.text, ev: 'show' };
    if (!msg || msg.since < 0) return;
    let text = msg.text;
    let tone = p.tone !== 'auto' ? p.tone : msg.ev === 'success' ? 'success' : msg.ev === 'error' ? 'error' : null;
    const pre = /^\s*(?:(ok|success|good|correct|yes)\s*:|(error|bad|wrong|no|fail)\s*:|(info|note|hint)\s*:|(warn|warning)\s*:|([✓✔])|([✗✘×]))\s*/i.exec(text);
    if (pre) {
      text = text.slice(pre[0].length);
      tone ??= pre[1] || pre[5] ? 'success' : pre[2] || pre[6] ? 'error' : pre[4] ? 'warn' : 'info';
    }
    tone ??= 'info';
    if (!text) text = tone === 'success' ? 'Correct' : tone === 'error' ? 'Try again' : '';
    if (!text) return;

    const s = msg.since;
    const kIn = clamp01(s / p.inDur);
    const kOut = p.hold > 0 ? clamp01((p.hold + p.outDur - s) / p.outDur) : 1;
    if (kOut <= 0) return;
    const toneC = tone === 'success' ? K.good : tone === 'error' ? K.bad : tone === 'warn' ? th.accent4 ?? th.accent2 ?? '#ffb02e' : tone === 'neutral' ? th.muted : th.accent;

    // layout: a pill at the top, middle or bottom of the box's safe area
    const head = th.fonts?.headline ?? 'Space Grotesk';
    const S = f.safe;
    const maxW = Math.min(S.width, p.width * u);
    const padY = p.size * u * 0.62, padX = p.size * u * 0.9;
    const lineH = p.size * u * 1.2;
    const iconD = p.icon ? lineH + padY * 0.9 : 0;
    const gapI = p.icon ? p.size * u * 0.6 : 0;
    const L = K.text(text, { font: head, weight: 700, size: p.size * u, maxWidth: Math.max(1, maxW - padX * 2 - iconD - gapI), maxLines: 2, fit: true, lineHeight: 1.2 });
    const H = Math.max(L.height, iconD) + padY * 2;
    const W = L.width + padX * 2 + iconD + gapI;
    const x = S.x + (S.width - W) / 2;
    const y = p.edge === 'top' ? S.y + 2 * u : p.edge === 'bottom' ? S.y + S.height - H - 2 * u : S.y + (S.height - H) / 2;
    const r = Math.min(H / 2, 4 * u);
    const fill = C.mix(K.surface, toneC, K.light ? 0.08 : 0.14);
    const ink = K.legible(th.ink, fill);

    const dir = p.edge === 'bottom' ? 1 : p.edge === 'top' ? -1 : 0;
    const e = E.outBack(kIn), o = E.inCubic(1 - kOut);
    const shakeX = tone === 'error' && s > 0.08 && s < 0.7 ? Math.sin((s - 0.08) * 46) * Math.exp(-(s - 0.08) * 6) * 1.6 * u : 0;
    const sc = (0.84 + 0.16 * e) * (1 - 0.06 * o);
    const cx = x + W / 2, cy = y + H / 2;
    ctx.save();
    ctx.globalAlpha *= clamp01(kIn * 2) * kOut;
    ctx.translate(cx + shakeX, cy + dir * ((1 - E.outCubic(kIn)) * 5 * u + o * 2.5 * u) + (dir === 0 ? (1 - E.outCubic(kIn)) * 2 * u : 0));
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    K.shadow(x, y, W, H, r, 1.4, 1.2);
    K.glow(x, y, W, H, r, toneC, 0.6);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(x, y, W, H, r); ctx.fill();
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, y, 0, y + H);
    sheen.addColorStop(0, C.alpha(th.ink, K.light ? 0.0 : 0.08)); sheen.addColorStop(0.6, C.alpha(th.ink, 0));
    ctx.fillStyle = sheen; ctx.fillRect(x, y, W, H);
    if (p.timer && p.hold > 0) {
      const left = 1 - clamp01(s / p.hold);
      const lh = Math.max(2, 0.45 * u);
      ctx.fillStyle = C.alpha(toneC, 0.85);
      ctx.fillRect(x, y + H - lh, W * left, lh);
    }
    ctx.restore();
    ctx.strokeStyle = C.alpha(toneC, 0.55); ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.beginPath(); ctx.roundRect(x, y, W, H, r); ctx.stroke();

    if (p.icon) {
      const ix = x + padX + iconD / 2 - padX * 0.35, iy = cy;
      const ik = E.outBack(clamp01((s - 0.06) / 0.35));
      const tp = K.pair(toneC);
      if (tone === 'success' && s < 0.9) {
        // a burst of six sparks around the icon
        const k = clamp01((s - 0.12) / 0.7);
        if (k > 0) {
          ctx.fillStyle = C.alpha(toneC, 1 - k);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + 0.4, rr = iconD * (0.55 + 0.6 * E.outCubic(k));
            ctx.beginPath(); ctx.arc(ix + Math.cos(a) * rr, iy + Math.sin(a) * rr, iconD * 0.07 * (1 - k * 0.6), 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.save();
      ctx.translate(ix, iy); ctx.scale(ik, ik); ctx.translate(-ix, -iy);
      ctx.fillStyle = tp.fill;
      ctx.beginPath(); ctx.arc(ix, iy, iconD / 2, 0, Math.PI * 2); ctx.fill();
      const kind = tone === 'success' ? 'check' : tone === 'error' ? 'x' : tone === 'warn' ? 'alert' : 'info';
      K.mark(kind, ix, iy, iconD * 0.62, tp.ink, clamp01((s - 0.08) / 0.2));
      ctx.restore();
    }
    lib.text.fill(ctx, L, x + padX + iconD + gapI - (p.icon ? padX * 0.35 : 0), cy - L.height / 2 + L.size * 0.02, { color: ink });
    ctx.restore();
  },
});
