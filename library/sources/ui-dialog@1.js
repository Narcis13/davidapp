// A modal dialog for interactive compositions: a scrim over the whole frame, a panel with an optional kit-icon, a title,
// a body and one or two buttons. Confirm emits confirm (also Enter), cancel emits cancel (also Escape). The scrim is a
// hit region under the panel, so nothing below the dialog takes a tap while it is open: a tap on the scrim emits
// cancel (or nothing, with scrimTap "block"). It rises in with a spring when its item appears, when the clip sends it
// open, or when a bound `open` turns true, and sinks out when `open` turns false.
//
// Usage. A "leave the game?" dialog shown by a variable; the controls under it are disabled by the same variable:
//   vars: { "ask": false }
//   { "id": "leave", "asset": "ui-dialog", "start": 0, "duration": 60, "when": { "var": "ask", "eq": true },
//     "params": { "title": "Leave the game?", "body": "Your score is kept for today.", "confirm": "Leave", "cancel": "Stay",
//                 "icon": "log-out", "tone": "danger" } }
//   "wires": [{ "on": "key:Escape", "if": { "var": "ask", "eq": false }, "do": [{ "set": { "ask": true } }, { "send": "leave", "event": "open" }] },
//             { "on": "leave.confirm", "do": { "go": "menu" } }, { "on": "leave.cancel", "do": { "set": { "ask": false } } }]
// An item shown with `when` keeps the time of its scene, so send it open as it appears (above) to replay the entrance,
// or bind "open": { "$var": "ask" } and leave `when` out: then it also animates out. Give it the whole frame as its box.

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
  title: 'Dialog',
  description: 'A modal dialog for interactive compositions: a scrim over the frame, a soft panel with an optional kit-icon, a title, a multi-line body and one or two tactile buttons. Confirm emits confirm (Enter too), cancel emits cancel (Escape too); the scrim is a hit region under the panel, so nothing below takes a tap while it is open, and a tap on it emits cancel (or nothing). Springs in when its item appears, when the clip sends it open, or when a bound `open` turns true; sinks out when `open` turns false; shakes on shake. Buttons stack for thumbs on a vertical frame and sit side by side on a wide one. Takes a theme.',
  tags: ['ui', 'interactive', 'dialog', 'modal', 'confirm', 'alert', 'popup', 'game'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    emits: {
      confirm: 'the confirm button: a tap, Enter, or Tab to it and Enter',
      cancel: 'the cancel button, Escape, or a tap on the scrim (with scrimTap "cancel")',
      block: 'a tap the dialog swallowed (on its panel, or on the scrim with scrimTap "block"); usually not wired',
    },
    accepts: { open: 'plays the entrance again (send it when the item appears through `when`)', shake: 'a sideways shake of the panel: a refused answer' },
  },
  params: {
    title: { type: 'string', default: 'Leave the game?', description: 'The question or the news (empty: none)' },
    body: { type: 'text', default: 'Your score is kept for today. You can come back and finish this round later.', description: 'What it means; several lines are fine (empty: none)' },
    confirm: { type: 'string', default: 'Leave', description: 'The confirm button\'s label' },
    cancel: { type: 'string', default: 'Stay', description: 'The cancel button\'s label (empty: one button)' },
    icon: { type: 'string', default: 'log-out', description: 'A kit-icon name in a tinted circle above the title (empty: none)' },
    tone: { type: 'enum', options: ['accent', 'danger', 'success'], default: 'accent', description: 'Colour of the confirm button and the icon: the accent, red for a destructive choice, green for good news' },
    open: { type: 'boolean', default: true, description: 'Shown or not: bind it to a boolean to animate it in and out (leave `when` out then)' },
    hotkeys: { type: 'boolean', default: true, description: 'Enter confirms, Escape cancels' },
    scrimTap: { type: 'enum', options: ['cancel', 'block', 'through'], default: 'cancel', description: 'A tap on the scrim: emits cancel; is swallowed (emits block); or goes through to what is under it (not modal)' },
    scrim: { type: 'number', default: 0.62, min: 0, max: 1, step: 0.01, description: 'How dark the scrim is' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    width: { type: 'number', default: 82, min: 30, max: 100, step: 1, description: 'Panel width in % of the frame\'s short side (never wider than the box)' },
    size: { type: 'number', default: 5.4, min: 2.6, max: 12, step: 0.1, description: 'Title size in % of the frame\'s short side (the body is about two thirds of it)' },
    buttonSize: { type: 'number', default: 11.5, min: 7, max: 20, step: 0.1, description: 'Button height in % of the frame\'s short side' },
    inDur: { type: 'number', default: 0.42, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.24, min: 0, max: 3, step: 0.01, description: 'Seconds it takes to sink out when `open` turns false' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const th = f.theme ?? f.use(p.theme);
    const K = toolkit(f, th);
    const { u, C } = K;
    const clamp01 = lib.clamp01;

    // how open it is: the item's entrance, an open event, a bound `open` turning on (or off: the exit)
    const inK = (s) => (p.inDur > 0 ? clamp01(s / p.inDur) : s >= 0 ? 1 : 0);
    const oc = f.ui.changed('open');
    let k;
    if (p.open) k = Math.min(inK(f.t), inK(f.ui.since('open')), oc ? inK(oc.since) : 1);
    else k = oc && p.outDur > 0 ? 1 - clamp01(oc.since / p.outDur) : 0;
    if (k <= 0) return;
    const closing = !p.open;

    const tone = p.tone === 'danger' ? K.bad : p.tone === 'success' ? K.good : th.accent;
    const head = th.fonts?.headline ?? 'Space Grotesk', bodyF = th.fonts?.body ?? 'Inter';
    const W = f.width, H = f.height;
    const PW = Math.min(W - 2 * 4 * u, p.width * u);
    const pad = Math.min(5.5 * u, PW * 0.08);
    const inner = PW - pad * 2;
    const bh = p.buttonSize * u;
    const gapB = 2.2 * u;
    const two = !!p.cancel;
    const vertical = H > W * 1.05;
    const fill = K.surface;

    // text (laid out before any transform: the floor is measured on the screen)
    const T = p.title ? K.text(p.title, { font: head, weight: 700, size: p.size * u, maxWidth: inner, lineHeight: 1.12, align: 'center' }) : null;
    const confirmL = K.text(p.confirm || 'OK', { font: head, weight: 700, size: bh * 0.34, maxWidth: (vertical || !two ? inner : (inner - gapB) / 2) - bh * 0.6, wrap: 'none', fit: true });
    const cancelL = two ? K.text(p.cancel, { font: head, weight: 700, size: bh * 0.34, maxWidth: (vertical ? inner : (inner - gapB) / 2) - bh * 0.6, wrap: 'none', fit: true }) : null;
    const side = !vertical && two;
    const buttonsH = side || !two ? bh : bh * 2 + gapB;
    const iconD = p.icon ? Math.min(14 * u, PW * 0.2) : 0;
    const g1 = iconD ? 2.4 * u : 0, g2 = T ? 1.6 * u : 0, g3 = 4 * u;
    const fixed = pad * 2 + iconD + g1 + (T ? T.height : 0) + g2 + g3 + buttonsH;
    const B = p.body ? K.text(p.body, { font: bodyF, weight: 400, size: p.size * u * 0.66, maxWidth: inner, maxHeight: Math.max(1, H - 6 * u - fixed), fit: true, lineHeight: 1.38, align: 'center' }) : null;
    const PH = fixed + (B ? B.height : 0) - (B ? 0 : g2);
    const px = (W - PW) / 2, py = (H - PH) / 2;
    const pr = Math.min(4.5 * u, PW * 0.08);

    // where the buttons rest
    const by = py + PH - pad - buttonsH;
    const bw = side ? (inner - gapB) / 2 : inner;
    const conf = { x: side ? px + pad + bw + gapB : px + pad, y: by, w: bw, h: bh };
    const canc = two ? { x: px + pad, y: side ? by : by + bh + gapB, w: bw, h: bh } : null;

    // regions: the scrim under everything, the panel, then the buttons (Tab: confirm first)
    // (with one button, Escape belongs to the scrim when a tap on it cancels)
    const scrimCancels = p.scrimTap === 'cancel';
    if (!closing && p.scrimTap !== 'through') f.ui.hit(scrimCancels ? 'cancel' : 'block', 0, 0, W, H, { id: 'scrim', focus: false, modal: true, label: 'outside the dialog', keys: scrimCancels && !canc && p.hotkeys ? ['Escape'] : undefined });
    if (!closing) f.ui.hit('block', px, py, PW, PH, { id: 'panel', focus: false, label: p.title || 'dialog' });
    const sC = f.ui.hit('confirm', conf.x, conf.y, conf.w, conf.h, { keys: p.hotkeys ? ['Enter'] : undefined, label: p.confirm || 'OK', disabled: closing });
    const sX = canc ? f.ui.hit('cancel', canc.x, canc.y, canc.w, canc.h, { id: 'button', keys: p.hotkeys ? ['Escape'] : undefined, label: p.cancel, disabled: closing }) : null;
    const pt = f.ui.pointer;

    const sh = f.ui.since('shake');
    const shakeX = sh < 0.7 ? Math.sin(sh * 42) * Math.exp(-sh * 6) * 2.2 * u : 0;
    const e = closing ? E.inCubic(k) : E.outBack(k);

    // the scrim
    ctx.save();
    ctx.fillStyle = K.light ? C.alpha(th.ink, p.scrim * 0.75 * E.outCubic(k)) : `rgba(0,0,0,${(p.scrim * E.outCubic(k)).toFixed(4)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha *= E.outCubic(k);
    const cx = W / 2, cy = py + PH / 2;
    const sc = 0.9 + 0.1 * e;
    ctx.translate(cx + shakeX, cy + (1 - e) * 6 * u);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
    K.shadow(px, py, PW, PH, pr, 2, 1.4);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(px, py, PW, PH, pr); ctx.fill();
    const sheen = ctx.createLinearGradient(0, py, 0, py + PH * 0.5);
    sheen.addColorStop(0, C.alpha(th.ink, K.light ? 0.0 : 0.07)); sheen.addColorStop(1, C.alpha(th.ink, 0));
    ctx.fillStyle = sheen; ctx.fill();
    ctx.strokeStyle = C.alpha(th.ink, K.light ? 0.18 : 0.14); ctx.lineWidth = Math.max(1, 0.16 * u);
    ctx.beginPath(); ctx.roundRect(px, py, PW, PH, pr); ctx.stroke();

    let y = py + pad;
    if (iconD) {
      const ik = E.outBack(clamp01((k - 0.25) / 0.75));
      const ix = cx, iy = y + iconD / 2;
      ctx.save();
      ctx.translate(ix, iy); ctx.scale(ik, ik); ctx.translate(-ix, -iy);
      ctx.fillStyle = C.mix(fill, tone, 0.18);
      ctx.beginPath(); ctx.arc(ix, iy, iconD / 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.alpha(tone, 0.35); ctx.lineWidth = Math.max(1.5, 0.3 * u);
      ctx.beginPath(); ctx.arc(ix, iy, iconD / 2 + 0.9 * u, 0, Math.PI * 2); ctx.stroke();
      icon(f, p.icon, K.legible(tone, C.mix(fill, tone, 0.18), 3), p.theme, ix - iconD * 0.26, iy - iconD * 0.26, iconD * 0.52, 2.25);
      ctx.restore();
      y += iconD + g1;
    }
    if (T) { lib.text.fill(ctx, T, px + pad, y, { color: K.legible(th.ink, fill) }); y += T.height + g2; }
    if (B) lib.text.fill(ctx, B, px + pad, y, { color: K.legible(C.mix(th.muted, th.ink, 0.3), fill) });

    // the buttons: confirm filled with the tone, cancel a surface button (as ui-button draws them)
    const button = (b, s, L, primary) => {
      const live = !closing;
      const hov = live && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.18)) : 0;
      const press = !live ? 0 : s.down ? 1 : s.pressed < 0.36 ? 1 - E.outBack(s.pressed / 0.36) : 0;
      const lip = b.h * 0.075, bodyH = b.h - lip, r = bodyH / 2;
      const pr0 = primary ? K.pair(tone) : null;
      const bFill = C.mix(primary ? C.mix(pr0.fill, K.ratio(pr0.ink, '#000000') > K.ratio(pr0.ink, '#ffffff') ? '#000000' : '#ffffff', 0.1 * hov) : C.mix(C.mix(fill, th.ink, 0.07), th.ink, 0.05 * hov), '#000000', 0.09 * Math.max(0, press));
      const ink = primary ? pr0.ink : K.legible(th.ink, bFill);
      const lipC = C.mix(bFill, '#000000', primary ? 0.34 : 0.4);
      const sink = lip * Math.max(-0.4, press), top = b.y + sink;
      ctx.save();
      const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2, bs = 1 - 0.03 * Math.max(0, press);
      ctx.translate(bcx, bcy); ctx.scale(bs, bs); ctx.translate(-bcx, -bcy);
      if (primary) K.glow(b.x, top, b.w, bodyH + lip - sink, r, bFill, 0.4 + 0.5 * hov);
      ctx.fillStyle = lipC;
      ctx.beginPath(); ctx.roundRect(b.x, b.y + lip, b.w, bodyH, r); ctx.fill();
      const [g0, g1] = K.face(bFill, ink);
      const g = ctx.createLinearGradient(0, top, 0, top + bodyH);
      g.addColorStop(0, g0); g.addColorStop(1, g1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(b.x, top, b.w, bodyH, r); ctx.fill();
      ctx.save();
      ctx.clip();
      if (live) {
        const inside = pt && pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h;
        K.ripple(inside ? pt.x : bcx, inside ? pt.y : top + bodyH / 2, Math.hypot(b.w, bodyH) * 0.8, ink, s.pressed, 0.6, 0.3);
      }
      const hg = ctx.createLinearGradient(0, top, 0, top + bodyH * 0.5);
      hg.addColorStop(0, 'rgba(255,255,255,0.3)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = hg; ctx.lineWidth = Math.max(1, 0.22 * u);
      ctx.beginPath(); ctx.roundRect(b.x + 0.5, top + 0.5, b.w - 1, bodyH - 1, Math.max(0, r - 0.5)); ctx.stroke();
      ctx.restore();
      if (!primary) { ctx.strokeStyle = C.alpha(th.ink, K.light ? 0.22 : 0.16); ctx.lineWidth = Math.max(1, 0.16 * u); ctx.beginPath(); ctx.roundRect(b.x, top, b.w, bodyH, r); ctx.stroke(); }
      lib.text.fill(ctx, L, bcx - L.width / 2, top + bodyH / 2 - L.height / 2 + L.size * 0.02, { color: ink });
      K.ring(b.x, b.y, b.w, b.h, r, s.focus ? 1 : 0);
      ctx.restore();
    };
    button(conf, sC, confirmL, true);
    if (canc) button(canc, sX, cancelL, false);
    ctx.restore();
  },
});
