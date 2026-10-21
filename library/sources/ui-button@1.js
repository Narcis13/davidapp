// A button for interactive compositions (played in a browser, not rendered): a tactile pill with a pressed-in lip, a
// soft stacked shadow, hover lift, a ripple from the finger, a springy release, a focus ring for the keyboard and an
// optional kit-icon. Primary (filled with the accent), secondary (a surface with a border) or ghost (text only).
// The label colour is picked for 4.5:1 contrast (the fill is nudged darker when no ink reaches it).
//
// Usage. A "Start" button that moves to the next scene, pressed by a tap, Tab + Enter or the Enter key alone; a wrong
// key shakes it:
//   { "id": "start", "asset": "ui-button", "start": 0, "duration": 4,
//     "params": { "label": "Start", "icon": "arrow-right", "hotkey": "Enter" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.84, "width": 0.9, "height": 0.16 } }
//   "wires": [{ "on": "start.press", "do": { "go": "quiz" } },
//             { "on": "key:x", "do": { "send": "start", "event": "shake" } }]
// Disable it until something is picked: "disabled": { "$var": "locked" } (a boolean variable).

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
  title: 'Button',
  description: 'A tactile button for interactive compositions (games, quizzes, menus played in the browser): primary (filled with the theme\'s accent), secondary (surface with a border) or ghost (text only). A pressed-in lip, a soft blur-free shadow, hover lift, a ripple from the finger, a springy release, a keyboard focus ring and an optional kit-icon; the label colour is chosen for 4.5:1 contrast. Emits press (with `value`) on a tap, Tab + Enter or its hotkeys; reacts to shake and pulse sent by the clip. Height is a share of the frame\'s short side (12 % by default: a thumb-sized target on a phone). Takes a theme.',
  tags: ['ui', 'interactive', 'button', 'control', 'cta', 'game', 'quiz'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    emits: { press: 'when it is tapped or clicked, or Enter / its hotkey is pressed; the value is `value` (or the label)' },
    accepts: { shake: 'a sideways shake: a wrong answer, a refused action', pulse: 'a bump and a ring spreading out: look here' },
  },
  params: {
    label: { type: 'string', default: 'Start', description: 'The text on it (empty: an icon-only round button)' },
    variant: { type: 'enum', options: ['primary', 'secondary', 'ghost'], default: 'primary', description: 'primary: filled with the accent, for the one thing to do next; secondary: a surface button with a border; ghost: text only, tinted on hover' },
    icon: { type: 'string', default: '', description: 'A kit-icon name beside the label (arrow-right, play, check, x, star, rotate-ccw…); empty: none' },
    iconSide: { type: 'enum', options: ['left', 'right'], default: 'right' },
    hotkey: { type: 'string', default: '', description: 'Keys that press it, comma separated (Enter, Escape, " " for space, 1, a, ArrowRight…); empty: none. Tab then Enter always works' },
    value: { type: 'string', default: '', description: 'Sent with press (read it as "$value" in a wire); empty: the label' },
    disabled: { type: 'boolean', default: false, description: 'Greyed out and not pressable; bind it ({ "$var": "locked" }) to enable it later' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 12, min: 6, max: 30, step: 0.1, description: 'Height in % of the frame\'s short side (11 or more for a thumb on a phone)' },
    width: { type: 'number', default: 0, min: 0, max: 100, step: 1, description: 'Width in % of the box (0: hug the label)' },
    align: { type: 'enum', options: ['center', 'left', 'right'], default: 'center', description: 'Where it sits across its box' },
    shape: { type: 'enum', options: ['pill', 'rounded'], default: 'pill' },
    color: { type: 'string', default: '', description: 'Fill of a primary button, text of a ghost one: a CSS colour (empty: the theme\'s accent)' },
    idle: { type: 'enum', options: ['shine', 'breathe', 'none'], default: 'shine', description: 'Idle motion of a primary button while it waits: a sheen sweeping across every few seconds, or a slow breath' },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05, description: 'Seconds into the item before it pops in (stagger a row of buttons)' },
    inDur: { type: 'number', default: 0.45, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0, min: 0, max: 3, step: 0.01, description: 'Seconds of the exit at the item\'s end. Keep 0 when the scene holds on its last frame for input' },
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

    // geometry: the height from `size`, the width hugs the label (or a share of the box); the lip is the pressed-in edge
    const ghost = p.variant === 'ghost';
    const h = Math.min(p.size * u, f.height);
    const lip = ghost || p.disabled ? 0 : h * 0.075;
    const bodyH = h - lip;
    const iconS = p.icon ? bodyH * 0.42 : 0;
    const gap = p.icon && p.label ? bodyH * 0.17 : 0;
    const padX = p.label ? bodyH * 0.5 : 0;
    const font = th.fonts?.headline ?? 'Space Grotesk';
    const L = p.label ? K.text(p.label, { font, weight: 700, size: bodyH * 0.36, maxWidth: Math.max(1, f.width - padX * 2 - iconS - gap), wrap: 'none', fit: true }) : null;
    const content = (L ? L.width : 0) + iconS + gap;
    const w = Math.min(f.width, Math.max(p.width > 0 ? (f.width * p.width) / 100 : 0, content + padX * 2, L ? bodyH * 2.2 : bodyH));
    const x = p.align === 'left' ? 0 : p.align === 'right' ? f.width - w : (f.width - w) / 2;
    const y = (f.height - h) / 2;
    const r = p.shape === 'pill' || !p.label ? bodyH / 2 : Math.min(bodyH * 0.3, 2.4 * u);

    // the hit region where it rests (the animations below do not move it), and the pointer for the ripple
    const keys = p.hotkey ? p.hotkey.split(',').map((k) => (k.length > 1 ? k.trim() : k)).filter(Boolean) : undefined;
    const s = f.ui.hit('press', x, y, w, h, { value: p.value || p.label || p.icon, keys, label: p.label || p.icon || 'button', disabled: p.disabled });
    const pt = f.ui.pointer;
    const live = !p.disabled;
    const hov = live && s.hover ? E.outCubic(clamp01(s.hoverFor / 0.18)) : 0;
    const press = !live ? 0 : s.down ? 1 : s.pressed < 0.36 ? 1 - E.outBack(s.pressed / 0.36) : 0;   // springs back past rest
    const sh = f.ui.since('shake'), pu = f.ui.since('pulse');
    const shakeX = sh < 0.7 ? Math.sin(sh * 44) * Math.exp(-sh * 6) * h * 0.16 : 0;
    const bump = pu < 0.5 ? Math.sin(Math.PI * (pu / 0.5)) * 0.08 : 0;
    const now = f.ui.now;
    const breathe = p.idle === 'breathe' && p.variant === 'primary' && live ? 0.014 * Math.sin(now * 2.4) : 0;

    // colours
    let fill, ink, lipC, border = null;
    if (p.disabled) {
      fill = ghost ? null : C.mix(K.surface, th.bg, 0.35);
      ink = C.mix(th.muted, ghost ? th.bg : fill, 0.25);
    } else if (p.variant === 'primary') {
      ({ fill, ink } = K.pair(p.color || th.accent));
      const away = K.ratio(ink, '#000000') > K.ratio(ink, '#ffffff') ? '#000000' : '#ffffff';
      lipC = C.mix(fill, '#000000', 0.34);
      fill = C.mix(C.mix(fill, away, 0.1 * hov), '#000000', 0.08 * Math.max(0, press));
    } else if (p.variant === 'secondary') {
      fill = C.mix(C.mix(K.surface, th.ink, 0.05 * hov), '#000000', 0.1 * Math.max(0, press));
      ink = K.legible(th.ink, fill);
      lipC = C.mix(K.surface, '#000000', K.light ? 0.16 : 0.45);
      border = C.alpha(th.ink, K.light ? 0.22 : 0.16 + 0.1 * hov);
    } else {
      fill = null;
      ink = K.legible(p.color || th.accent, th.bg);
    }

    const appear = E.outCubic(kIn) * kOut;
    const cx = x + w / 2, cy = y + h / 2;
    const sc = (0.9 + 0.1 * E.outBack(kIn)) * (1 + bump + breathe + 0.02 * hov) * (1 - 0.03 * Math.max(0, press));
    ctx.save();
    ctx.globalAlpha *= appear;
    ctx.translate(cx + shakeX, cy + (1 - E.outCubic(kIn)) * h * 0.3);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);

    // pulse: a ring spreading out from the edge
    if (pu < 0.8) {
      const k = pu / 0.8, off = E.outCubic(k) * h * 0.45;
      ctx.save();
      ctx.globalAlpha *= (1 - k) * 0.8;
      ctx.strokeStyle = K.legible(th.accent, th.bg, 3); ctx.lineWidth = Math.max(2, 0.5 * u);
      ctx.beginPath(); ctx.roundRect(x - off, y - off, w + 2 * off, h + 2 * off, r + off); ctx.stroke();
      ctx.restore();
    }

    const sink = lip * Math.max(-0.4, press);   // the body sinks onto its lip when pressed
    const by = y + sink;
    if (fill) {
      if (!p.disabled) K.shadow(x, y + lip * 0.5, w, bodyH + lip * 0.5, r, 0.7 + 0.8 * hov - 0.55 * Math.max(0, press), 1);
      if (!p.disabled && p.variant === 'primary') K.glow(x, by, w, bodyH + lip - sink, r, fill, 0.45 + 0.55 * hov + (s.focus ? 0.4 : 0));
      if (lip > 0) { ctx.fillStyle = lipC; ctx.beginPath(); ctx.roundRect(x, y + lip, w, bodyH, r); ctx.fill(); }
      const [top, bottom] = K.face(fill, ink);
      const g = ctx.createLinearGradient(0, by, 0, by + bodyH);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = p.disabled ? fill : g;
      ctx.beginPath(); ctx.roundRect(x, by, w, bodyH, r); ctx.fill();
    } else if (hov > 0 || press > 0) {
      ctx.fillStyle = C.alpha(ink, 0.1 * hov + 0.12 * Math.max(0, press));
      ctx.beginPath(); ctx.roundRect(x, by, w, bodyH, r); ctx.fill();
    }

    // inside the body: the idle sheen, the ripple, the top highlight
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, by, w, bodyH, r); ctx.clip();
    if (fill && p.variant === 'primary' && p.idle === 'shine' && live) {
      const ph = (now % 3.6) / 1.1;
      if (ph < 1) {
        const bx = x - w * 0.35 + E.inOutCubic(ph) * w * 1.7, bw = Math.max(bodyH, w * 0.18);
        const sg = ctx.createLinearGradient(bx - bw, by, bx + bw * 0.4, by + bodyH);
        const sa = K.ratio(ink, '#ffffff') < K.ratio(ink, '#000000') ? 0.1 : 0.32;
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, `rgba(255,255,255,${sa})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(x, by, w, bodyH);
      }
    }
    if (live) {
      const inside = pt && pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h;
      K.ripple(inside ? pt.x : cx, inside ? pt.y : by + bodyH / 2, Math.hypot(w, bodyH) * 0.8, ink, s.pressed, 0.6, 0.2);
    }
    if (fill && !p.disabled) {
      const hg = ctx.createLinearGradient(0, by, 0, by + bodyH * 0.5);
      hg.addColorStop(0, 'rgba(255,255,255,0.34)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = hg; ctx.lineWidth = Math.max(1, 0.22 * u);
      ctx.beginPath(); ctx.roundRect(x + 0.5, by + 0.5, w - 1, bodyH - 1, Math.max(0, r - 0.5)); ctx.stroke();
    }
    ctx.restore();
    if (border) {
      ctx.strokeStyle = border; ctx.lineWidth = Math.max(1, 0.18 * u);
      ctx.beginPath(); ctx.roundRect(x, by, w, bodyH, r); ctx.stroke();
    }

    // the label and the icon, centred on the body
    const lx = cx - content / 2, mid = by + bodyH / 2;
    const iconX = p.iconSide === 'left' ? lx : lx + content - iconS;
    const textX = p.iconSide === 'left' ? lx + iconS + gap : lx;
    if (L) lib.text.fill(ctx, L, textX, mid - L.height / 2 + L.size * 0.02, { color: ink });
    if (p.icon) icon(f, p.icon, ink, p.theme, iconX, mid - iconS / 2, iconS);

    K.ring(x, y, w, h, r, s.focus ? 1 : 0);
    ctx.restore();
  },
});
