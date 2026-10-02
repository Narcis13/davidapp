// A sketchbook of doodles that draw themselves. Each doodle is a list of strokes in a 100×100
// viewBox plus regions to colour in. The pen draws the outlines in order (a pencil rides the tip),
// then marker or hatching fills the regions, and the finished drawing keeps "boiling" and bobbing
// like a hand-drawn animation. An optional label boxes it like an object detector would.

const PI = Math.PI;

function rrect(I, x, y, w, h, r) {
  return [[x + r, y], ...I.arc(x + w - r, y + r, r, r, -PI / 2, 0, 0, 6), ...I.arc(x + w - r, y + h - r, r, r, 0, PI / 2, 0, 6),
    ...I.arc(x + r, y + h - r, r, r, PI / 2, PI, 0, 6), ...I.arc(x + r, y + r, r, r, PI, 1.5 * PI, 0, 6), [x + r + 2, y]];
}
const dot = (I, x, y, r = 1.2) => ({ pts: I.circle(x, y, r, { turns: 2.2, start: 0.4 }), w: 2.2 });
const poly = (pts) => pts.map((p) => [p[0], p[1]]);
function place(shape, dx, dy, s) {
  const m = (pts) => pts.map((p) => [dx + p[0] * s, dy + p[1] * s]);
  return {
    lines: shape.lines.map((l) => (Array.isArray(l) ? m(l) : { ...l, pts: m(l.pts), w: (l.w ?? 1) * Math.max(0.7, s) })),
    fills: shape.fills.map((f) => ({ ...f, poly: m(f.poly) })),
  };
}
const merge = (...shapes) => ({ lines: shapes.flatMap((s) => s.lines), fills: shapes.flatMap((s) => s.fills) });

