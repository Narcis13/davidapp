// A vertical menu for interactive compositions: a list of options on a soft panel, each a row with an optional
// kit-icon tile, a label, a muted detail and a chevron (or its number key). One hit region per option (id = its
// index), so a tap, a number key, or Tab and Enter emits select with that option's value. A highlighted option
// (bindable: the current choice, a setting) is marked by an indicator that slides from the last one.
//
// Usage. A main menu whose rows go to scenes; the number keys pick a row, Tab and Enter walk it:
//   { "id": "menu", "asset": "ui-menu", "start": 0, "duration": 10,
//     "params": { "title": "Main menu", "options": [{ "label": "New game", "icon": "play", "value": "play" },
//       { "label": "Continue", "detail": "Level 3", "icon": "history", "value": "resume" },
//       { "label": "Settings", "icon": "settings", "value": "settings" }], "highlight": { "$var": "row" } },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.55, "width": 0.92, "height": 0.5 } }
//   "wires": [{ "on": "menu.select", "if": { "var": "row", "eq": 0 }, "do": … },
//             { "on": "menu.select", "do": { "set": { "choice": "$value" } } },
//             { "on": "key:ArrowDown", "do": { "add": { "row": 1 }, "min": 0, "max": 2, "wrap": true } }]
// Arrow keys move a bound highlight through wires like the last one; a locked option ("locked": true) shows a lock and
// cannot be picked. Send it shake with an index as the value to shake that row (no value: the whole menu).

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

/** A chevron pointing right, stroked. */
function chevron(ctx, x, y, s, color, lw) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - s * 0.42); ctx.lineTo(x + s * 0.22, y); ctx.lineTo(x - s * 0.22, y + s * 0.42); ctx.stroke();
  ctx.restore();
}

