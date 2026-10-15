// Kit: a mouse pointer that arrives, rests and clicks, for showing a UI.
//
// Usage. Over a screen recording of the studio, place the cursor on its own track with the same transform as
// the footage item and copy the recording's sidecar (showcase/footage/library-search.mp4.json) into it:
//   { "asset": "kit-cursor", "start": 0, "duration": 10.4, "transform": <the footage item's transform>,
//     "params": { "path": <sidecar.cursor>, "clicks": <sidecar.clicks>, "at": 0, "speed": 1 } }
// Positions are in the recording's pixels (`space`, 1440 x 900 unless told otherwise). If the footage is
// trimmed with `in: 2`, give the cursor `at: 2` so both read the same moment. For a simple move without a
// recording: "params": { "to": { "x": 612, "y": 132 }, "arrive": 0.9, "delay": 0.2, "clickTimes": [1.4] }.
asset({
  title: 'Cursor',
  description: 'A crisp vector mouse pointer (arrow, or the pointing hand) that arrives along an eased arc from outside the picture, rests and clicks (it presses down and a ring ripples out). Drive it with from/to/arrive for a simple move, or with a recording sidecar\'s cursor path and clicks (in the recording\'s pixels, interpolated smoothly). Place it with the same transform as the footage it annotates; pairs with kit-spotlight, kit-camera and kit-callout. Takes a theme.',
  tags: ['kit', 'cursor', 'pointer', 'click', 'ui', 'overlay', 'screen-recording'],
  duration: 4,
  params: {
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the coordinates refer to (a recording\'s pixels)' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the footage item\'s fit)' },
    shape: { type: 'enum', options: ['arrow', 'hand'], default: 'arrow' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    begin: { type: 'enum', options: ['offscreen', 'point'], default: 'offscreen', description: 'Where a from/to move starts: outside the box, or at from' },
    from: { type: 'object', fields: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 } }, description: 'Start point of a from/to move when begin is "point"' },
    to: { type: 'object', fields: { x: { type: 'number', default: 720 }, y: { type: 'number', default: 450 } }, description: 'Where a from/to move rests' },
    arrive: { type: 'number', default: 0.9, min: 0.05, max: 10, step: 0.01, description: 'Seconds the move takes' },
    delay: { type: 'number', default: 0.2, min: 0, max: 20, step: 0.01, description: 'Seconds before the move starts' },
    curve: { type: 'number', default: 0.1, min: -0.5, max: 0.5, step: 0.01, description: 'How far the path bends, as a share of its length (0 = straight)' },
    path: { type: 'array', of: { type: 'object', fields: { t: { type: 'number', default: 0 }, x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, down: { type: 'boolean', default: false } } }, description: 'A recording sidecar\'s cursor path [{ t, x, y, down? }]; when given it replaces from/to. A drag (the button held for a while) keeps the pointer pressed' },
    clicks: {
      type: 'array',
      of: { type: 'object', fields: { t: { type: 'number', default: 0 }, x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, selector: { type: 'string', default: null, nullable: true }, drag: { type: 'boolean', default: false }, box: { type: 'object', fields: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, width: { type: 'number', default: 0 }, height: { type: 'number', default: 0 } } } } },
      description: 'A sidecar\'s clicks [{ t }] (the other fields are ignored: the click happens where the cursor is)',
    },
    clickTimes: { type: 'array', of: { type: 'number' }, description: 'Click times in seconds, when there is no sidecar' },
    at: { type: 'number', default: 0, min: 0, max: 100000, step: 0.01, description: 'The recording\'s time (seconds) at the start of this item: the footage item\'s trim in' },
    speed: { type: 'number', default: 1, min: 0.05, max: 16, step: 0.01, description: 'Playback speed of the recording (as the footage item\'s)' },
    size: { type: 'number', default: 2.8, min: 1, max: 12, step: 0.1, description: 'Pointer height in % of the frame\'s short side' },
    color: { type: 'string', default: '', description: 'Pointer fill, a CSS colour (empty: the theme\'s ink)' },
    outline: { type: 'string', default: '', description: 'Pointer outline, a CSS colour (empty: the theme\'s background)' },
    ring: { type: 'string', default: '', description: 'Click ripple colour, a CSS colour (empty: the theme\'s accent)' },
    shadow: { type: 'number', default: 1, min: 0, max: 2, step: 0.05, description: 'Strength of the drop shadow (0 = none)' },
    press: { type: 'number', default: 0.82, min: 0.5, max: 1, step: 0.01, description: 'Scale of the pointer while pressed' },
    fadeIn: { type: 'number', default: 0.2, min: 0, max: 5, step: 0.01 },
    fadeOut: { type: 'number', default: 0.25, min: 0, max: 5, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const T = p.at + f.t * p.speed;

    // the picture (space) sits in this box like footage with `fit`
    const sx = f.width / p.space.width, sy = f.height / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const ox = (f.width - p.space.width * kx) / 2, oy = (f.height - p.space.height * ky) / 2;
    const toBox = (q) => ({ x: ox + q.x * kx, y: oy + q.y * ky });

    // where the pointer is at T, in the box
    let pos;
    const pts = [];
    for (const q of p.path) if (!pts.length || q.t > pts[pts.length - 1].t) pts.push(q);
    if (pts.length) {
      pos = toBox(sample(pts, T));
    } else {
      const dest = toBox(p.to);
      const src = p.begin === 'point' ? toBox(p.from) : { x: f.width + short * 0.06, y: f.height + short * 0.08 };
      const e = smootherstep(lib.clamp01((T - p.delay) / p.arrive));
      const mx = (src.x + dest.x) / 2, my = (src.y + dest.y) / 2;
      const nx = -(dest.y - src.y) * p.curve, ny = (dest.x - src.x) * p.curve;
      // a quadratic arc through a control point beside the midpoint
      const cx = mx + nx, cy = my + ny;
      pos = { x: (1 - e) * (1 - e) * src.x + 2 * (1 - e) * e * cx + e * e * dest.x, y: (1 - e) * (1 - e) * src.y + 2 * (1 - e) * e * cy + e * e * dest.y };
    }

    // presses: the pointer dips and springs back, a ring ripples out
    const times = [...p.clicks.map((c) => c.t), ...p.clickTimes];
    let dip = 1;
    const ripples = [];
    // a drag: the button is down over several samples, and the pointer stays pressed until it is released
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].down || (i > 0 && pts[i - 1].down)) continue;
      let j = i;
      while (j + 1 < pts.length && pts[j + 1].down) j++;
      const a = pts[i].t, b = j + 1 < pts.length ? pts[j + 1].t : pts[j].t;
      if (b - a < 0.12) continue;
      const k = T < a ? 0 : T < b ? lib.clamp01((T - a) / 0.07) : 1 - lib.clamp01((T - b) / 0.15);
      dip = Math.min(dip, 1 - (1 - p.press) * k);
    }
    for (const c of times) {
      const dt = (T - c) / p.speed;
      if (dt < 0 || dt > 0.7) continue;
      dip = Math.min(dip, dt < 0.07 ? 1 - (1 - p.press) * (dt / 0.07) : 1 - (1 - p.press) * (1 - easeOutBack(lib.clamp01((dt - 0.07) / 0.22))));
      ripples.push(dt / 0.6);
    }

    const fade = (p.fadeIn > 0 ? lib.clamp01(f.t / p.fadeIn) : 1) * (p.fadeOut > 0 ? lib.clamp01((f.duration - f.t) / p.fadeOut) : 1);
    if (fade <= 0) return;

    const H = (p.size / 100) * short;
    const u = shapeHeight(p.shape) ? H / shapeHeight(p.shape) : 1;
    const fill = p.color || th.ink, edge = p.outline || th.bg, accent = p.ring || th.accent;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(dip, dip);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const shape = (draw) => { ctx.save(); ctx.scale(u, u); draw(ctx); ctx.restore(); };
    // drop shadow: the silhouette again, wider and fainter, shifted down and right (a blur made of strokes, the same in every renderer)
    if (p.shadow > 0) {
      ctx.fillStyle = ctx.strokeStyle = '#000000';
      const steps = 6;
      for (let i = steps; i >= 1; i--) {
        ctx.globalAlpha = fade * 0.045 * p.shadow;
        ctx.lineWidth = (1.2 + i * 0.9) * u;
        ctx.save();
        ctx.translate(H * 0.05, H * 0.08);
        shape((c) => { build(c, p.shape); c.fill(); c.stroke(); });
        ctx.restore();
      }
    }
    for (const r of ripples) {
      if (r >= 1) continue;
      const e = 1 - (1 - r) ** 3;
      ctx.globalAlpha = fade * (1 - r) * 0.85;
      ctx.strokeStyle = accent;
      ctx.lineWidth = (Math.max(1.5, H * 0.09) * (1 - r * 0.6)) / dip;
      ctx.beginPath();
      ctx.arc(0, 0, (H * (0.25 + 0.95 * e)) / dip, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = fade;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.6 * u;
    shape((c) => { build(c, p.shape); c.stroke(); });
    ctx.fillStyle = fill;
    shape((c) => { build(c, p.shape); c.fill(); });
    ctx.restore();

    // a monotone cubic through the samples: smooth (continuous velocity), passes through every sample, never overshoots
    function sample(pts, t) {
      const n = pts.length;
      if (t <= pts[0].t) return pts[0];
      if (t >= pts[n - 1].t) return pts[n - 1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[hi], h = b.t - a.t, u2 = (t - a.t) / h;
      const slope = (i) => ({ x: (pts[i + 1].x - pts[i].x) / (pts[i + 1].t - pts[i].t), y: (pts[i + 1].y - pts[i].y) / (pts[i + 1].t - pts[i].t) });
      const tangent = (i, axis) => {
        if (i === 0) return slope(0)[axis];
        if (i === n - 1) return slope(n - 2)[axis];
        const d0 = slope(i - 1)[axis], d1 = slope(i)[axis];
        if (d0 * d1 <= 0) return 0;
        const h0 = pts[i].t - pts[i - 1].t, h1 = pts[i + 1].t - pts[i].t;
        const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
        return (w1 + w2) / (w1 / d0 + w2 / d1);
      };
      const hermite = (axis) => {
        const m0 = tangent(lo, axis), m1 = tangent(hi, axis), y0 = a[axis], y1 = b[axis];
        const u3 = u2 * u2 * u2, uu = u2 * u2;
        return (2 * u3 - 3 * uu + 1) * y0 + (u3 - 2 * uu + u2) * h * m0 + (-2 * u3 + 3 * uu) * y1 + (u3 - uu) * h * m1;
      };
      return { x: hermite('x'), y: hermite('y') };
    }
    function smootherstep(x) { return x * x * x * (x * (x * 6 - 15) + 10); }
    function easeOutBack(x) { return 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2; }
    // the tip is the origin; units are arbitrary and scaled by `u` to the pointer height
    function shapeHeight(kind) { return kind === 'hand' ? 16.6 : 19.5; }
    function build(c, kind) {
      c.beginPath();
      if (kind === 'hand') {
        // index finger up, three knuckles, a palm and a thumb; the hotspot is the fingertip
        c.roundRect(-1.8, 0, 3.6, 12, 1.8);
        c.roundRect(1.6, 6.6, 2.8, 7, 1.4);
        c.roundRect(4.2, 7.2, 2.8, 7, 1.4);
        c.roundRect(6.8, 8.2, 2.6, 6.4, 1.3);
        c.roundRect(-3.9, 8.6, 13.3, 8, 3.6);
        c.roundRect(-5.9, 9.4, 3.4, 5.4, 1.7);
      } else {
        c.moveTo(0, 0);
        c.lineTo(0, 16.6);
        c.lineTo(3.9, 13);
        c.lineTo(6.7, 19.5);
        c.lineTo(9.5, 18.3);
        c.lineTo(6.8, 12);
        c.lineTo(11.9, 12);
        c.closePath();
      }
    }
  },
});