const SHAPES = {
  robot(I) {
    const head = [[27, 22], [73, 22], [73, 52], [27, 52]], body = [[31, 56], [69, 56], [69, 86], [31, 86]];
    return {
      lines: [
        ...I.rect(27, 22, 46, 30), I.line(50, 22, 50, 12), I.circle(50, 9, 3.2, { seed: 5 }),
        I.circle(40, 35, 5, { seed: 6 }), I.circle(60, 35, 5, { seed: 7 }), dot(I, 41, 36), dot(I, 61, 36),
        I.spline([[39, 45], [45, 47.5], [55, 47.5], [61, 45]]),
        I.line(45, 52, 45, 56), I.line(55, 52, 55, 56), ...I.rect(31, 56, 38, 30),
        { pts: I.spline([[50, 76], [42, 68], [45, 63], [50, 67], [55, 63], [58, 68], [50, 76]], 5), role: 'accent', w: 0.8 },
        I.spline([[31, 62], [22, 70], [17, 80]]), I.circle(16, 83, 3, { seed: 8 }),
        I.spline([[69, 62], [79, 56], [85, 45]]), I.circle(86, 42, 3, { seed: 9 }),
        I.line(42, 86, 42, 95), I.line(58, 86, 58, 95), I.line(36, 95, 45, 95), I.line(55, 95, 64, 95),
      ],
      fills: [{ poly: head, role: 'accent2' }, { poly: body, role: 'highlight' }],
    };
  },
  brain(I) {
    const out = [];
    for (let i = 0; i <= 72; i++) {
      const a = -PI / 2 + (i / 72) * 2.04 * PI, r = 1 + 0.07 * Math.sin(a * 9);
      out.push([50 + Math.cos(a) * 40 * r, 52 + Math.sin(a) * 31 * r]);
    }
    return {
      lines: [
        out, I.spline([[50, 22], [46, 36], [53, 50], [47, 66], [50, 82]]),
        I.spline([[22, 42], [30, 36], [34, 46], [42, 42]]), I.spline([[58, 32], [66, 40], [76, 35]]),
        I.spline([[22, 60], [30, 66], [38, 58]]), I.spline([[57, 58], [63, 67], [71, 61], [79, 65]]),
        I.spline([[30, 75], [37, 72], [42, 78]]),
        { pts: I.line(84, 18, 92, 10), role: 'accent' }, { pts: I.line(88, 28, 98, 26), role: 'accent' }, { pts: I.line(76, 12, 78, 2), role: 'accent' },
      ],
      fills: [{ poly: out.slice(0, 70), role: 'accent' }],
    };
  },
  lightbulb(I) {
    const bulb = I.arc(50, 38, 24, 24, 0.75 * PI, 2.25 * PI);
    const rays = [];
    for (let i = 0; i < 7; i++) {
      const a = PI * (1.08 + i * 0.14);
      rays.push({ pts: I.line(50 + Math.cos(a) * 31, 38 + Math.sin(a) * 31, 50 + Math.cos(a) * 41, 38 + Math.sin(a) * 41), role: 'accent', w: 1.1 });
    }
    return {
      lines: [
        I.spline([[40, 68], [39, 61], [33, 55]]), bulb, I.spline([[67, 55], [61, 61], [60, 68]]),
        ...I.rect(39, 68, 22, 12), I.line(39, 72.5, 61, 72.5), I.line(39, 76.5, 61, 76.5), I.arc(50, 80, 6, 5, 0, PI),
        { pts: I.spline([[44, 67], [44, 50], [47, 45], [50, 50], [53, 45], [56, 50], [56, 67]], 6), role: 'accent', w: 0.8 },
        ...rays,
      ],
      fills: [{ poly: [...bulb, [60, 68], [40, 68]], role: 'highlight' }],
    };
  },
  computer(I) {
    return {
      lines: [
        ...I.rect(16, 12, 68, 52), ...I.rect(23, 19, 54, 38),
        { pts: [[30, 29], [37, 34], [30, 39]], role: 'accent3', w: 1.1 }, { pts: I.line(41, 40, 50, 40), role: 'accent3', w: 1.3 },
        I.line(44, 64, 41, 73), I.line(56, 64, 59, 73),
        [[14, 89], [86, 89], [78, 74], [22, 74], [14, 89]], I.line(22, 79, 78, 79), I.line(19, 84, 81, 84),
        I.line(36, 74, 33, 89), I.line(50, 74, 50, 89), I.line(64, 74, 67, 89),
      ],
      fills: [{ poly: [[23, 19], [77, 19], [77, 57], [23, 57]], role: 'ink', alpha: 0.85 }, { poly: [[14, 89], [86, 89], [78, 74], [22, 74]], role: 'accent2' }],
    };
  },
  head(I) {
    const profile = I.spline([[30, 96], [28, 74], [21, 58], [19, 40], [25, 22], [40, 11], [57, 11], [67, 20], [70, 32], [70, 40], [78, 50], [71, 53], [72, 58], [69, 61], [71, 65], [66, 72], [57, 74], [58, 96]], 6);
    return {
      lines: [profile, I.spline([[39, 44], [34, 40], [33, 50], [38, 53]]), dot(I, 62, 37),
        { pts: I.spline([[34, 28], [42, 22], [52, 28], [46, 34], [40, 30]]), role: 'accent', w: 0.9 }],
      fills: [{ poly: profile, role: 'highlight' }],
    };
  },
  turing(I) {
    const h = place(SHAPES.head(I), 0, 26, 0.5), c = place(SHAPES.computer(I), 50, 32, 0.5);
    return merge(h, c, {
      lines: [
        { pts: I.spline([[40, 30], [41, 22], [48, 19], [54, 23], [53, 29], [48, 32], [48, 37]]), role: 'accent', w: 1.2 },
        { ...dot(I, 48, 43, 1), role: 'accent' },
        { pts: I.arrow(36, 52, 58, 52, { bend: -0.25, head: 4 })[0], role: 'pencil', w: 0.7 },
        { pts: I.arrow(36, 52, 58, 52, { bend: -0.25, head: 4 })[1], role: 'pencil', w: 0.7 },
      ],
      fills: [],
    });
  },
  'chess-king'(I) {
    const body = [[36, 74], [40, 60], [38, 48], [44, 41], [56, 41], [62, 48], [60, 60], [64, 74]];
    return {
      lines: [
        I.line(50, 22, 50, 5), I.line(42, 12, 58, 12),
        I.spline([[38, 37], [35, 28], [42, 22], [50, 23], [58, 22], [65, 28], [62, 37]]),
        I.arc(50, 39, 15, 4.5, 0, 2.1 * PI),
        I.spline([[44, 43], [38, 50], [41, 62], [36, 74]]), I.spline([[56, 43], [62, 50], [59, 62], [64, 74]]),
        ...I.rect(33, 74, 34, 8), ...I.rect(25, 82, 50, 11),
        { pts: I.line(8, 97, 92, 97), role: 'pencil', w: 0.7 },
      ],
      fills: [{ poly: body, role: 'ink', mode: 'hatch' }, { poly: [[38, 37], [35, 28], [42, 22], [58, 22], [65, 28], [62, 37]], role: 'ink', mode: 'hatch' }, { poly: [[25, 82], [75, 82], [75, 93], [25, 93]], role: 'accent' }],
    };
  },
  snowflake(I) {
    const lines = [];
    for (let i = 0; i < 6; i++) {
      const a = -PI / 2 + (i * PI) / 3, c = Math.cos(a), s = Math.sin(a), at = (r, d) => [50 + c * r - s * d, 50 + s * r + c * d];
      lines.push([at(4, 0), at(42, 0)]);
      lines.push([at(17, -6), at(23, 0), at(17, 6)]);
      lines.push([at(30, -6), at(35, 0), at(30, 6)]);
    }
    return { lines: [...lines, I.circle(50, 50, 6, { seed: 2 })], fills: [] };
  },
  cat(I) {
    const body = [[38, 47], [30, 60], [28, 78], [36, 92], [50, 94], [64, 92], [72, 78], [70, 60], [62, 47]];
    const head = I.circle(50, 33, 19, { ry: 15, seed: 11, turns: 1.04 });
    return {
      lines: [
        head, [[34, 25], [35, 9], [46, 19]], [[54, 19], [65, 9], [66, 25]],
        I.circle(43, 32, 3, { seed: 3 }), I.circle(57, 32, 3, { seed: 4 }), dot(I, 43.5, 32.5, 0.9), dot(I, 57.5, 32.5, 0.9),
        [[48, 38], [52, 38], [50, 40.5], [48, 38]], I.spline([[45.5, 43], [48, 44.5], [50, 41]]), I.spline([[50, 41], [52, 44.5], [54.5, 43]]),
        { pts: I.line(28, 36, 41, 38.5), w: 0.6 }, { pts: I.line(29, 42, 41, 41), w: 0.6 }, { pts: I.line(59, 38.5, 72, 36), w: 0.6 }, { pts: I.line(59, 41, 71, 42), w: 0.6 },
        I.spline(body, 7), I.arc(43, 93, 5, 3, PI, 2 * PI), I.arc(57, 93, 5, 3, PI, 2 * PI),
        I.spline([[70, 86], [84, 85], [91, 72], [85, 61], [80, 64]]),
        { pts: I.spline([[34, 66], [40, 64], [44, 68]]), role: 'accent', w: 0.8 }, { pts: I.spline([[56, 68], [60, 64], [66, 66]]), role: 'accent', w: 0.8 },
      ],
      fills: [{ poly: [...head.slice(0, -2)], role: 'accent' }, { poly: body, role: 'accent' }],
    };
  },
  chat(I) {
    const b1 = rrect(I, 6, 8, 60, 32, 9), b2 = rrect(I, 34, 50, 60, 32, 9);
    return {
      lines: [
        b1, [[16, 40], [12, 51], [28, 40]], I.line(16, 19, 54, 19), I.line(16, 28, 42, 28),
        b2, [[80, 82], [88, 93], [70, 82]],
        { ...dot(I, 52, 66, 2), role: 'ink' }, { ...dot(I, 64, 66, 2), role: 'ink' }, { ...dot(I, 76, 66, 2), role: 'ink' },
      ],
      fills: [{ poly: b1, role: 'accent2', alpha: 0.6 }, { poly: b2, role: 'highlight' }],
    };
  },
  question(I) {
    return {
      lines: [{ pts: I.spline([[30, 34], [34, 17], [50, 9], [66, 15], [70, 30], [60, 42], [50, 50], [50, 66]], 8), w: 2.4 }, { ...dot(I, 50, 83, 3.4), w: 3 }],
      fills: [],
    };
  },
  rocket(I) {
    const body = I.spline([[50, 6], [61, 20], [64, 46], [60, 70], [40, 70], [36, 46], [39, 20], [50, 6]], 7);
    return {
      lines: [
        body, I.circle(50, 36, 7.5, { seed: 6 }), I.line(41, 56, 59, 56),
        [[38, 52], [25, 70], [39, 70]], [[62, 52], [75, 70], [61, 70]],
        { pts: I.spline([[42, 72], [44, 86], [49, 80], [51, 95], [55, 80], [58, 72]], 6), role: 'accent' },
        { pts: I.line(22, 80, 22, 95), role: 'pencil', w: 0.6 }, { pts: I.line(78, 80, 78, 95), role: 'pencil', w: 0.6 },
      ],
      fills: [{ poly: body, role: 'paper' }, { poly: I.circle(50, 36, 7.5, { turns: 1 }), role: 'accent2' }, { poly: [[38, 52], [25, 70], [39, 70]], role: 'accent' }, { poly: [[62, 52], [75, 70], [61, 70]], role: 'accent' }, { poly: [[42, 72], [44, 86], [49, 80], [51, 95], [55, 80], [58, 72]], role: 'highlight' }],
    };
  },
  star(I) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = -PI / 2 + (i * PI) / 5, r = i % 2 ? 18 : 44; pts.push([50 + Math.cos(a) * r, 54 + Math.sin(a) * r]); }
    return { lines: [pts], fills: [{ poly: pts, role: 'highlight' }] };
  },
  heart(I) {
    const h = I.spline([[50, 88], [22, 62], [12, 38], [26, 18], [44, 22], [50, 34], [56, 22], [74, 18], [88, 38], [78, 62], [50, 88]], 7);
    return { lines: [h], fills: [{ poly: h, role: 'accent' }] };
  },
};
const NAMES = Object.keys(SHAPES);
const ROLES = ['auto', 'ink', 'accent', 'accent2', 'accent3', 'highlight'];