asset({
  title: 'Menu',
  description: 'A vertical menu for interactive compositions: options on a soft panel, each row with an optional kit-icon tile, a label, a muted detail and a chevron or its number key. One hit region per option (id = index), so a tap, a number key or Tab + Enter emits select with the option\'s value; a bound `highlight` index marks the current option with an indicator that slides from the last one. Rows stagger in, lift on hover, ripple on a press and show a focus ring; locked options show a lock. Rows are at least a thumb tall on a phone; text has a size floor. Takes a theme.',
  tags: ['ui', 'interactive', 'menu', 'list', 'options', 'navigation', 'settings', 'game'],
  floor: FLOOR,
  uses: ['easing', 'kit-icon'],
  events: {
    emits: { select: 'when an option is tapped, or picked with its number key or Tab + Enter; the value is the option\'s value (or its label), the region id its index' },
    accepts: { shake: 'a sideways shake: of the row whose index is the value, or of the whole menu' },
  },
  params: {
    options: {
      type: 'array', minItems: 1, maxItems: 8,
      of: { type: 'object', fields: {
        label: { type: 'string', default: 'Option' },
        detail: { type: 'string', default: '', description: 'Muted text at the right of the row (a level, a count, a state)' },
        icon: { type: 'string', default: '', description: 'A kit-icon name in a tile at the left (empty: none)' },
        value: { type: 'string', default: '', description: 'Sent with select (empty: the label)' },
        locked: { type: 'boolean', default: false, description: 'Shown with a lock and not pickable' },
      } },
      default: [
        { label: 'New game', detail: '', icon: 'play', value: 'new', locked: false },
        { label: 'Continue', detail: 'Level 3', icon: 'history', value: 'continue', locked: false },
        { label: 'Settings', detail: '', icon: 'settings', value: 'settings', locked: false },
        { label: 'Credits', detail: '', icon: 'users', value: 'credits', locked: false },
      ],
    },
    title: { type: 'string', default: '', description: 'A heading over the list (empty: none)' },
    highlight: { type: 'integer', default: -1, min: -1, max: 7, description: 'The highlighted option (0-based; -1: none). Bind it to a number variable; the indicator slides when it changes' },
    emit: { type: 'enum', options: ['value', 'index'], default: 'value', description: 'What select sends: the option\'s value (or label), or its index (0-based: set a bound highlight with it)' },
    numberKeys: { type: 'boolean', default: true, description: 'Keys 1 to 8 pick the options' },
    keycaps: { type: 'boolean', default: false, description: 'Show each option\'s number key at its right instead of the chevron' },
    chevron: { type: 'boolean', default: true },
    disabled: { type: 'boolean', default: false, description: 'Dimmed and not pickable (bind it while a dialog is open)' },
    panel: { type: 'boolean', default: true, description: 'Rows on one panel with hairlines (off: separate pills)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    rowSize: { type: 'number', default: 10.5, min: 6, max: 24, step: 0.1, description: 'Row height in % of the frame\'s short side (they shrink to fit the box)' },
    size: { type: 'number', default: 3.8, min: 2.6, max: 9, step: 0.1, description: 'Label size in % of the frame\'s short side' },
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
    const t = f.t - p.delay;
    const kIn = p.inDur > 0 ? clamp01(t / p.inDur) : t >= 0 ? 1 : 0;
    const kOut = p.outDur > 0 ? clamp01((f.duration - f.t) / p.outDur) : 1;
    if (kIn <= 0 || kOut <= 0) return;

    const n = p.options.length;
    const head = th.fonts?.headline ?? 'Space Grotesk', body = th.fonts?.body ?? 'Inter', mono = th.fonts?.mono ?? 'JetBrains Mono';
    const ppad = p.panel ? 1.3 * u : 0;
    const gapR = p.panel ? 0 : 1.3 * u;
    const T = p.title ? K.text(p.title, { font: head, weight: 700, size: 4.4 * u, maxWidth: Math.max(1, f.width - 2 * ppad - 4 * u), wrap: 'none', fit: true }) : null;
    const titleH = T ? T.height + 2.4 * u : 0;
    const rowH = Math.max(1, Math.min(p.rowSize * u, (f.height - 2 * ppad - titleH - gapR * (n - 1)) / n));
    const listH = n * rowH + (n - 1) * gapR;
    const totalH = titleH + listH + 2 * ppad;
    const W = f.width, y0 = Math.max(0, (f.height - totalH) / 2);
    const rr = p.panel ? Math.min(2.4 * u, rowH * 0.3) : Math.min(rowH * 0.32, 3 * u);
    const PR = Math.min(3.2 * u, rr + ppad);
    const rows = p.options.map((o, i) => ({ o, i, x: ppad, y: y0 + ppad + titleH + i * (rowH + gapR), w: W - 2 * ppad, h: rowH }));

    // every row's region first, top to bottom (the Tab order), where it rests
    const states = rows.map((R) => f.ui.hit('select', R.x, R.y, R.w, R.h, {
      id: R.i, value: p.emit === 'index' ? R.i : R.o.value || R.o.label, label: R.o.label,
      keys: p.numberKeys && R.i < 9 ? [String(R.i + 1)] : undefined, disabled: p.disabled || R.o.locked,
    }));
    const pt = f.ui.pointer;

    // the rows' text, laid out before any transform
    const tile = rowH * 0.6, padL = Math.min(2.2 * u, rowH * 0.24);
    const rightW = p.keycaps && p.numberKeys ? rowH * 0.5 : p.chevron ? rowH * 0.32 : 0;
    const lay = rows.map((R) => {
      const D = R.o.detail ? K.text(R.o.detail, { font: body, weight: 500, size: Math.max(p.size * u * 0.82, 2.65 * u), wrap: 'none' }) : null;
      const left = R.x + padL + (R.o.icon ? tile + padL : 0);
      const maxW = Math.max(1, R.x + R.w - padL - rightW - (rightW ? padL * 0.6 : 0) - (D ? D.width + padL : 0) - left);
      const L = K.text(R.o.label, { font: head, weight: 600, size: p.size * u, maxWidth: maxW, wrap: 'none', fit: true });
      const KC = p.keycaps && p.numberKeys && R.i < 9 ? K.text(String(R.i + 1), { font: mono, weight: 700, size: Math.max(rowH * 0.24, 2.65 * u), wrap: 'none' }) : null;
      return { D, L, KC, left };
    });

    // the highlight: an indicator that slides from the last highlighted row
    const hc = f.ui.changed('highlight');
    let hlPos = p.highlight, hlA = p.highlight >= 0 && p.highlight < n ? 1 : 0;
    if (hc && hc.since < 0.4) {
      const k = clamp01(hc.since / 0.34);
      if (hc.from >= 0 && hc.from < n && hlA) hlPos = hc.from + (p.highlight - hc.from) * E.outBack(k);
      else if (hlA) hlA = E.outCubic(k);
      else if (hc.from >= 0 && hc.from < n) { hlPos = hc.from; hlA = 1 - E.outCubic(k); }
    }
    const shakeEv = f.ui.received('shake');
    const shakeT = shakeEv ? shakeEv.since : Infinity;
    const shakeRow = shakeEv && shakeEv.value !== null && shakeEv.value !== '' && Number.isFinite(Number(shakeEv.value)) ? Number(shakeEv.value) : -1;
    const wobble = shakeT < 0.7 ? Math.sin(shakeT * 42) * Math.exp(-shakeT * 6) * 1.5 * u : 0;

    const appear = E.outCubic(kIn) * kOut * (p.disabled ? 0.5 : 1);
    ctx.save();
    ctx.globalAlpha *= appear;
    if (shakeRow < 0) ctx.translate(wobble, 0);
    ctx.translate(0, (1 - E.outCubic(kIn)) * 3 * u);

    const fill = K.surface;
    if (p.panel) {
      K.shadow(0, y0, W, totalH, PR, 0.9, 1);
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.roundRect(0, y0, W, totalH, PR); ctx.fill();
      const sheen = ctx.createLinearGradient(0, y0, 0, y0 + totalH * 0.5);
      sheen.addColorStop(0, C.alpha(th.ink, K.light ? 0.0 : 0.05)); sheen.addColorStop(1, C.alpha(th.ink, 0));
      ctx.fillStyle = sheen; ctx.fill();
      ctx.strokeStyle = C.alpha(th.ink, K.light ? 0.18 : 0.13); ctx.lineWidth = Math.max(1, 0.15 * u);
      ctx.beginPath(); ctx.roundRect(0, y0, W, totalH, PR); ctx.stroke();
      if (T) lib.text.fill(ctx, T, ppad + padL, y0 + ppad + 1.2 * u, { color: K.legible(th.ink, fill) });
    } else if (T) lib.text.fill(ctx, T, padL * 0.5, y0, { color: K.legible(th.ink, th.bg) });

    // the indicator under the highlighted row
    if (hlA > 0) {
      const iy = rows[0].y + hlPos * (rowH + gapR);
      ctx.save();
      ctx.globalAlpha *= hlA;
      K.glow(rows[0].x, iy, rows[0].w, rowH, rr, th.accent, 0.35);
      ctx.fillStyle = C.mix(fill, th.accent, 0.2);
      ctx.beginPath(); ctx.roundRect(rows[0].x, iy, rows[0].w, rowH, rr); ctx.fill();
      ctx.fillStyle = K.legible(th.accent, fill, 3);
      const bw = Math.max(3, 0.7 * u);
      ctx.beginPath(); ctx.roundRect(rows[0].x + bw * 0.6, iy + rowH * 0.24, bw, rowH * 0.52, bw / 2); ctx.fill();
      ctx.restore();
    }

    rows.forEach((R, i) => {
      const st = states[i], { D, L, KC, left } = lay[i];
      const k = p.inDur > 0 ? E.outCubic(clamp01((t - 0.12 - i * 0.055) / Math.max(0.05, p.inDur * 0.8))) : 1;
      if (k <= 0) return;
      const locked = R.o.locked;
      const live = !p.disabled && !locked;
      const hov = live && st.hover ? E.outCubic(clamp01(st.hoverFor / 0.16)) : 0;
      const press = !live ? 0 : st.down ? 1 : st.pressed < 0.35 ? 1 - E.outBack(st.pressed / 0.35) : 0;
      const on = Math.abs(hlPos - i) < 0.5 ? hlA : 0;
      const rowFill = p.panel ? null : C.mix(fill, th.ink, 0.05 * hov);
      ctx.save();
      ctx.globalAlpha *= k * (locked ? 0.55 : 1);
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      ctx.translate(cx + (shakeRow === i ? wobble : 0) + (1 - k) * 4 * u, cy);
      const sc = 1 - 0.025 * Math.max(0, press);
      ctx.scale(sc, sc);
      ctx.translate(-cx, -cy);

      if (rowFill) {
        K.shadow(R.x, R.y, R.w, R.h, rr, 0.4 + 0.6 * hov, 0.8);
        ctx.fillStyle = rowFill;
        ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, rr); ctx.fill();
        ctx.strokeStyle = C.alpha(th.ink, K.light ? 0.18 : 0.12); ctx.lineWidth = Math.max(1, 0.15 * u); ctx.stroke();
      } else if (hov > 0 || press > 0) {
        ctx.fillStyle = C.alpha(th.ink, 0.05 * hov + 0.06 * Math.max(0, press));
        ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, rr); ctx.fill();
      }
      if (live && st.pressed < 0.55) {
        const inside = pt && pt.x >= R.x && pt.x <= R.x + R.w && pt.y >= R.y && pt.y <= R.y + R.h;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, rr); ctx.clip();
        K.ripple(inside ? pt.x : R.x + padL * 2, inside ? pt.y : cy, R.w, th.accent, st.pressed, 0.55, 0.26);
        ctx.restore();
      }
      // the hairline between panel rows (not around the highlighted one)
      if (p.panel && i > 0 && on < 0.5 && !(Math.abs(hlPos - (i - 1)) < 0.5 && hlA > 0.5)) {
        ctx.fillStyle = C.alpha(th.ink, K.light ? 0.12 : 0.08);
        ctx.fillRect(left, R.y - 0.5, R.x + R.w - padL - left, Math.max(1, 0.12 * u));
      }

      const bg = on > 0.5 ? C.mix(fill, th.accent, 0.2) : rowFill ?? fill;
      if (R.o.icon) {
        const tx = R.x + padL, ty = cy - tile / 2;
        const tFill = C.mix(C.mix(fill, th.accent, 0.16), th.accent, on);
        const tp = K.pair(tFill);
        ctx.fillStyle = on > 0 ? C.mix(C.mix(fill, th.accent, 0.16), tp.fill, on) : tFill;
        ctx.beginPath(); ctx.roundRect(tx, ty, tile, tile, tile * 0.28); ctx.fill();
        const ic = on > 0.5 ? tp.ink : K.legible(th.accent, tFill, 3);
        icon(f, R.o.icon, ic, p.theme, tx + tile * 0.22, ty + tile * 0.22, tile * 0.56, 2.25);
      }
      lib.text.fill(ctx, L, left, cy - L.height / 2 + L.size * 0.02, { color: K.legible(th.ink, bg) });
      const rightX = R.x + R.w - padL;
      let dx = rightX - (rightW ? rightW + padL * 0.6 : 0);
      if (locked) icon(f, 'lock', K.legible(th.muted, bg), p.theme, rightX - rowH * 0.34, cy - rowH * 0.17, rowH * 0.34, 2);
      else if (KC) {
        const kw = Math.max(rowH * 0.42, KC.width + rowH * 0.18), kh = rowH * 0.42;
        ctx.fillStyle = C.alpha(th.ink, 0.08); ctx.strokeStyle = C.alpha(th.ink, 0.22); ctx.lineWidth = Math.max(1, 0.15 * u);
        ctx.beginPath(); ctx.roundRect(rightX - kw, cy - kh / 2, kw, kh, kh * 0.25); ctx.fill(); ctx.stroke();
        lib.text.fill(ctx, KC, rightX - kw + (kw - KC.width) / 2, cy - KC.height / 2, { color: K.legible(th.muted, bg) });
        dx = rightX - kw - padL * 0.6;
      } else if (p.chevron) chevron(ctx, rightX - rowH * 0.12, cy, rowH * 0.3, K.legible(on > 0.5 ? th.accent : th.muted, bg, 3), Math.max(1.5, 0.45 * u));
      if (D) lib.text.fill(ctx, D, dx - D.width, cy - D.height / 2, { color: K.legible(th.muted, bg) });

      K.ring(R.x, R.y, R.w, R.h, rr, st.focus ? 1 : 0);
      ctx.restore();
    });
    ctx.restore();
  },
});
