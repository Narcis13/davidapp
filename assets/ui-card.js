// A choice card for interactive compositions (quizzes, pickers, memory games): a rounded card with an optional answer
// letter, picture or kit-icon, a title and a detail line. Tapping it (or its hotkey, or Tab + Enter) emits select with
// its value. It shows itself selected when a bound `choice` holds its value, and right or wrong once `reveal` turns
// on (the wrong pick shakes, the right one gets a tick and a bump, the others step back). It flips over to show a
// back on a flip event. Hover lifts it with a glow that follows the pointer; a press sinks it with a ripple.
//
// Usage. Four answers bound to one variable; a pick reveals the answer after a beat:
//   vars: { "pick": "", "shown": false }
//   { "id": "a1", "asset": "ui-card", "start": 0, "duration": 8,
//     "params": { "title": "Paris", "badge": "A", "hotkey": "1", "choice": { "$var": "pick" }, "answer": "Lyon",
//                 "reveal": { "$var": "shown" } },
//     "transform": { "space": "safe", "x": 0.27, "y": 0.55, "width": 0.46, "height": 0.2 } }
//   "wires": [{ "on": "a1.select", "do": [{ "set": { "pick": "$value", "shown": true } }] }]
// (one wire per card, or the same wire on each card's id). Give every card of a set the same `answer`.

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
  title: 'Choice card',
  description: 'A selectable, flippable choice card for interactive quizzes, pickers and memory games: answer letter, optional picture or kit-icon, title and detail on a soft-shadowed surface card. Emits select with its value on a tap, its hotkey or Tab + Enter. Bind `choice` (every card of a set to one variable) and it shows itself selected; bind `reveal` and give `answer` and it shows right (tick, bump) and wrong (cross, shake), the others stepping back. Flips to its back on a flip event; reacts to shake and pop. Hover lifts it with a glow that follows the pointer. Text has a size floor; takes a theme.',
  tags: ['ui', 'interactive', 'card', 'choice', 'quiz', 'select', 'flip', 'game'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    emits: { select: 'when it is tapped, or chosen with its hotkey or Tab + Enter; the value is `value` (or the title)' },
    accepts: { flip: 'turns it over (every flip turns it again)', shake: 'a sideways shake: a wrong pick, a refused one', pop: 'a bump: look here' },
  },
  params: {
    title: { type: 'string', default: 'Paris', description: '*Asterisks* mark words in the accent colour; \\n breaks a line' },
    detail: { type: 'string', default: '', description: 'A smaller muted line under the title (empty: none)' },
    badge: { type: 'string', default: 'A', description: 'A short tag in the top-left corner: an answer letter, a number (empty: none)' },
    icon: { type: 'string', default: '', description: 'A kit-icon name drawn large above the title (empty: none)' },
    image: { type: 'image', default: null, description: 'A picture across the top of the card, cover-fitted (none: text only)' },
    value: { type: 'string', default: '', description: 'Sent with select (read it as "$value" in a wire); empty: the title' },
    choice: { type: 'string', default: '', description: 'The value chosen in the set: bind every card to one variable ({ "$var": "pick" }); the card whose value it holds is selected' },
    answer: { type: 'string', default: '', description: 'The right value of the set (empty: no right answer)' },
    reveal: { type: 'boolean', default: false, description: 'Show right and wrong (bind it to a boolean the clip sets after a pick); the cards stop taking picks' },
    state: { type: 'enum', options: ['auto', 'idle', 'selected', 'correct', 'wrong'], default: 'auto', description: 'auto: from choice, answer and reveal; or force one (a still, a video)' },
    flipped: { type: 'boolean', default: false, description: 'Show the back; every flip event turns it over again' },
    back: { type: 'string', default: '', description: 'Text on the back (empty: a pattern)' },
    hotkey: { type: 'string', default: '', description: 'A key that picks it (1, a…; empty: none)' },
    disabled: { type: 'boolean', default: false, description: 'Dimmed and not pickable (bind it to lock the set)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 5, min: 2.6, max: 16, step: 0.1, description: 'Title size in % of the frame\'s short side (it shrinks to fit the card, down to the floor)' },
    align: { type: 'enum', options: ['center', 'left'], default: 'center' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05, description: 'Seconds into the item before it comes in (stagger a set)' },
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
    const kIn = p.inDur > 0 ? clamp01((f.t - p.delay) / p.inDur) : f.t >= p.delay ? 1 : 0;
    const kOut = p.outDur > 0 ? clamp01((f.duration - f.t) / p.outDur) : 1;
    if (kIn <= 0 || kOut <= 0) return;

    const m = Math.min(1.6 * u, Math.min(f.width, f.height) * 0.06);   // room for the shadow and the focus ring
    const x = m, y = m, w = f.width - 2 * m, h = f.height - 2 * m;
    if (w <= 0 || h <= 0) return;
    const r = Math.max(1.2 * u, Math.min(3.2 * u, Math.min(w, h) * 0.08));
    const value = p.value || p.title;

    // state: chosen when the bound choice holds its value; with reveal, right or wrong against the answer
    const chosen = p.choice !== '' && p.choice === value;
    const revealed = p.reveal && p.answer !== '';
    let state = p.state;
    if (state === 'auto') state = revealed ? (value === p.answer ? 'correct' : chosen ? 'wrong' : 'idle') : chosen ? 'selected' : 'idle';
    const settled = revealed && state === 'idle';
    const locked = p.disabled || revealed;

    const s = f.ui.hit('select', x, y, w, h, { value, keys: p.hotkey ? [p.hotkey] : undefined, label: p.title || p.badge || 'card', disabled: locked });
    const pt = f.ui.pointer;
    const hov = !locked && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.2)) : 0;
    const press = locked ? 0 : s.down ? 1 : s.pressed < 0.4 ? 1 - E.outBack(s.pressed / 0.4) : 0;
    const selC = f.ui.changed('choice'), revC = f.ui.changed('reveal');
    const selT = selC ? selC.since : Infinity, revT = revC ? revC.since : Infinity;
    const markT = state === 'selected' ? selT : revT;
    const toneK = E.outCubic(clamp01(markT / 0.25));
    const shk = Math.min(f.ui.since('shake'), state === 'wrong' ? revT : Infinity);
    const shakeX = shk < 0.7 ? Math.sin(shk * 42) * Math.exp(-shk * 6) * 1.6 * u : 0;
    const pop = Math.min(f.ui.since('pop'), state === 'correct' ? revT : Infinity);
    const bump = pop < 0.5 ? Math.sin((Math.PI * pop) / 0.5) * 0.05 : 0;

    // the flip: every flip event (and the flipped param) turns it; the face changes half way
    const flipEv = f.ui.received('flip'), flipC = f.ui.changed('flipped');
    const flipped = p.flipped !== ((flipEv?.count ?? 0) % 2 === 1);
    const flipT = Math.min(flipEv ? flipEv.since : Infinity, flipC ? flipC.since : Infinity);
    let back = flipped, sx = 1;
    if (flipT < 0.55) { const k = E.inOutCubic(flipT / 0.55); sx = Math.abs(Math.cos(Math.PI * k)); back = k < 0.5 ? !flipped : flipped; }

    // colours
    const tone = state === 'correct' ? K.good : state === 'wrong' ? K.bad : state === 'selected' ? th.accent : null;
    const base = C.mix(K.surface, th.ink, 0.045 * hov);
    const tinted = tone && (state !== 'correct' || chosen || p.state === 'correct');
    const fill = tinted ? C.mix(base, tone, 0.17 * toneK) : base;
    const border = tone ? C.mix(C.alpha(th.ink, 0.14), tone, toneK) : C.alpha(th.ink, K.light ? 0.2 : 0.12 + 0.12 * hov);
    const ink = K.legible(th.ink, fill), muted = K.legible(th.muted, fill);
    const backPair = K.pair(th.accent);

    // text, laid out before any transform (the floor is measured on the screen)
    const head = th.fonts?.headline ?? 'Space Grotesk', body = th.fonts?.body ?? 'Inter', mono = th.fonts?.mono ?? 'JetBrains Mono';
    const pad = Math.max(1.8 * u, Math.min(w, h) * 0.08);
    const badgeS = Math.max(5.6 * u, Math.min(9 * u, Math.min(w, h) * 0.16));
    const B = p.badge ? K.text(p.badge, { font: mono, weight: 700, size: badgeS * 0.5, wrap: 'none' }) : null;
    const imgH = p.image ? h * 0.55 : 0;
    const top = p.image ? y + imgH + pad * 0.7 : y + pad + (B ? badgeS * 0.75 : 0);
    const bottom = y + h - pad - (B && !p.image ? badgeS * 0.25 : 0);
    const iconS = !p.image && p.icon ? Math.min(w * 0.4, (bottom - top) * 0.42) : 0;
    const iconGap = iconS ? pad * 0.5 : 0;
    const avail = Math.max(1, bottom - top - iconS - iconGap);
    const inner = w - pad * 2;
    const T = p.title ? K.text(p.title, { font: head, weight: 700, size: p.size * u, maxWidth: inner, maxHeight: avail * (p.detail ? 0.66 : 1), fit: true, markup: true, lineHeight: 1.1, align: p.align }) : null;
    const gap = T && p.detail ? T.size * 0.35 : 0;
    const D = p.detail ? K.text(p.detail, { font: body, weight: 500, size: Math.max(p.size * u * 0.56, 2.9 * u), maxWidth: inner, maxHeight: Math.max(1, avail - (T ? T.height : 0) - gap), fit: true, lineHeight: 1.22, align: p.align }) : null;
    const BK = back && p.back ? K.text(p.back, { font: head, weight: 700, size: p.size * u, maxWidth: inner, maxHeight: h - pad * 2, fit: true, markup: true, lineHeight: 1.1, align: 'center' }) : null;

    const appear = E.outCubic(kIn) * kOut * (settled ? 1 - 0.5 * E.outCubic(clamp01(revT / 0.35)) : 1) * (p.disabled ? 0.55 : 1);
    const lift = (state === 'selected' ? 0.5 : 0) * u * toneK + hov * 0.7 * u;
    const sc = (0.94 + 0.06 * E.outBack(kIn)) * (1 + bump) * (1 - 0.03 * Math.max(0, press)) * (1 + 0.05 * (1 - sx));
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    ctx.globalAlpha *= appear;
    ctx.translate(cx + shakeX, cy - lift + (1 - E.outCubic(kIn)) * 4 * u);
    ctx.scale(sc * Math.max(0.002, sx), sc);
    ctx.translate(-cx, -cy);

    K.shadow(x, y, w, h, r, 0.6 + 1.1 * hov + (state === 'selected' ? 0.5 * toneK : 0) - 0.45 * Math.max(0, press), 1);
    if (tone && !back) K.glow(x, y, w, h, r, tone, 0.65 * toneK);

    if (back) {
      // the back: the accent, a quiet pattern of diagonal lines, and its text
      ctx.fillStyle = backPair.fill;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
      ctx.strokeStyle = C.alpha(backPair.ink, 0.07); ctx.lineWidth = Math.max(1, 0.45 * u);
      ctx.beginPath();
      for (let d = -h; d < w; d += 2.6 * u) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
      ctx.stroke();
      ctx.restore();
      const ins = Math.min(w, h) * 0.06;
      ctx.strokeStyle = C.alpha(backPair.ink, 0.35); ctx.lineWidth = Math.max(1.5, 0.3 * u);
      ctx.beginPath(); ctx.roundRect(x + ins, y + ins, w - 2 * ins, h - 2 * ins, Math.max(0, r - ins * 0.6)); ctx.stroke();
      if (BK) lib.text.fill(ctx, BK, x + pad, cy - BK.height / 2, { color: backPair.ink, emColor: backPair.ink });
      ctx.restore();
      return;
    }

    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
    if (p.image) {
      const img = f.image(p.image);
      const k = Math.max(w / img.width, imgH / img.height);
      ctx.drawImage(img, x + (w - img.width * k) / 2, y + (imgH - img.height * k) / 2, img.width * k, img.height * k);
      const fade = ctx.createLinearGradient(0, y + imgH * 0.6, 0, y + imgH);
      fade.addColorStop(0, C.alpha(fill, 0)); fade.addColorStop(1, fill);
      ctx.fillStyle = fade; ctx.fillRect(x, y + imgH * 0.6, w, imgH * 0.4 + 1);
    }
    if (hov > 0 && pt && pt.type !== 'touch') {
      const rg = ctx.createRadialGradient(pt.x, pt.y + lift, 0, pt.x, pt.y + lift, Math.max(w, h) * 0.7);
      rg.addColorStop(0, C.alpha(th.accent, 0.16 * hov)); rg.addColorStop(1, C.alpha(th.accent, 0));
      ctx.fillStyle = rg; ctx.fillRect(x, y, w, h);
    }
    if (!locked) {
      const inside = pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
      K.ripple(inside ? pt.x : cx, inside ? pt.y : cy, Math.hypot(w, h) * 0.9, th.accent, s.pressed, 0.6, 0.26);
    }
    const sheen = ctx.createLinearGradient(0, y, 0, y + h * 0.6);
    sheen.addColorStop(0, C.alpha(th.ink, K.light ? 0.0 : 0.06)); sheen.addColorStop(1, C.alpha(th.ink, 0));
    ctx.fillStyle = sheen; ctx.fillRect(x, y, w, h * 0.6);
    ctx.restore();
    ctx.strokeStyle = border; ctx.lineWidth = tone ? Math.max(2, 0.5 * u) : Math.max(1, 0.18 * u);
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();

    // the badge, top-left (the accent once selected)
    if (B) {
      const bx = x + pad * 0.7, by = y + pad * 0.7;
      const bFill = tone && toneK > 0 ? C.mix(C.mix(K.surface, th.ink, 0.1), tone, toneK) : C.mix(K.surface, th.ink, K.light ? 0.08 : 0.1);
      const bp = K.pair(bFill);
      ctx.fillStyle = bp.fill;
      ctx.beginPath(); ctx.roundRect(bx, by, badgeS, badgeS, badgeS * 0.3); ctx.fill();
      lib.text.fill(ctx, B, bx + (badgeS - B.width) / 2, by + (badgeS - B.height) / 2, { color: bp.ink });
    }
    // the mark, top-right: a tick (selected, right) or a cross (wrong), popping in
    if (tone && toneK > 0) {
      const d = badgeS * 0.86, mx = x + w - pad * 0.7 - d / 2, my = y + pad * 0.7 + d / 2;
      const kk = E.outBack(clamp01(markT / 0.35));
      const mp = K.pair(tone);
      ctx.save();
      ctx.translate(mx, my); ctx.scale(kk, kk); ctx.translate(-mx, -my);
      ctx.fillStyle = mp.fill;
      ctx.beginPath(); ctx.arc(mx, my, d / 2, 0, Math.PI * 2); ctx.fill();
      K.mark(state === 'wrong' ? 'x' : 'check', mx, my, d * 0.72, mp.ink, clamp01(markT / 0.3));
      ctx.restore();
    }

    // icon, title, detail: centred in the space under the badge (or the picture)
    const blockH = iconS + iconGap + (T ? T.height : 0) + gap + (D ? D.height : 0);
    let ty = p.image ? top : top + (bottom - top - blockH) / 2;
    if (iconS) { icon(f, p.icon, K.legible(th.accent, fill, 3), p.theme, p.align === 'left' ? x + pad : cx - iconS / 2, ty, iconS, 2); ty += iconS + iconGap; }
    if (T) { lib.text.fill(ctx, T, x + pad, ty, { color: ink, emColor: K.legible(th.accent, fill) }); ty += T.height + gap; }
    if (D) lib.text.fill(ctx, D, x + pad, ty, { color: muted });

    K.ring(x, y, w, h, r, s.focus ? 1 : 0);
    ctx.restore();
  },
});