asset({
  title: 'Self-drawing doodle',
  description: 'Hand-drawn doodles that draw themselves stroke by stroke with a pencil riding the pen tip, then get coloured in with marker or hatching, then keep boiling and bobbing. Shapes: robot, brain, lightbulb, computer, head, turing (a person and a computer), chess-king, snowflake, cat, chat, question, rocket, star, heart. Optional detector-style label box. Exits by fading or un-drawing.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'icon', 'draw-on', 'illustration'],
  uses: ['sketch-ink'],
  params: {
    shape: { type: 'enum', options: NAMES, default: 'robot' },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05, description: 'Seconds before the pen starts' },
    drawDur: { type: 'number', default: 1.8, min: 0.2, max: 10, step: 0.05, description: 'Seconds to draw the outlines and colour in' },
    weight: { type: 'number', default: 1.3, min: 0.3, max: 4, step: 0.05, description: 'Stroke width in viewBox units' },
    style: { type: 'enum', options: ['ink', 'pen', 'pencil'], default: 'ink' },
    fill: { type: 'boolean', default: true },
    fillMode: { type: 'enum', options: ['marker', 'hatch'], default: 'marker' },
    fillRole: { type: 'enum', options: ROLES, default: 'auto', description: 'Recolour every fill with one theme colour' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1, description: 'Line boil, re-jitters per second' },
    wobble: { type: 'number', default: 1, min: 0, max: 4, step: 0.05 },
    pencil: { type: 'boolean', default: true, description: 'Show a pencil at the pen tip while drawing' },
    idle: { type: 'enum', options: ['bob', 'sway', 'none'], default: 'bob' },
    flip: { type: 'boolean', default: false, description: 'Mirror horizontally' },
    label: { type: 'string', default: '', description: 'Detector-style label boxed around the drawing, e.g. "cat 0.98"' },
    exit: { type: 'enum', options: ['none', 'fade', 'undraw'], default: 'none' },
    outDur: { type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.05 },
    pad: { type: 'number', default: 0.06, min: 0, max: 0.4, step: 0.01, description: 'Padding around the drawing, as a fraction of the box' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const th = f.use(p.theme);
    const shape = SHAPES[p.shape](I);
    const box = { x: f.width * p.pad, y: f.height * p.pad, width: f.width * (1 - 2 * p.pad), height: f.height * (1 - 2 * p.pad) };
    const F = I.fit([], box);
    const s = F.scale, map = F.map;
    const color = (role) => (role === 'paper' ? th.paper : th[role] ?? th.ink);

    const t = f.t - p.delay;
    if (t < 0) return;
    let k = lib.clamp01(t / p.drawDur);
    const exitK = p.exit === 'none' ? 1 : lib.clamp01((f.duration - f.t) / p.outDur);
    if (p.exit === 'undraw') k = Math.min(k, exitK);
    const lineK = lib.clamp01(k / 0.7), fillK = lib.clamp01((k - 0.55) / 0.45);
    const b = I.boil(f, p.boil);

    ctx.save();
    if (p.exit === 'fade') ctx.globalAlpha = exitK;
    const done = lib.clamp01((t - p.drawDur) / 0.6);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (p.idle === 'bob') ctx.translate(0, Math.sin(t * 2.4) * f.vmin * 0.8 * done);
    if (p.idle === 'sway') { ctx.translate(cx, cy); ctx.rotate(Math.sin(t * 1.7) * 0.035 * done); ctx.translate(-cx, -cy); }
    if (p.flip) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }

    // colour in first so the ink sits on top
    if (p.fill && fillK > 0) {
      const fills = shape.fills;
      fills.forEach((fl, i) => {
        const fk = lib.clamp01(fillK * fills.length - i);
        if (fk <= 0) return;
        const pts = map(fl.poly);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
        const role = p.fillRole === 'auto' ? fl.role : p.fillRole;
        const mode = fl.mode ?? p.fillMode;
        ctx.save();
        I.path(ctx, pts);
        ctx.clip();
        if (mode === 'hatch') {
          I.strokes(f, I.hatch(bx, by, bw, bh, { gap: s * 3.2, seed: i + 3, angle: -0.75 }), { width: s * 0.55, color: color(role), style: 'pencil', progress: fk, boil: b, seed: i * 31, lift: 0 });
        } else {
          // a slanted wipe reveals a flat marker fill, nudged off the outline like a misregistered print
          const edge = bx - bh * 0.5 + (bw + bh) * (1 - (1 - fk) * (1 - fk));
          ctx.beginPath();
          ctx.moveTo(bx - bh - 10, by - 10); ctx.lineTo(edge, by - 10); ctx.lineTo(edge - bh * 0.5, by + bh + 10); ctx.lineTo(bx - bh - 10, by + bh + 10);
          ctx.closePath();
          ctx.clip();
          const off = s * 1.2;
          ctx.globalCompositeOperation = role === 'paper' ? 'source-over' : 'multiply';
          ctx.globalAlpha *= (fl.alpha ?? 0.85);
          ctx.fillStyle = color(role);
          ctx.translate(off * (I.hash(b + i) - 0.3), off * (I.hash(b * 1.3 + i) - 0.3));
          I.path(ctx, pts);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    const list = shape.lines.map((l) => (Array.isArray(l) ? { pts: map(l) } : { ...l, pts: map(l.pts) }))
      .map((l) => ({ pts: l.pts, width: s * p.weight * (l.w ?? 1), color: color(l.role ?? 'ink'), style: l.role === 'pencil' ? 'pencil' : p.style }));
    const tip = I.strokes(f, list, { progress: lineK, boil: b, wobble: p.wobble, seed: 7, style: p.style });
    if (p.pencil && tip && (p.exit !== 'undraw' || exitK >= 1)) I.pencil(f, tip, { size: f.vmin * 16 });

    // detector label: a box drawn around the doodle with a tag
    if (p.label && t > p.drawDur) {
      const lk = lib.clamp01((t - p.drawDur) / 0.5);
      const all = list.flatMap((l) => l.pts);
      const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
      const m = s * 3;
      const lx = Math.min(...xs) - m, ly = Math.min(...ys) - m, lw = Math.max(...xs) - lx + m, lh = Math.max(...ys) - ly + m;
      const c = th.accent3;
      I.strokes(f, I.rect(lx, ly, lw, lh), { width: s * 0.9, color: c, style: 'pen', progress: lk, boil: b, seed: 91, lift: 0 });
      if (lk > 0.6) {
        const fs = Math.max(14, s * 5.5);
        ctx.font = `700 ${fs}px "JetBrains Mono"`;
        const tw = ctx.measureText(p.label).width;
        const a = lib.clamp01((lk - 0.6) / 0.4);
        ctx.globalAlpha *= a;
        ctx.fillStyle = c;
        ctx.fillRect(lx - s * 0.4, ly - fs * 1.45, tw + fs * 0.8, fs * 1.45);
        ctx.fillStyle = th.paper;
        ctx.fillText(p.label, lx + fs * 0.4 - s * 0.4, ly - fs * 0.38);
      }
    }
    ctx.restore();
  },
});
