// Kit: a bubble with a short text that points at a spot of the picture, popping in.
//
// Usage. Over a screen recording, give the callout the same transform as the footage item and the point it names, in
// the recording's pixels (a sidecar click's x and y, or the centre of an element box):
//   { "asset": "kit-callout", "start": 4.2, "duration": 2.8, "transform": <the footage item's transform>,
//     "params": { "text": "Filter by *kind*", "point": { "x": 138, "y": 539 }, "side": "auto" } }
// The bubble keeps inside the safe area and flips to the other side when the first choice would leave it.
// Kit convention (also kit-arrow): positions are in `space` pixels (the picture's own pixels, 1440 x 900 by default),
// mapped into the item box the way footage is placed there (`fit`); sizes are a share of the frame's short side.
asset({
  title: 'Callout',
  description: 'A bubble with a short text that points at a point of the picture (a tail from the bubble, or a leader line with a dot), popping in with an eased scale. The point is in the picture\'s pixels; the bubble stays inside the safe area and flips to the other side when it would leave it. Text sizes are a share of the frame\'s short side, with a floor. Place it with the same transform as the footage it annotates; pairs with kit-cursor, kit-arrow and kit-spotlight. Takes a theme.',
  tags: ['kit', 'callout', 'bubble', 'annotation', 'label', 'ui', 'overlay', 'screen-recording'],
  duration: 3,
  floor: 2.6,
  uses: ['easing'],
  params: {
    text: { type: 'string', default: 'Search the *library*', description: '*Asterisks* mark words in the accent colour; \\n breaks a line' },
    point: { type: 'object', fields: { x: { type: 'number', default: 720 }, y: { type: 'number', default: 450 } }, description: 'What it points at, in the picture\'s pixels' },
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the point refers to (a recording\'s pixels)' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the footage item\'s fit)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    side: { type: 'enum', options: ['auto', 'top', 'bottom', 'left', 'right'], default: 'auto', description: 'Which side of the point the bubble sits on; it flips when that would leave the safe area' },
    style: { type: 'enum', options: ['tail', 'leader'], default: 'tail', description: 'A speech-bubble tail, or a line with a dot on the point' },
    size: { type: 'number', default: 3.2, min: 2.6, max: 12, step: 0.1, description: 'Text size in % of the frame\'s short side' },
    maxWidth: { type: 'number', default: 32, min: 8, max: 100, step: 1, description: 'Widest the bubble gets, in % of the safe width' },
    gap: { type: 'number', default: 5.5, min: 1, max: 30, step: 0.1, description: 'Distance from the point to the bubble, in % of the frame\'s short side' },
    plate: { type: 'string', default: '', description: 'Bubble colour, a CSS colour (empty: the theme\'s surface)' },
    ink: { type: 'string', default: '', description: 'Text colour, a CSS colour (empty: the theme\'s ink)' },
    accent: { type: 'string', default: '', description: 'Border, line and *emphasis* colour, a CSS colour (empty: the theme\'s accent)' },
    pop: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01, description: 'Seconds the pop-in takes' },
    from: { type: 'number', default: 0.7, min: 0.3, max: 1, step: 0.01, description: 'Scale it pops in from' },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short, gap = (p.gap / 100) * short;
    const accent = p.accent || th.accent, ink = p.ink || th.ink, plate = p.plate || th.surface || th.bgAlt || th.bg;
    const safe = f.safe;

    // the point, in the box
    const sx = f.width / p.space.width, sy = f.height / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const P = { x: (f.width - p.space.width * kx) / 2 + p.point.x * kx, y: (f.height - p.space.height * ky) / 2 + p.point.y * ky };

    // the text is laid out before the pop-in scales the canvas: the size floor is measured on the screen
    const padX = size * 0.8, padY = size * 0.55;
    const L = lib.text.layout(ctx, p.text, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, lineHeight: 1.18, maxWidth: Math.max(size * 4, Math.min(safe.width * (p.maxWidth / 100), safe.width - padX * 2)), markup: true, align: 'center', fit: true });
    const w = L.width + padX * 2, h = L.height + padY * 2;
    const r = Math.min(size * 0.7, h / 2);

    // which side: the wanted one if the bubble fits inside the safe area there, else the other ones in turn
    const fits = {
      top: P.y - gap - h >= safe.y,
      bottom: P.y + gap + h <= safe.y + safe.height,
      left: P.x - gap - w >= safe.x,
      right: P.x + gap + w <= safe.x + safe.width,
    };
    const order = p.side === 'auto' ? ['top', 'bottom', 'right', 'left'] : p.side === 'top' ? ['top', 'bottom', 'right', 'left'] : p.side === 'bottom' ? ['bottom', 'top', 'right', 'left'] : p.side === 'left' ? ['left', 'right', 'top', 'bottom'] : ['right', 'left', 'top', 'bottom'];
    // auto leans the way with most room: over the point when it is in the lower half, under it otherwise
    if (p.side === 'auto' && P.y < safe.y + safe.height / 2) order.splice(0, 2, 'bottom', 'top');
    const side = order.find((s) => fits[s]) ?? order[0];
    const horizontal = side === 'left' || side === 'right';
    let bx = horizontal ? (side === 'left' ? P.x - gap - w : P.x + gap) : P.x - w / 2;
    let by = horizontal ? P.y - h / 2 : (side === 'top' ? P.y - gap - h : P.y + gap);
    // clamp into the safe area (along the side, and across it when nothing fitted)
    bx = Math.min(Math.max(bx, safe.x), Math.max(safe.x, safe.x + safe.width - w));
    by = Math.min(Math.max(by, safe.y), Math.max(safe.y, safe.y + safe.height - h));

    const k = p.pop > 0 ? E.outBack(lib.clamp01(f.t / p.pop)) : 1;
    const out = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const alpha = Math.min(lib.clamp01((p.pop > 0 ? f.t / (p.pop * 0.5) : 1)), out);
    if (alpha <= 0) return;
    const scale = (p.from + (1 - p.from) * k) * (0.92 + 0.08 * out);

    // where the tail or the leader leaves the bubble: the edge point nearest the target, kept off the corners
    const ex = horizontal ? (side === 'left' ? bx + w : bx) : Math.min(Math.max(P.x, bx + r + size * 0.5), bx + w - r - size * 0.5);
    const ey = horizontal ? Math.min(Math.max(P.y, by + r + size * 0.5), by + h - r - size * 0.5) : (side === 'top' ? by + h : by);
    const line = Math.max(2, size * 0.09);

    ctx.save();
    ctx.globalAlpha = alpha;
    // pops out of the point it names
    ctx.translate(P.x, P.y);
    ctx.scale(scale, scale);
    ctx.translate(-P.x, -P.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // soft shadow (stacked fills: the same in every renderer)
    for (let i = 5; i >= 1; i--) {
      ctx.globalAlpha = alpha * 0.07;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(bx - i * size * 0.07, by + size * 0.12 - i * size * 0.05, w + i * size * 0.14, h + i * size * 0.14, r + i * size * 0.07);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;

    if (p.style === 'leader') {
      // a line from the bubble to the point and a dot on it, over a darker underline so it reads on anything
      for (const [col, wd, a] of [[th.bg, line * 2.6, 0.5], [accent, line, 1]]) {
        ctx.globalAlpha = alpha * a;
        ctx.strokeStyle = col;
        ctx.lineWidth = wd;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(P.x, P.y);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = th.bg;
      ctx.beginPath();
      ctx.arc(P.x, P.y, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(P.x, P.y, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // bubble
    ctx.fillStyle = plate;
    ctx.strokeStyle = accent;
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, r);
    ctx.fill();
    ctx.stroke();

    if (p.style === 'tail') {
      // a triangle on the edge facing the point (its base on the edge, its tip on the point), joined to the bubble without a seam
      const base = size * 0.6;
      const ax = horizontal ? 0 : base, ay = horizontal ? base : 0;
      const tri = () => {
        ctx.beginPath();
        ctx.moveTo(ex - ax, ey - ay);
        ctx.lineTo(P.x, P.y);
        ctx.lineTo(ex + ax, ey + ay);
      };
      ctx.fillStyle = plate;
      tri();
      ctx.closePath();
      ctx.fill();
      tri();
      ctx.stroke();
      // cover the bubble's border where the tail joins it
      ctx.strokeStyle = plate;
      ctx.lineWidth = line * 1.6;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(ex - ax, ey - ay);
      ctx.lineTo(ex + ax, ey + ay);
      ctx.stroke();
    }

    lib.text.fill(ctx, L, bx + w / 2 - L.boxWidth / 2, by + padY, { color: ink, emColor: accent });
    ctx.restore();
  },
});
