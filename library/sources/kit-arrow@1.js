// Kit: a curved arrow from A to B that draws itself on, with an optional label at its tail.
//
// Usage. Over a screen recording, give the arrow the same transform as the footage item; A and B are in the
// recording's pixels:
//   { "asset": "kit-arrow", "start": 6, "duration": 2.6, "transform": <the footage item's transform>,
//     "params": { "from": { "x": 980, "y": 640 }, "to": { "x": 1135, "y": 540 }, "label": "Open it", "curve": 0.3 } }
// Kit convention (also kit-callout): positions are in `space` pixels (the picture's own pixels, 1440 x 900 by default),
// mapped into the item box the way footage is placed there (`fit`); sizes are a share of the frame's short side.
asset({
  title: 'Arrow',
  description: 'A curved arrow from A to B that draws itself on (the stroke is revealed, then the head pops), with an optional label at its tail on a plate. A and B are in the picture\'s pixels, so a point read from a recording works unchanged. Place it with the same transform as the footage it annotates; pairs with kit-callout and kit-spotlight. Takes a theme.',
  tags: ['kit', 'arrow', 'pointer', 'annotation', 'draw-on', 'ui', 'overlay', 'screen-recording'],
  duration: 2.6,
  floor: 2.6,
  uses: ['easing'],
  params: {
    from: { type: 'object', fields: { x: { type: 'number', default: 300 }, y: { type: 'number', default: 650 } }, description: 'The tail, in the picture\'s pixels' },
    to: { type: 'object', fields: { x: { type: 'number', default: 760 }, y: { type: 'number', default: 340 } }, description: 'The head points here, in the picture\'s pixels' },
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the points refer to (a recording\'s pixels)' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the footage item\'s fit)' },
    label: { type: 'string', default: '', description: 'A short text at the tail (empty: none)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    curve: { type: 'number', default: 0.3, min: -1, max: 1, step: 0.01, description: 'How far the arrow bends, as a share of its length; the sign picks the side (0 = straight)' },
    width: { type: 'number', default: 0.45, min: 0.1, max: 3, step: 0.01, description: 'Line width in % of the frame\'s short side' },
    head: { type: 'number', default: 1, min: 0.4, max: 3, step: 0.05, description: 'Head size, 1 = as drawn by default' },
    size: { type: 'number', default: 2.8, min: 2.6, max: 12, step: 0.1, description: 'Label size in % of the frame\'s short side' },
    color: { type: 'string', default: '', description: 'Arrow colour, a CSS colour (empty: the theme\'s accent)' },
    delay: { type: 'number', default: 0.1, min: 0, max: 20, step: 0.01 },
    draw: { type: 'number', default: 0.8, min: 0.05, max: 10, step: 0.01, description: 'Seconds the stroke takes to draw on' },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const lw = (p.width / 100) * short;
    const color = p.color || th.accent;

    // the points, in the box
    const sx = f.width / p.space.width, sy = f.height / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const ox = (f.width - p.space.width * kx) / 2, oy = (f.height - p.space.height * ky) / 2;
    const A = { x: ox + p.from.x * kx, y: oy + p.from.y * ky }, B = { x: ox + p.to.x * kx, y: oy + p.to.y * ky };
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    if (len < 1) return;

    // a quadratic curve, flattened; the head sits on the last stretch of it
    const C = { x: (A.x + B.x) / 2 - (B.y - A.y) * p.curve, y: (A.y + B.y) / 2 + (B.x - A.x) * p.curve };
    const N = 72;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, v = 1 - u;
      pts.push({ x: v * v * A.x + 2 * v * u * C.x + u * u * B.x, y: v * v * A.y + 2 * v * u * C.y + u * u * B.y });
    }
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[N];
    const headLen = Math.min(total * 0.45, lw * 4.6 * p.head), headW = headLen * 0.46;
    const at = (d) => {
      // the point at arc length d
      let i = 1;
      while (i < N && cum[i] < d) i++;
      const a = cum[i - 1], b = cum[i], u = b > a ? (d - a) / (b - a) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
    };
    const shaft = total - headLen * 0.7;
    const baseP = at(total - headLen);
    const dir = Math.atan2(B.y - baseP.y, B.x - baseP.x);

    const e = E.inOutCubic(lib.clamp01((f.t - p.delay) / p.draw));
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    if (e <= 0 || out <= 0) return;
    const drawn = shaft * e;

    ctx.save();
    ctx.globalAlpha = out;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // the stroke twice: a darker, wider one beneath so it reads on light and dark pictures alike
    for (const [col, wd, a] of [[th.bg, lw * 2.6, 0.45], [color, lw, 1]]) {
      ctx.globalAlpha = out * a;
      ctx.strokeStyle = col;
      ctx.lineWidth = wd;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= N && cum[i - 1] < drawn; i++) {
        const last = cum[i] > drawn;
        const q = last ? at(drawn) : pts[i];
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }

    // the head: a notched triangle, in over the last stretch of the draw-on
    const h = lib.clamp01((e - 0.85) / 0.15);
    if (h > 0) {
      const k = E.outBack(h);
      ctx.save();
      ctx.translate(B.x, B.y);
      ctx.rotate(dir);
      ctx.scale(k, k);
      const shape = () => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-headLen, -headW);
        ctx.lineTo(-headLen * 0.72, 0);
        ctx.lineTo(-headLen, headW);
        ctx.closePath();
      };
      ctx.globalAlpha = out * 0.45;
      ctx.strokeStyle = ctx.fillStyle = th.bg;
      ctx.lineWidth = lw * 1.6;
      shape();
      ctx.stroke();
      ctx.globalAlpha = out;
      ctx.fillStyle = ctx.strokeStyle = color;
      ctx.lineWidth = lw * 0.5;
      shape();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // the label at the tail, on a plate, behind the direction the arrow leaves in
    if (p.label) {
      const size = (p.size / 100) * short;
      const L = lib.text.layout(ctx, p.label, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, maxWidth: Math.max(size * 4, f.safe.width * 0.34), markup: true, align: 'center', fit: true });
      const padX = size * 0.7, padY = size * 0.45;
      const bw = L.width + padX * 2, bh = L.height + padY * 2;
      const d0 = at(Math.min(total * 0.2, total));
      const ux = (d0.x - A.x), uy = (d0.y - A.y), ul = Math.hypot(ux, uy) || 1;
      const dx = ux / ul, dy = uy / ul;
      const gap = lw * 2.6 + size * 0.35;
      const reach = Math.abs(dx) * bw / 2 + Math.abs(dy) * bh / 2;
      let cx = A.x - dx * (gap + reach), cy = A.y - dy * (gap + reach);
      const s = f.safe;
      cx = Math.min(Math.max(cx, s.x + bw / 2), Math.max(s.x + bw / 2, s.x + s.width - bw / 2));
      cy = Math.min(Math.max(cy, s.y + bh / 2), Math.max(s.y + bh / 2, s.y + s.height - bh / 2));
      const k = lib.clamp01((f.t - p.delay) / 0.3);
      ctx.globalAlpha = out * k;
      ctx.translate(0, (1 - k) * size * 0.3);
      ctx.fillStyle = th.surface || th.bgAlt || th.bg;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.beginPath();
      ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, Math.min(size * 0.6, bh / 2));
      ctx.fill();
      ctx.stroke();
      lib.text.fill(ctx, L, cx - L.boxWidth / 2, cy - L.height / 2, { color: th.ink, emColor: color });
    }
    ctx.restore();
  },
});
